# fix: e2e-live L-31 / L-FRESH-BOOT が Docker on で誤検知する

## 背景

`/e2e-live` を Docker on / off の両モードで回したところ、Docker on のときだけ
`skills` の **L-31**（`「skill 化して」` → `data/skills/<slug>/SKILL.md` Write）と
`fresh-boot` の **L-FRESH-BOOT** が落ちる現象を確認した。pw による実機再現で、
どちらも**製品ではなくテスト側の問題**であることを特定した。

## 根本原因

### L-31 — Write パスの絶対パス完全一致が Docker mount prefix を考慮していない

`stagingSkillSlugFromWriteCall`（`e2e-live/fixtures/live-chat.ts`）は、agent の
`Write` の `file_path` が `<workspace>/data/skills/<slug>/SKILL.md` か判定する際、
`candidate === resolveWorkspacePath(...)` で **host 絶対パス完全一致**を要求していた。

- Docker off: agent は host 上で動くので `file_path` は host root 配下 → 一致 → pass。
- Docker on: agent は sandbox 内で動き、workspace は `/home/node/mulmoclaude`
  （`CONTAINER_WORKSPACE_PATH`）に bind-mount される。よって `file_path` は
  `/home/node/mulmoclaude/data/skills/<slug>/SKILL.md` となり、host 絶対パスと
  **prefix が違う**ため不一致 → fail。

実機確認: agent のツール列は `Skill → Skill → Write(/home/node/mulmoclaude/data/skills/<slug>/SKILL.md)` で、
**SKILL.md は staging に正しく書けており skill も生成される**が、テストの絶対パス比較が落としていた。

### L-FRESH-BOOT — 汚染検査が並走する兄弟テストの書き込みを誤検知

`fresh-boot.spec.ts` は隔離サーバ起動の前後で host workspace の mtime を比較し、
「隔離サーバが host を汚染していないこと」を検証する。だが e2e-live は既定で
並列実行（`E2E_LIVE_WORKERS=3`）するため、**他の spec がメイン dev サーバ経由で
同じ host workspace（sessions / artifacts / `.claude/skills` / server log）に
正当に書き込む**。隔離テストの検査窓と時間的に重なると「汚染」と誤検知する。
単体（`--workers=1`）で回すと pass することを実機で確認済み。

## 修正方針

### L-31
- パス判定の純粋ロジックを `e2e-live/fixtures/staging-skill-path.ts` に抽出
  （`@playwright/test` 非依存にして単体テスト可能にする）。
- **host root か sandbox root（`CONTAINER_WORKSPACE_PATH`）配下のどちらか**なら hit。
  workspace 外への write を弾く false-positive ガードは維持。
- `live-chat.ts` は新ヘルパーに委譲。
- `test/e2e-live/test_staging_skill_path.ts` で host / sandbox / 相対 / `.claude/skills`
  拒否 / 非 SKILL.md 拒否 / workspace 外拒否 / 長すぎ slug 拒否 を網羅。

### L-FRESH-BOOT
- 汚染アサート（`assertHostUntouched`）は**隔離実行時のみ強制**にゲート:
  `testInfo.config.workers === 1` もしくは `E2E_LIVE_FRESH_BOOT_STRICT=1`。
- 並列時は skip し、その旨を `testInfo.annotations` に残す。
  検査を本当に効かせたいときは `--workers=1`（または env opt-in）で回す。

## 変更ファイル

- 追加: `e2e-live/fixtures/staging-skill-path.ts`
- 追加: `test/e2e-live/test_staging_skill_path.ts`
- 変更: `e2e-live/fixtures/live-chat.ts`（ロジックをヘルパーへ委譲）
- 変更: `e2e-live/tests/fresh-boot.spec.ts`（汚染アサートを隔離時ゲート）

## 検証

- `yarn test`（新 unit test 含む）/ `yarn lint` / `yarn typecheck`。
- L-31 は実機（Docker on / off）で pass を確認する想定。
- L-FRESH-BOOT は並列 full-suite で誤検知しなくなり、`--workers=1` で汚染検査が効くことを確認する想定。

## レビューで確認したい点

- L-FRESH-BOOT のゲートにより、既定の並列 full-suite では汚染検査が skip される。
  ただし専用スクリプト `yarn test:e2e:live:fresh-boot` は `E2E_LIVE_FRESH_BOOT_STRICT=1`
  を立てる（fresh-boot specs のみ選択＝host を書く兄弟がいないので強制が健全）ため、
  単体実行では汚染検査が引き続き効く。`--workers=1` の full-suite 実行でも効く。
  この coverage 配分が許容範囲か（full 並列だけ skip）を確認したい。
- 本 PR は **test ファイルのみ**（`server/` 非変更）。sandbox mount パス
  `/home/node/mulmoclaude` は `server/agent/config.ts` の `CONTAINER_WORKSPACE_PATH`
  と同値だが、テスト fixture 内にローカル定数として複製している（`config.ts` を
  import すると重い依存グラフを引き込みユニットテストが壊れるため）。この重複が
  許容範囲か（将来 config.ts 側が変わったら追従が必要）を確認したい。
