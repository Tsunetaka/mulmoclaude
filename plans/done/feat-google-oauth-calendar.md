# feat: Google OAuth（ローカル）+ Calendar 連携

> このプランは **mulmoserver 側のセッションから引き継いだ**もの。設計の全体像・根拠は mulmoserver の Issue #51 と `mulmoserver/plans/feat-oauth-google-calendar.md` にある。ここには **mulmoclaude(ローカルホスト) 側でやること**と、既に済んでいる前提をまとめる。

## ゴール

Firebase Auth とは独立した自前 OAuth 2.0 で、**このローカルホスト(mulmoclaude)が Google API を直接叩く**。まず Google Calendar（予定の作成/一覧）。継続利用のため **refresh token をローカル保存**する。トークンはクラウド(mulmoserver)を通さない。

## なぜローカルで持つか（設計の要点）

- Firebase Auth の Google サインインは **refresh token を破棄**し、scope もサインイン用のみ → API アクセスには使えない。だから独立 OAuth。
- refresh token を**中央(クラウド)に貯めると honeypot** になるので、**各ユーザーのローカル(mulmoclaude)に保存**する（gcloud / gh CLI と同じモデル）。
- アクター（トリガー & 実行）は mulmoclaude(ローカル) / ブラウザ。**mulmoserver(クラウド)はトークン非関与**、既存 Firestore コマンドチャネルの中継のみ。

## ✅ 既に済んでいる前提（ユーザーが Google Cloud Console で実施済み）

- Google Cloud プロジェクト **`mulmoserver`**（Firebase と共有）。
- OAuth 同意画面（Google Auth Platform）作成済み。**公開ステータス = 本番環境**。
  - サインイン scope（openid/email/profile）は non-sensitive なので本番でも審査不要で稼働中。
  - **Calendar (`calendar.events`) は sensitive** → 本番で一般公開するなら要審査だが、**オーナー自身のアカウントなら「未確認アプリ」警告をクリックで進めて動く**。個人利用はこれで可。
- **OAuth クライアント（種類: デスクトップアプリ）作成済み**。認証情報 JSON は下記に配置済み:
  - **`~/.secrets/client_secret_830257137330-n2a5c89fttjg65i9dcbrjsq959uk8vnb.apps.googleusercontent.com.json`**
  - 形式は `{ "installed": { client_id, client_secret, redirect_uris:["http://localhost"], token_uri, auth_uri, ... } }`（＝installed/desktop app で正しい）。
  - ⚠️ このファイルは**コミット禁止**（`~/.secrets` は machine-only）。パーミッションは `chmod 600` 推奨。

### ユーザー側の残作業（実装前に確認）
- **Google Calendar API の有効化**: Cloud Console →「API とサービス」→「ライブラリ」→「Google Calendar API」→ 有効にする。（未有効なら初回 API 呼び出しで 403 になるので、そこで気づける。）
- （任意）同意画面「データアクセス」で `.../auth/calendar.events` scope を登録しておくと同意画面が親切。デスクトップアプリはコードから scope 要求すれば動くので必須ではない。

## 依存関係

- **`google-auth-library` は既に node_modules にある**（`OAuth2Client` を使う）。
- `googleapis` は**不要**（Calendar は REST を fetch で叩けば足りる）。使いたければ追加してもよいが、依存を増やさない方針なら fetch で。

## 実装（mulmoclaude 側）

### 1. OAuth ローカルフロー（loopback + PKCE）
- `google-auth-library` の `OAuth2Client` を、`~/.secrets/client_secret_*.json` の `installed` から生成。
- **loopback リダイレクト**: `http://127.0.0.1:<空きポート>` で一時 HTTP サーバを立て、redirect_uri に指定（installed app は任意ポートの loopback が許可される）。
- `generateAuthUrl({ access_type: "offline", prompt: "consent", scope: ["https://www.googleapis.com/auth/calendar.events"], code_challenge_method: "S256", code_challenge })` で **PKCE 付き認可 URL**を作り、ブラウザで開く。
  - **`login_hint` に Firebase でログイン中のメール**を渡すと、同一 Google アカウントが自動選択されて UX が良い（トークンは別管理のまま）。
- コールバックで `code` 受領 → `getToken({ code, codeVerifier })` → **access + refresh token** 取得。
- 初回は `access_type:offline` + `prompt:consent` で **refresh_token が必ず返る**ようにする（2回目以降は返らないことがあるため、保存済みを再利用）。

### 2. トークンのローカル保存
- 保存先: `~/.config/mulmoclaude/google-token.json`（または本リポの既存 secrets 保存規約に合わせる。CLAUDE.md / config/ を確認）。
- パーミッション **600**。リポジトリにコミットしない（`.gitignore` 済みの場所へ）。
- 保存する内容: refresh_token（必須）、access_token、expiry。
- **失効経路**: 必要なら Google の revoke endpoint（`https://oauth2.googleapis.com/revoke`）を叩くコマンドも用意。

### 3. アクセストークンのリフレッシュ
- API 呼び出し前に期限切れなら `OAuth2Client` が refresh_token で自動更新（`client.on("tokens", ...)` で新しい access/refresh を保存し直す）。

### 4. Calendar API（最初のコマンド）
- `google.calendar.createEvent`: `POST https://www.googleapis.com/calendar/v3/calendars/primary/events`（`Authorization: Bearer <access>`）。body 例: `{ summary, start:{dateTime}, end:{dateTime} }`。
- `google.calendar.listEvents`: `GET .../events?timeMin=...&maxResults=...`。
- まず **CLI かテストスクリプトで「自分のカレンダーに予定が1件入る」ことを疎通確認**（Phase 0）。

### 5. コマンドハンドラ登録（remote→host 連携）
- host のコマンドテーブルに `google.calendar.createEvent` / `listEvents` を追加し、mulmoserver の remote から **既存 Firestore コマンドチャネル**経由で起動できるようにする（実行はローカルの token）。
- host の presence capabilities に `google-calendar` を載せ、remote 側が「連携済みか」を判定できるように（mulmoserver 側 UI がこれを見る）。

## Phase 0 の最短疎通（推奨の入り方）

大きなモノレポにいきなり組み込む前に、**単体スクリプトで疎通**を取る:
1. `~/.secrets/client_secret_*.json` を読む短い Node スクリプト（`google-auth-library` の `OAuth2Client`）。
2. loopback + PKCE でブラウザ認可 → refresh 保存。
3. `calendar.events.insert` で「テスト予定」を1件作成 → 実際にカレンダーに入るか確認。
4. 期限切れ後もリフレッシュで継続できるか確認。
→ 疎通できたら、上記 5 のハンドラとして本体に組み込む。

## Calendar 以外で「簡単に足せる」Google API（横展開・後続）

同じ desktop OAuth（loopback+PKCE）でそのまま。**restricted（CASA 必須）は避ける**。scope を追加要求するだけで増やせる（テストユーザー/オーナーは再同意が必要）。

| API | scope | 用途 | 難度 |
|---|---|---|---|
| Calendar（本命） | `calendar.events` | 予定 作成/一覧 | ★ |
| Tasks | `tasks` | ToDo 追加/一覧/完了 | ★（REST が薄い） |
| Contacts(People) | `contacts.readonly` | 連絡先/プロフィール取得 | ★ |
| Drive（アプリ作成分） | `drive.file` | 自作ファイルの読み書き（全体でない＝restricted 回避） | ★★ |
| Sheets | `spreadsheets` | シート読み書き | ★★ |
| Docs | `documents` | ドキュメント読み書き | ★★ |
| ~~Gmail 送信~~ | ~~`gmail.send`~~ | restricted（CASA）→ 当面見送り | — |

- 実装は host の薄いコマンド `google.<api>.<action>` を並べるだけ。scope は使うものだけ追加。

## セキュリティ / 注意

- **中央にトークンを貯めない**ので集中 honeypot は無い。守るのはローカルの refresh token（600 パーミッション / できれば OS キーチェーン）。
- **client secret / token はコミットしない**（`~/.secrets`, `~/.config/mulmoclaude/` に）。
- **scope 最小化**（`calendar.events` から）で被害範囲を限定。restricted は使わない。

## 参考

- mulmoserver Issue #51（設計・スコープ整理の本体）
- mulmoserver `plans/feat-oauth-google-calendar.md`（クラウド側 + Console 手順）
- [OAuth 2.0 for Installed/Desktop apps（loopback + PKCE）](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Calendar API events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
