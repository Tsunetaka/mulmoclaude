// Unit tests for the glossary CSV build route in
// server/api/routes/workFiles.ts — POST /api/work/build-glossary（「用語集作成」ボタン）。
//
// 索引作成（build-index）と用語集作成は同型の 3 フェーズ
// （python scan → hidden agent worker → python apply）で、実装は `StagedCsvBuildSpec`
// を差し替えた同一の実行器を共有する。したがってここで固定したいのは
// **共有しても壊れない部分**である:
//
//   ① 用語集固有の SSE 文言が出る（索引の文言が混ざらない）
//   ② 実行中ガードが索引と**独立**している（片方が走っても他方は 409 にならない）
//   ③ 3 フェーズの順序・ガード解除は索引と同じ保証を持つ
//
// ②は共通化で最も壊しやすいところ。spec ごとに別の Set を持つ設計を固定する。
//
// 実エージェント・実 python は動かさない（BuildIndexDeps を丸ごと差し替える）。

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";

import {
  diffReleasedPptx,
  hasReleasedArtifacts,
  isBuildingGlossary,
  isBuildingIndex,
  isSafeReleasedCsvFilename,
  resetBuildGlossaryForTesting,
  resetBuildIndexForTesting,
  runBuildGlossary,
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
  staging: "/ws/data/work/.glossary/Smallworld with AI",
  stagingRel: "data/work/.glossary/Smallworld with AI",
};

/** Injected deps: scan reports `pendingLine` terms, the worker launch is
 *  captured (never launched), apply exits with `applyCode`. */
function makeDeps(options: { pendingLine?: string; scanCode?: number; applyCode?: number; launchError?: string } = {}) {
  const calls = { scans: 0, applies: 0, spawns: 0, messages: [] as string[], lines: [] as string[] };
  let onComplete: ((outcome: { didError: boolean }) => void | Promise<void>) | undefined;
  const deps: BuildIndexDeps = {
    runScript: async (subcommand) => {
      if (subcommand === "scan") {
        calls.scans += 1;
        const lines = ["前回の用語集がありません。全 pptx を対象にします。", "D: をスキャン: Smallworld with AI（対象 WD 3 件）"];
        if (options.pendingLine !== undefined) lines.push(options.pendingLine);
        return { code: options.scanCode ?? 0, lines };
      }
      calls.applies += 1;
      return { code: options.applyCode ?? 0, lines: ["用語集を書き出しました: 57 語（新規 57 / 改訂 0）"] };
    },
    spawnWorker: async (args) => {
      calls.spawns += 1;
      calls.messages.push(args.message);
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

beforeEach(() => {
  resetBuildGlossaryForTesting();
  resetBuildIndexForTesting();
});

describe("build-glossary — CSV 成果物の名前ガード（セキュリティ境界）", () => {
  it("ReleasedVersion 直下の CSV を通す", () => {
    for (const ok of ["SWLESSON-90001 用語集_20260830_v001.csv", "Glossary.csv", "a.CSV"]) {
      assert.ok(isSafeReleasedCsvFilename(ok), ok);
    }
  });

  it("パス操作・隠しファイル・pptx を弾く", () => {
    for (const bad of ["../x.csv", "a/b.csv", "a\\b.csv", ".hidden.csv", "..csv", "deck.pptx", "HISTORY.md", ""]) {
      assert.equal(isSafeReleasedCsvFilename(bad), false, bad);
    }
  });
});

describe("ReleasedVersion 同期 — CSV 成果物だけの WD（用語集）の扱い", () => {
  // 回帰の元: `release-to-windows` が用語集 WD で `copied: []` を返して空振りしていた。
  // 原因は「WSL の pptx が 0 件なら何もしない」の安全弁が、HISTORY.md / CSV のコピーより
  // 前にあったこと。用語集 WD は pptx を永久に持たないので、永遠に到達しなかった。
  it("pptx が 0 件でも CSV があれば同期する（空振りの原因を塞ぐ）", () => {
    assert.equal(hasReleasedArtifacts(0, 1), true, "用語集 WD：CSV だけでも同期する");
    assert.equal(hasReleasedArtifacts(3, 0), true, "通常の WD：pptx だけでも同期する");
    assert.equal(hasReleasedArtifacts(2, 1), true);
  });

  it("pptx も CSV も無ければ何もしない（相手を温存する安全弁は残す）", () => {
    assert.equal(hasReleasedArtifacts(0, 0), false);
  });

  it("source 側の pptx が 0 件なら削除方向を立てない（CSV だけの WD で pptx を消させない）", () => {
    // 「D: に pptx が無い」ことを理由に WSL 側の pptx を消してはいけない。
    const diff = diffReleasedPptx([], [{ name: "keep.pptx", mtimeMs: 100 }]);
    assert.deepEqual(diff.toCopy, []);
    assert.deepEqual(diff.toDelete, [], "pptx 0 件の相手を根拠に削除してはいけない");
  });

  it("pptx が 1 件でもあれば従来どおり完全一致方向（削除あり）で差分を取る", () => {
    const diff = diffReleasedPptx([{ name: "new.pptx", mtimeMs: 200 }], [{ name: "old.pptx", mtimeMs: 100 }]);
    assert.deepEqual(diff.toCopy, ["new.pptx"]);
    assert.deepEqual(diff.toDelete, ["old.pptx"]);
  });
});

describe("build-glossary — 3 フェーズと用語集固有の文言", () => {
  it("pending があれば worker を起動し、完了フックで apply して DONE・ガード解除", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 3" });
    const running = runBuildGlossary({ ...ctx }, send, deps);
    // 登録は最初の await より前に同期的に行われる（二重 POST が両方走らない）。
    assert.equal(isBuildingGlossary(ctx.category), true);
    await waitFor(() => calls.spawns === 1);
    assert.equal(calls.scans, 1);
    // Phase 3 は完了フックの中。まだ走っていない。ガードもまだ立っている。
    assert.equal(calls.applies, 0);
    await complete();
    await running;
    assert.equal(calls.applies, 1);
    assert.ok(
      calls.lines.some((line) => line.startsWith("DONE:") && line.includes("SWLESSON-90001 用語集")),
      calls.lines.join(" / "),
    );
    assert.equal(isBuildingGlossary(ctx.category), false);
  });

  it("Phase 2 は build-glossary スキルにステージングの相対パスを渡す", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 3" });
    const running = runBuildGlossary({ ...ctx }, send, deps);
    await waitFor(() => calls.spawns === 1);
    assert.equal(calls.messages[0], '/build-glossary "data/work/.glossary/Smallworld with AI"');
    await complete();
    await running;
  });

  it("Phase 1 の失敗文言は「用語集」を名乗る（索引の文言を流用しない）", async () => {
    const { deps, calls, send } = makeDeps({ scanCode: 2 });
    await runBuildGlossary({ ...ctx }, send, deps);
    assert.equal(calls.spawns, 0);
    assert.equal(calls.applies, 0);
    assert.ok(
      calls.lines.some((line) => line.startsWith("ERROR: 用語集の下書き生成に失敗")),
      calls.lines.join(" / "),
    );
    assert.equal(isBuildingGlossary(ctx.category), false);
  });

  it("Phase 3 が exit 3（0 語）なら D: を変更しない旨を出してガードを外す", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 3", applyCode: 3 });
    const running = runBuildGlossary({ ...ctx }, send, deps);
    await waitFor(() => calls.spawns === 1);
    await complete();
    await running;
    assert.ok(calls.lines.includes("ERROR: 書き出す語が 0 件のため D: を変更しませんでした"));
    assert.equal(isBuildingGlossary(ctx.category), false);
  });

  it("Phase 3 が想定外の exit でもガードは外れる", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 3", applyCode: 1 });
    const running = runBuildGlossary({ ...ctx }, send, deps);
    await waitFor(() => calls.spawns === 1);
    await complete();
    await running;
    assert.ok(calls.lines.some((line) => line.startsWith("ERROR: 用語集の反映に失敗")));
    assert.equal(isBuildingGlossary(ctx.category), false);
  });

  it("pending 0 件なら Claude を呼ばず Phase 3 へ直行する", async () => {
    const { deps, calls, send } = makeDeps({ pendingLine: "PENDING: 0" });
    await runBuildGlossary({ ...ctx }, send, deps);
    assert.equal(calls.spawns, 0);
    assert.equal(calls.applies, 1);
    assert.equal(isBuildingGlossary(ctx.category), false);
  });
});

describe("build-glossary — 実行中ガードは索引と独立（共通化の回帰ガード）", () => {
  it("用語集が実行中でも索引は実行中でない（Set を共有していない）", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 3" });
    const running = runBuildGlossary({ ...ctx }, send, deps);
    await waitFor(() => calls.spawns === 1);
    assert.equal(isBuildingGlossary(ctx.category), true);
    assert.equal(isBuildingIndex(ctx.category), false, "用語集の実行が索引のボタンを 409 で塞いではいけない");
    await complete();
    await running;
  });

  it("索引が実行中でも用語集は実行中でない", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 9" });
    const running = runBuildIndex({ ...ctx }, send, deps);
    await waitFor(() => calls.spawns === 1);
    assert.equal(isBuildingIndex(ctx.category), true);
    assert.equal(isBuildingGlossary(ctx.category), false);
    await complete();
    await running;
  });

  it("片方のリセットが他方のガードを消さない", async () => {
    const { deps, calls, send, complete } = makeDeps({ pendingLine: "PENDING: 3" });
    const running = runBuildGlossary({ ...ctx }, send, deps);
    await waitFor(() => calls.spawns === 1);
    resetBuildIndexForTesting();
    assert.equal(isBuildingGlossary(ctx.category), true);
    await complete();
    await running;
  });
});

describe("build-glossary — ルートの検証", () => {
  it("ルートが登録されている", async () => {
    const mod = (await import("../../server/api/routes/workFiles.js")) as RouteModule;
    assert.ok(extractRouteHandler(mod, "/api/work/build-glossary", "post"));
  });

  it("category が許可リストに無ければ 400（SSE を開かない）", async () => {
    const mod = (await import("../../server/api/routes/workFiles.js")) as RouteModule;
    const handler = extractRouteHandler(mod, "/api/work/build-glossary", "post");
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
