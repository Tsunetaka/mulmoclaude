# feat: エージェントに Google Calendar ツールを公開 + 未連携時の error-recovery 案内 — #2114

#2110（ローカル OAuth + remote コマンド）/ #2113（設定 UI）の仕上げ。チャットのエージェント（LLM）が連携済み Google Calendar を直接使えるようにし、未連携時は正しい復旧手順を案内できるようにする。

## 設計方針（docs/plugin-development.md 準拠）

- per-feature 連携のデフォルトは **runtime plugin**（`packages/plugins/google-calendar-plugin/`）。
- plugin は host コードを import できないので、**エンジンを `@mulmoclaude/core/google`（server-only subpath）へ移設**するのが前提（#1795 の抽出パターン。#2110/#2113 レビューで defer していた作業）。
- トークン保存（`~/.config/mulmoclaude/google-token.json`）は core が単一の所有者になり、plugin ツール / remote ハンドラ / 設定 UI / CLI の全面が同じ連携状態を共有する。

## Phase A — エンジンの core 移設

1. `server/services/google/{paths,clientSecret,tokenStore,auth,authFlow,calendar}.ts` を `packages/core/src/google/` へ移動。
   - core 内の相対 import（logger / errors / fetch / time / types / files）→ core に既存の相当ユーティリティがあるか確認し、無ければ最小限を core 側に持つ（他 subpath の前例に従う）。
   - `package.json` の exports に `./google` を追加（server-only。`"require"` / `"default"` 条件を含める — Docker CJS 規約）。
2. host 側を core import に切替: `server/remoteHost/handlers/googleCalendar.ts` / `server/api/routes/google.ts` / `authCli`（`yarn google:auth` のパス修正含む）。
3. テスト: `test/services/google/*` は import 先を core に変更してそのまま生かす（挙動は不変のはず）。

## Phase B — google-calendar-plugin（runtime plugin）

4. `npx create-mulmoclaude-plugin google-calendar` でスキャフォールド。
5. MCP ツール定義（docs/plugin-runtime.md + spotify-plugin を参照）:
   - アクション: `listEvents`（timeMin / maxResults）、`createEvent`（summary / start / end / description）。
   - 説明文に「ユーザーがローカルで連携済みの Google Calendar を操作する。連携状態は status で確認できる」ことを明記（エージェントの発見性）。
   - 未連携 / client secret 未配置・複数 / 403 は **明確なエラーメッセージ**で返す（エージェントが error-recovery.md を読んで案内できる形）。
6. Preview / View は最小（作成イベントのリンク、一覧の簡易表示）。
7. role の `availablePlugins`（`src/config/roles.ts`）に追加（対象 role は既存プラグインの前例に従う）。

## Phase C — 未連携時の案内（= help）

8. `packages/core/assets/helps/error-recovery.md` に「Google 連携」節を追加:
   - 未連携 → 設定画面 Plugins → Google で連携、または `yarn google:auth`
   - client secret 未配置 / 複数 → `~/.secrets/client_secret_*.json` を1つ配置
   - HTTP 403 → Cloud Console で Google Calendar API を有効化
9. `@mulmoclaude/core` のバージョンバンプ（assets/helps 変更時の運用ルール。launcher の dep range も lockstep）。

## テスト / 検証

- 既存 50 unit テストが core 移設後もグリーン（import 変更のみ）
- plugin ツールのユニットテスト（エンジンをスタブ、未連携エラー文言含む）
- `yarn build:packages` で tier 4 に自動発見されること
- 実機: チャットで「予定を一覧して」→ ツール呼び出し → 実データ。未連携（トークン退避）で正しい案内が出ること

## 残す判断

- `/api/google` routes と設定タブは host 側のまま（#2113 で出荷済み。plugin の config UI への移設は必要になったら別 issue）
- remote-host ハンドラも host 所有のまま（remote コマンドテーブルは host レコードが規約）
