# feat: 設定画面に Google 連携 UI（OAuth 開始 / 状態表示 / 解除）— #2111

PR #2110（`plans/done/feat-google-oauth-calendar.md`）で入れた Google OAuth（loopback + PKCE）のトリガーは CLI（`yarn google:auth`）のみ。設定画面から連携・状態確認・解除できるようにする。

## サーバ側

### 1. 認可フロー管理 `server/services/google/authFlow.ts`（新規）

`authorizeGoogle()` は「同意完了まで resolve しない」ので、HTTP から使うには in-flight 管理が要る:

- `startAuthorizeFlow(): Promise<{ authUrl: string }>` — `authorizeGoogle({ onAuthUrl })` を待たずに起動し、`onAuthUrl` で受けた URL を即返す。完了/失敗はモジュール内状態（`pending` / `lastError`）に記録。実行中の再呼び出しは同じ authUrl を返す（多重フロー禁止）。
- `authFlowStatus(): { pending: boolean; lastError?: string }`
- 完了時のトークン保存は `authorizeGoogle()` 内の既存処理のまま。

### 2. 解除 `server/services/google/tokenStore.ts` 拡張

- `deleteGoogleTokens(home?)` を追加。
- revoke: `POST https://oauth2.googleapis.com/revoke`（form-encoded、refresh_token）。ベストエフォート（失敗してもローカル削除は実行）。`fetchWithTimeout` 使用。

### 3. API route `server/api/routes/google.ts`（新規、remoteHost.ts のパターン踏襲）

| Route | 内容 |
|---|---|
| `GET /api/google/status` | `{ linked, pending, clientSecretFound, lastError? }` — linked = refresh_token 保存済み、clientSecretFound = `~/.secrets/client_secret_*.json` 有無（未配置ガイド用） |
| `POST /api/google/authorize` | フロー起動 → `{ authUrl }`。ブラウザ側で `window.open(authUrl)`（サーバとブラウザが同一マシンなので loopback リダイレクトが成立する。リモートブラウザ利用時は不成立 — 既知の制約として docs に明記） |
| `POST /api/google/unlink` | revoke（ベストエフォート）+ トークンファイル削除 → `{ linked: false }` |

- `src/config/apiRoutes.ts` に `google: { status, authorize, unlink }` を追加。
- Router 登録は既存 routes の mount 箇所に追随。bearer ガードは既定のまま（認可 URL 自体は秘密ではないが、フロー起動をローカル UI に限定）。

## フロントエンド

### 4. `src/components/SettingsGoogleTab.vue`（新規、SettingsMapTab.vue の形を踏襲）

- 状態表示: 連携済み（アカウント解除ボタン）/ 未連携（連携ボタン）/ client secret 未配置（配置手順の説明文）
- 連携: `apiPost(authorize)` → `window.open(authUrl)` → `status` をポーリング（数秒間隔、タイムアウトあり）→ linked になったら表示更新
- 解除: 確認 → `apiPost(unlink)` → 表示更新
- `data-testid`: `settings-tab-google` は既存規約で自動、`google-link-status` / `google-connect-button` / `google-unlink-button`（docs/ui-cheatsheet.md の規約確認の上）

### 5. SettingsModal への登録

- `GROUPS` の適切なグループに `google` タブ追加（`TabId` 型 / `settingsModal.tabs.google`）。

### 6. i18n（docs/i18n.md — 8ロケール lockstep）

- `settingsModal.tabs.google` + `settingsGoogleTab.*`（タイトル、状態、ボタン、client secret ガイド、エラー）を `en/ja/zh/ko/es/pt-BR/fr/de` 全てに同一 PR で追加。

## テスト

- unit（node:test、外部 API モック）: authFlow の in-flight 管理（多重起動 / 完了 / 失敗）、`deleteGoogleTokens`、revoke ベストエフォート、status 判定
- e2e（mock、e2e/）: 設定モーダルに google タブが出る / 未連携表示 / 連携ボタン押下で authorize が呼ばれる（API モック）

## ドキュメント

- `docs/remote-host.md` の `yarn google:auth` 言及箇所に「設定画面からも可」を追記。

## 残す判断（issue #2111 に記載済み）

- Google エンジンの plugin / core 抽出は本 PR ではやらない（CodeRabbit と合意済みの defer。LLM ツール面を作る時に実施）。
- リモートブラウザ（サーバと別マシン）からの連携開始は非対応（loopback が host 側で立つため）。CLI (`yarn google:auth`) が代替。
