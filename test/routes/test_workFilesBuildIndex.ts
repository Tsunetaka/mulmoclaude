// Unit tests for the 教材索引 CSV generation wiring in
// server/api/routes/workFiles.ts — POST /api/work/build-index.
//
// The happy path spawns build_index.py (needs python-pptx + a readable D:)
// and a hidden agent worker, so the real run is verified live / by
// `build_index.py --selftest`. Here we cover the pure helpers and the
// orchestration with BOTH seams injected (python spawn + spawnSystemWorker),
// so no subprocess and no agent session is ever launched:
//
//   - isAllowedIndexCategory: the allowlist that IS the security boundary
//     (a category name only reaches a path after passing it)
//   - the in-flight guard: a second POST is 409 while a run is in flight,
//     and the guard clears on Phase 3 completion — including when Phase 3
//     fails, when the worker launch is refused, and when Phase 1 fails
//   - parsePendingCount: the `PENDING: n` last line; missing ⇒ null, which
//     means "pending 不明" and Phase 2 runs anyway
//   - buildIndexProgressLine: nothing sent when the count has not moved

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";

import {
  buildIndexProgressLine,
  buildIndexScriptArgs,
  isAllowedIndexCategory,
  isBuildingIndex,
  parsePendingCount,
  resetBuildIndexForTesting,
  runBuildIndex,
  type BuildIndexContext,
  type BuildIndexDeps,
} from "../../server/api/routes/workFiles.js";

type RouteModule = typeof import("../../server/api/routes/workFiles.js");
type Handler = (req: Request, res: Response) => Promise<void> | void;

interface StackFrame {
  route?: { path: string; stack: { method: string; handle: Handler }[] };
}
interface RouterInternals {
  stack: StackFrame[];
}

function extractRouteHandler(mod: RouteModule, routePath: string, method: string): Handler {
  const router = mod.default as unknown as RouterInternals;
  for (const frame of router.stack) {
    if (frame.route?.path !== routePath) continue;
    const layer = frame.route.stack.find((stackLayer) => stackLayer.method === method);
    if (layer) return layer.handle;
  }
  throw new Error(`route ${method.toUpperCase()} ${routePath} not registered`);
}

const ctx: BuildIndexContext = {
  category: "Smallworld with AI",
  workRootWin: "D:\\SW_Doc\\Materials",
  staging: "/ws/data/work/.index/Smallworld with AI",
  stagingRel: "data/work/.index/Smallworld with AI",
};

/** Injected deps: scan reports `pendingLine` rows, the worker launch is
 *  captured (never launched), apply exits with `applyCode`. */
function makeDeps(options: { pendingLine?: string; scanCode?: number; applyCode?: number; launchError?: string } = {}) {
  const calls = { scans: 0, applies: 0, spawns: 0, lines: [] as string[] };
  let onComplete: ((outcome: { didError: boolean }) => void | Promise<void>) | undefined;
  const deps: BuildIndexDeps = {
    runScript: async (subcommand) => {
      if (subcommand === "scan") {
        calls.scans += 1;
        const lines = ["D: をスキャン: Smallworld with AI（13 WD）", "対象 9 件（最新版のみ）"];
        if (options.pendingLine !== undefined) lines.push(options.pendingLine);
        return { code: options.scanCode ?? 0, lines };
      }
      calls.applies += 1;
      return { code: options.applyCode ?? 0, lines: ["9 行を書き出しました（Claude 記入 9 / 引き継ぎ 0）"] };
    },
    spawnWorker: async (args) => {
      calls.spawns += 1;
      ({ onComplete } = args);
      if (options.launchError !== undefined) return { ok: false, error: options.launchError };
      return { ok: true, chatId: `chat-${calls.spawns}` };
    },
    countWrittenRows: async () => 0,
    // 2 秒待たない（本物は setTimeout）。マクロタスクで 1 回譲るだけにして、
    // テスト側が完了フックを呼ぶ隙を作る。
    wait: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
  const send = (line: string): void => {
    calls.lines.push(line);
  };
  return { deps, calls, send, complete: () => onComplete?.({ didError: false }) };
}

/** 条件が立つまでマクロタスクを譲る（worker 起動を待つ）。 */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("waitFor timed out");
}

beforeEach(() => resetBuildIndexForTesting());

describe("build-index — カテゴリ許可リスト（セキュリティ境界）", () => {
  const categories = [{ name: "Smallworld with AI" }, { name: "NAM" }];

  it("スキャン結果に含まれる名前だけを通す", () => {
    assert.equal(isAllowedIndexCategory("Smallworld with AI", categories), true);
    assert.equal(isAllowedIndexCategory("NAM", categories), true);
  });

  it("パス操作の混入を構造的に弾く", () => {
    assert.equal(isAllowedIndexCategory("../../etc", categories), false);
    assert.equal(isAllowedIndexCategory("Smallworld with AI/../NAM", categories), false);
    assert.equal(isAllowedIndexCategory("", categories), false);
    assert.equal(isAllowedIndexCategory(undefined, categories), false);
    assert.equal(isAllowedIndexCategory(42, categories), false);
    // 大文字小文字・前後空白の揺れも別名として弾く（完全一致のみ）。
    assert.equal(isAllowedIndexCategory("smallworld with ai", categories), false);
    assert.equal(isAllowedIndexCategory(" NAM ", categories), false);
  });
});

describe("build-index — PENDING 行のパース", () => {
  it("最終行の PENDING を読む", () => {
    assert.equal(parsePendingCount(["対象 9 件", "PENDING: 6"]), 6);
    assert.equal(parsePendingCount(["PENDING: 0"]), 0);
  });

  it("複数あれば後ろを採る", () => {
    assert.equal(parsePendingCount(["PENDING: 3", "PENDING: 6"]), 6);
  });

  it("欠落・不正は null（pending 不明 ⇒ Phase 2 を実行する）", () => {
    assert.equal(parsePendingCount(["対象 9 件"]), null);
    assert.equal(parsePendingCount([]), null);
    assert.equal(parsePendingCount(["PENDING:"]), null);
    assert.equal(parsePendingCount(["⚠ PENDING: 6"]), null);
  });
});

describe("build-index — 進捗行の組み立て", () => {
  it("差分があるときだけ行を作る", () => {
    assert.equal(buildIndexProgressLine(0, 9, null), "Claude が記入中... (0/9)");
    assert.equal(buildIndexProgressLine(4, 9, 0), "Claude が記入中... (4/9)");
    assert.equal(buildIndexProgressLine(4, 9, 4), null);
  });

  it("pending 不明（total 0）なら分母を出さない", () => {
    assert.equal(buildIndexProgressLine(3, 0, null), "Claude が記入中... (3 件)");
  });
});

describe("build-index — CLI 引数", () => {
  it("scan / apply とも同じ 3 引数を渡す", () => {
    assert.deepEqual(buildIndexScriptArgs("scan", "/ws/data/work/tools/build_index.py", ctx), [
      "/ws/data/work/tools/build_index.py",
      "scan",
      "--work-root",
      "D:\\SW_Doc\\Materials",
      "--category",
      "Smallworld with AI",
      "--staging",
      "/ws/data/work/.index/Smallworld with AI",
    ]);
    assert.equal(buildIndexScriptArgs("apply", "/s.py", ctx)[1], "apply");
  });
});

describe("build-index — 3 フェーズと実行中ガード", () => {
  it("pending があれば worker を起動し、完了フックで apply して DONE・ガード解除", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 9" });
    // Phase 2 の起動後は SSE 観測ループに入り、worker の完了まで返らない
    // （＝ルートは SSE を開いたままにする）ので、await せずに進める。
    const running = runBuildIndex({ ...ctx }, send, deps);
    // 登録は最初の await より前に同期的に行われる（二重 POST が両方走らない）。
    assert.equal(isBuildingIndex(ctx.category), true);
    await waitFor(() => calls.spawns === 1);
    assert.equal(calls.scans, 1);
    // Phase 3 は完了フックの中。まだ走っていない。ガードもまだ立っている。
    assert.equal(calls.applies, 0);
    assert.equal(isBuildingIndex(ctx.category), true);
    await complete();
    await running;
    assert.equal(calls.applies, 1);
    assert.ok(calls.lines.includes("DONE: Smallworld with AI Index.csv"));
    assert.equal(isBuildingIndex(ctx.category), false);
  });

  it("実行中は observeIndexProgress で SSE を開いたまま待つ（Phase 3 完了で抜ける）", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 9" });
    const running = runBuildIndex({ ...ctx }, send, deps);
    await waitFor(() => calls.spawns === 1);
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    await waitFor(() => calls.lines.some((line) => line.startsWith("Claude が記入中...")));
    assert.equal(settled, false, "worker 完了前に SSE を閉じてはいけない");
    await complete();
    await running;
    assert.equal(settled, true);
  });

  it("pending 0 件なら Claude を呼ばず Phase 3 へ直行する", async () => {
    const { deps, calls, send } = makeDeps({ pendingLine: "PENDING: 0" });
    await runBuildIndex({ ...ctx }, send, deps);
    assert.equal(calls.spawns, 0);
    assert.equal(calls.applies, 1);
    assert.ok(calls.lines.includes("DONE: Smallworld with AI Index.csv"));
    assert.equal(isBuildingIndex(ctx.category), false);
  });

  it("pending 不明（PENDING 行なし）でも Phase 2 を実行する", async () => {
    const { deps, calls, send, complete } = makeDeps({});
    const running = runBuildIndex({ ...ctx }, send, deps);
    await waitFor(() => calls.spawns === 1);
    assert.ok(calls.lines.some((line) => line.includes("pending 件数を読めませんでした")));
    await complete();
    await running;
  });

  it("Phase 1 が失敗すればガードを外して終わる（D: 未変更）", async () => {
    const { deps, calls, send } = makeDeps({ scanCode: 2 });
    await runBuildIndex({ ...ctx }, send, deps);
    assert.equal(calls.spawns, 0);
    assert.equal(calls.applies, 0);
    assert.ok(calls.lines.some((line) => line.startsWith("ERROR: 索引の下書き生成に失敗")));
    assert.equal(isBuildingIndex(ctx.category), false);
  });

  it("worker の起動が断られればその文言を見せてガードを外す", async () => {
    const { deps, calls, send } = makeDeps({ pendingLine: "PENDING: 9", launchError: "too many background sessions already in flight (max 4)" });
    await runBuildIndex({ ...ctx }, send, deps);
    assert.ok(calls.lines.includes("ERROR: too many background sessions already in flight (max 4)"));
    assert.equal(calls.applies, 0);
    assert.equal(isBuildingIndex(ctx.category), false);
  });

  it("Phase 3 が exit 3（0 行）でもガードは外れる", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 9", applyCode: 3 });
    const running = runBuildIndex({ ...ctx }, send, deps);
    await waitFor(() => calls.spawns === 1);
    await complete();
    await running;
    assert.ok(calls.lines.includes("ERROR: 書き出す行が 0 件のため D: を変更しませんでした"));
    assert.equal(isBuildingIndex(ctx.category), false);
  });

  it("Phase 3 が想定外の exit でもガードは外れる", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 9", applyCode: 1 });
    const running = runBuildIndex({ ...ctx }, send, deps);
    await waitFor(() => calls.spawns === 1);
    await complete();
    await running;
    assert.ok(calls.lines.some((line) => line.startsWith("ERROR: 索引の反映に失敗")));
    assert.equal(isBuildingIndex(ctx.category), false);
  });
});

describe("build-index — ルートの検証と 409", () => {
  it("category が許可リストに無ければ 400（SSE を開かない）", async () => {
    const mod = (await import("../../server/api/routes/workFiles.js")) as RouteModule;
    const handler = extractRouteHandler(mod, "/api/work/build-index", "post");
    const state: { status: number; body: { error?: string } | undefined; flushed: boolean } = { status: 200, body: undefined, flushed: false };
    const res = {
      status(code: number) {
        state.status = code;
        return res;
      },
      json(payload: { error?: string }) {
        state.body = payload;
        return res;
      },
      setHeader() {
        return res;
      },
      flushHeaders() {
        state.flushed = true;
        return res;
      },
      write() {
        return true;
      },
      end() {
        return res;
      },
      writableEnded: false,
    } as unknown as Response;
    // scanRoot は実際の workRootPath を走査する。存在しない category は
    // どのマシンでも許可リストに入らないので 400 になる。
    await handler({ body: { category: "../../etc" } } as unknown as Request, res);
    assert.equal(state.status, 400);
    assert.match(state.body?.error ?? "", /category/);
    assert.equal(state.flushed, false);
  });
});
