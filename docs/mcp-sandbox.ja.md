# MCP サーバーと Docker サンドボックス

> English: [mcp-sandbox.md](mcp-sandbox.md)

MulmoClaude は、Claude をホストシステムから隔離するために Docker サンドボックス内で実行できます（`DISABLE_SANDBOX=1` を付けない `yarn dev`、または `Settings → Docker sandbox`）。サンドボックスが ON のとき、**stdio MCP サーバーは既定で無効化（drop）されます**。HTTP MCP サーバーは引き続き動作します。唯一の明示的な opt-in である `hostExecInDocker` を使うと、stdio サーバーをホスト側でゲートウェイ越しに動かせるため、Docker 下でも使えます。このページでは、なぜ stdio が既定で drop されるのか、環境変数の渡し方、そして opt-in の仕組みを説明します。**結論だけ知りたい方は下の「短い答え」を読んでください。以降は「なぜ」の説明です。**

## 短い答え: stdio MCP は使えるか

**使えます。Docker サンドボックスが ON でも使えます。コードは不要です。** やることは「Docker サンドボックスが ON か OFF か」だけで決まります（分からなければ `Settings → Docker sandbox` を開いて有効かどうか確認してください）。

**サンドボックス OFF** — 特別なことは不要です。MCP サーバーを追加すれば（Settings → MCP Servers、またはカタログのエントリ）、普通のコンピュータと同じようにそのまま動きます。

**サンドボックス ON** — そのままではサーバーは**起動しません**。横に *「⚠ Docker サンドボックス有効時は起動しません。」* と表示されます。動かすには、一度だけ次の操作を行います:

1. `Settings → MCP Servers` を開き、対象のサーバーを見つける。
2. チェックボックス **「それでもホストで実行する（上級者向け）」** をオンにする。
3. 保存する。これで完了 — サーバーが動き、Claude が使えるようになります。

（ファイルを直接編集したい場合は、代わりに `~/mulmoclaude/config/mcp.json` の該当サーバーのエントリに `"hostExecInDocker": true` を追加します。例は下の「Docker でも stdio MCP を動かす（`hostExecInDocker`）」を参照。）

**オンにする前に理解しておくべき唯一のこと:** このチェックは、**チェックしたサーバーをあなたのコンピュータ上で直接**、Docker の「安全な箱」の外で動かします。箱は他のすべてを引き続き保護し、チェックしたサーバーだけが箱の外に出ます（サーバー単位なので、1 台ずつ判断できます）。したがって、**自分で意図して追加した信頼できるサーバー**（例: 自分の email/IMAP サーバー）にのみオンにしてください。それに抵抗がある場合は、代わりに Docker サンドボックスを丸ごと OFF にします — そうすればすべての stdio サーバーが普通に動きますが、Claude は追加の隔離を失います。

一言で: **stdio はどこでも使える。Docker サンドボックスが ON なら、そのサーバーで「それでもホストで実行する」をオンにするだけ。**

## TL;DR

- **stdio MCP サーバー** は **Claude の子プロセス** として動きます。Claude がサンドボックス化されていると、その子プロセスもサンドボックス内に入ります。サンドボックスのイメージは意図的に最小構成（`node:22-slim` + `claude` + `tsx`）で、ほとんどの stdio MCP は起動により豊富な環境を必要とします。
- **HTTP MCP サーバー** はホスト（またはリモート）で動き、サンドボックス内の Claude はネットワーク越しに通信します。MCP サーバーは本来の環境を保ち、サンドボックスはネットワーク経路を 1 本開けるだけです。
- サンドボックスが ON のとき、MulmoClaude は **セッションごとの MCP 設定から stdio エントリを drop します**。サンドボックスを無効化（`DISABLE_SANDBOX=1`）すればすべて読み込まれます。
- **Opt-in の抜け道**（`"hostExecInDocker": true`）: サンドボックスを ON のまま、stdio サーバーを **ホスト側**で `stdio ↔ HTTP` ゲートウェイ越しに動かし、サンドボックス内エージェントが HTTP で到達できるようにします。**サーバー単位**のフラグで、必要なだけ複数のサーバーに設定でき、opt-in した各サーバーが自分のゲートウェイを持ちます。そのぶんサンドボックスへ意図的に穴を開けるため、UI では明示的なリスク承認の背後に置かれています。下の「Docker でも stdio MCP を動かす（`hostExecInDocker`）」を参照。

## 詳しい説明

### stdio MCP サーバーの仕組み

stdio は MCP の元々のトランスポートです。Claude CLI が MCP サーバーを子プロセスとして spawn し、両者は stdin/stdout 上で JSON-RPC を使って通信します:

```
[Claude CLI] ──spawn──> [MCP server process]
              │
              └── stdin / stdout pipes
                  carrying MCP JSON-RPC
```

MCP サーバーは Claude の環境（カレントディレクトリ、環境変数、Claude から見えるファイルシステム）を継承します。この継承が、以下に挙げる問題すべての原因です。

### なぜサンドボックスは「最小」なのか

サンドボックスイメージには、Claude 自身が動くのに必要なものだけを焼き込んでいます:

- Node.js 22（slim — build-essential、Python、コンパイラなし）
- `claude` バイナリ
- `tsx`（フックのサブプロセスで使用）

これは意図的です。イメージが大きいほど、攻撃対象領域が広がり、pull 時間が延び、コールドスタートが遅くなります。サンドボックスは Claude を **隔離** するために存在します — あらゆるランタイムを追加してしまうと、その目的が損なわれます。

### なぜ stdio MCP サーバーは適合しないのか

Claude がサンドボックス内にいると、それが spawn する stdio MCP サーバーもすべてサンドボックス内に入ります。以下がいっぺんに壊れます:

#### 1. ランタイムが無い

典型的な stdio MCP サーバーの起動:

```
npx -y @modelcontextprotocol/server-memory
```

には Node + npm キャッシュ + npm レジストリへの外向きネットワークが必要です。サンドボックスイメージには Node はありますが、**温まった npm キャッシュは無く**、（ポリシー上）**許可リスト外への外向きネットワークもありません**。最初の `npx -y` は即座に失敗する（ネットワーク無し）か、コールドスタートごとに数百 MB をダウンロードします（ネットワーク有り）。

Python / Ruby / Go / .NET の MCP はそれぞれのランタイムを必要としますが、いずれもイメージにありません。

これを「あらゆるランタイムを同梱する」ことで直そうとすると、数 GB のイメージになり、それでも新しいエントリに追いつけません。隔離という用途では成立しません。

#### 2. ファイルシステムの境界

多くの stdio MCP はホストレベルのファイルシステムアクセスを前提とします:

| MCP | 読み書き |
|---|---|
| `server-memory` | メモリ状態ファイル |
| `server-filesystem` | ユーザーが渡す任意のツリー |
| GitHub MCP | `~/.config/github` のトークン |
| Spotify 系の MCP | 固定のホストパスにある OAuth トークン |

サンドボックスはワークスペース（`~/mulmoclaude/`）だけをマウントします。それ以外は内部からは存在しません。存在するパスでも、読み取り専用か、別の所有者でボリュームマウントされています。ホストでは問題なく動く MCP の多くが、期待するディレクトリが無いために即座に失敗します。

#### 3. 認証

OAuth トークン、`~/.config/...` に保存された API キー、システムのキーチェーン — すべてサンドボックス内からは届きません。MCP は起動しても、最初の認証付きリクエストで失敗して終了します。

#### 4. ネットワークポリシー

MCP サーバーがローカルで動く場合でも、公開インターネット上のサービス（npm、OAuth コールバック、MCP の裏の API）に到達する必要がしばしばあります。サンドボックスのネットワークは、侵害された Claude がデータを持ち出せないように、MulmoClaude サーバーのループバックへ意図的に絞られています。MCP が必要とする外向き通信はブロックされます。

#### 5. プロセスのライフサイクル

サンドボックスのコンテナは一時的です。`~/.npm` キャッシュ、MCP サーバーがディスクに残す副作用、実行間で MCP が頼るものはすべて、コンテナ再起動のたびに消えます。最初のコールドスタートで動いた stdio MCP も、状態が失われるため 2 回目で失敗します。

#### 6. 静かに失敗するモード

Claude CLI 2.1.x は起動時に各 stdio MCP を spawn しようとし、**いずれかの spawn が失敗すると静かに終了コード 1 で終了します**（stderr の行なし）。サンドボックスイメージに MCP が必要とするランタイムが無いと、ユーザーには `[Error] claude exited with code 1` としか表示されません。これが #1334 で見つかった症状です: MCP 設定ライタが、サポートしないと決めていたにもかかわらず stdio エントリをサンドボックスに渡しており、上記の失敗モードが静かに発火していました。

### なぜ HTTP MCP サーバーは動くのか

HTTP MCP は Claude のプロセスツリーを共有しません:

```
[Claude CLI (in sandbox)] ──HTTP via mapped port──> [MCP server (host or remote)]
```

MCP サーバーは本来の環境（フルのファイルシステム、フルのネットワーク、ホストの OAuth トークンなど）に留まります。サンドボックスはネットワーク経路を 1 本開けるだけです。上記の問題はどれも当てはまりません: ランタイムはホスト、ファイルシステムはホスト、認証はいつもの場所、MCP の外向き通信は MCP 自身の管轄です。

このため、HTTP 形式のエントリ（`type: "http"`）や SSE 形式のエントリは Docker 下でも問題ありません。問題になるのは `type: "stdio"` だけです。

### 設計上の判断

理論上の代替案は 2 つありました:

| 選択肢 | トレードオフ |
|---|---|
| **A — 肥大なサンドボックスイメージ** | あらゆるランタイムを焼き込む。イメージは数 GB に膨らみ、攻撃対象領域が広がり、ビルド時間が肥大し、しかもユーザーの `~/.config` には依然アクセスできない — ほとんどの MCP はやはり動きません。サンドボックスの目的を損ないます。 |
| **B — MCP ごとのサイドカーコンテナ** | 各 stdio MCP をホスト側の専用コンテナで spawn し、Claude がネットワーク越しに到達する。これは実質的に HTTP 経路に追加のオーケストレーションを足しただけです。ネットワーク越しに話す時点で、その MCP サーバーは HTTP MCP でよいことになります。 |

どちらも割に合いません。MulmoClaude はよりシンプルな道を採ります: **サンドボックスが ON のとき stdio は既定で drop される**。stdio MCP が必要なユーザーは `DISABLE_SANDBOX=1` で実行するか、HTTP MCP を使うか（ローカルサーバーでも可 — `http://localhost:…` の URL を指すだけ）、下の host-exec の抜け道で 1 サーバーだけ opt-in します。

## Docker でも stdio MCP を動かす（`hostExecInDocker`）

上記の選択肢 B（MCP ごとのホスト側ゲートウェイ）が、明示的なサーバー単位の opt-in として使えます — これが、サンドボックスを ON のまま `npx` ベースの stdio MCP を動かす方法です。判定は **エントリ単位** なので、好きなだけ複数の stdio サーバーを opt-in でき、それぞれが自分のゲートウェイを持ちます。各 stdio エントリに `"hostExecInDocker": true` を設定します（MCP 設定タブのリスク承認チェックボックス、または `mcp.json` を手編集）:

```json
{
  "mcpServers": {
    "imap": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-imap-mcp"],
      "env": { "IMAP_HOST": "imap.example.com", "IMAP_USER": "me", "IMAP_PASS": "secret" },
      "hostExecInDocker": true,
      "enabled": true
    }
  }
}
```

このとき何が起きるか（`server/agent/config.ts` の `prepareUserServers` → `server/agent/stdioHttpShim.ts`）:

1. MulmoClaude は stdio サーバーを **ホスト側で** spawn します — `stdio ↔ HTTP` ゲートウェイ（`supergateway`）で包みます。ホストで動くため、`npx` は Node + ネットワーク + 本物のホームディレクトリを使え、上記のランタイム/ファイルシステム/認証の問題は当てはまりません。
2. Claude に渡すセッションごとの MCP 設定は `type: "http"` に書き換えられ、そのゲートウェイを指します（コンテナ向けに `localhost` → `host.docker.internal`）。サンドボックス内エージェントは、通常の HTTP MCP とまったく同じように HTTP で到達します。
3. ゲートウェイはエージェントのターン終了時に破棄されます。

**これは opt-in した各サーバーについて意図的にサンドボックスを抜け出します。** サンドボックスの目的は隔離であり、host-exec の MCP はあなたのホストの権限で動きます。設定 UI は赤いバッジを表示し、明示的な承認を求めます。信頼できるサーバーにのみ opt-in してください。ゲートウェイの起動に失敗した場合、そのエントリは安全な既定（drop + ログ）にフォールバックします。

## 環境変数の渡し方

stdio エントリは `env` マップを取ります — これがサーバーに認証情報（API キー、IMAP のホスト/ユーザー/パスワードなど）を渡す方法です:

```json
"env": { "IMAP_HOST": "imap.example.com", "IMAP_USER": "me", "IMAP_PASS": "secret" }
```

- **サンドボックス OFF / stdio がホストで動く場合**: 値は spawn された MCP プロセスへそのまま渡されます（Claude CLI 標準の `--mcp-config` の `env`）。
- **`hostExecInDocker: true` の場合**: ゲートウェイはホストのプロセスを `{ ...process.env, ...spec.env }` で spawn します。したがってサーバーは、あなたのホスト環境と、設定した `env` の両方を見ます。
- 値は `mcp.json` 内では **リテラル** です。`${VAR}` のプレースホルダは、設定フォームからカタログのエントリをインストールするときだけ解決されます — 手書きの `mcp.json` にはプレースホルダではなく実値が必要です。
- `mcp.json` はモード `0600` で書かれますが、認証情報はそこに **平文** で存在します — vault ではなく、ファイル権限による保護です。それが気になる場合は、ワークスペースを共有/同期される場所に置かないでください。

## MulmoClaude の実際の挙動

Docker サンドボックスが ON のとき、`~/mulmoclaude/config/mcp.json` の各 MCP エントリに 2 つのことが起きます:

1. `prepareUserServers`（`server/agent/config.ts`）が、書き出すセッションごとの MCP 設定から `type: "stdio"` のエントリを drop します。Claude CLI はそれらを一切見ません — spawn の試行も、静かな終了もありません。
2. `userServerAllowedToolNames`（同ファイル）が、`--allowedTools` の許可リストから同じエントリを drop します。したがって、以前キャッシュされた `mcp__<server>` のツール名が何らかの形で漏れても、CLI はそれを呼ぶことを許可されません。

例外は `"hostExecInDocker": true` です: `prepareUserServers` は、それらのサーバーをホスト側で起動し、drop の *前* に `type: "http"` に書き換えるため、サンドボックス内エージェントが到達できる HTTP エントリとして残ります。

drop ごとに `log.info("mcp", "skipping stdio server in Docker mode", { serverId, transport: "stdio" })` の行が出力され、サーバーログを見る運用者はエントリが読み込まれない理由が分かります。

設定 UI はこれを直接示します: Docker サンドボックスが ON のときに表示される stdio エントリには、警告バッジと、このページへの「詳しく」リンクが付きます。

## 回避策

- **サンドボックスが不要**: `DISABLE_SANDBOX=1 yarn dev` で起動（または設定をトグル）。すべての stdio MCP が普通に読み込まれます。
- **サンドボックスを使いたく、HTTP 版がある**: MCP エントリの `type` を `http` に変え、ローカルサーバーを指します。多くの MCP サーバーは両トランスポートを提供しています。
- **サンドボックスを使いたく、stdio 実装しかない**: エントリに `"hostExecInDocker": true` を設定します（上の「Docker でも stdio MCP を動かす」）。MulmoClaude が stdio サーバーをホスト側でゲートウェイ越しに動かし、設定を HTTP に書き換えてくれます — 手動の shim は不要です。（自分でプロセスを管理したいなら、stdio MCP をホストで動かして自前の HTTP shim を前段に置き、`type: "http"` エントリとして追加する、という手動の方法も引き続き可能です。）

## 関連コード

- `server/agent/config.ts` — `prepareUserServers`、`userServerAllowedToolNames`（drop する箇所）
- `server/agent/index.ts` — `useDocker` を決めて下位に渡す
- `src/components/SettingsMcpTab.vue` — ここにリンクする設定 UI の警告
- `docs/sandbox-credentials.md` — 直交する話題: そもそもシークレットをサンドボックスに入れる方法

## 経緯

- **#162** が Docker サンドボックスを導入し、「サンドボックスイメージはほとんどの MCP を動かすには最小すぎる」というコメントとともに、許可リスト層で stdio の切り出しを確立しました。
- **#1334** が非対称性を捉えました: stdio エントリは依然としてセッションごとの MCP 設定に書き込まれており、Claude CLI がそれらを spawn しようとして silent-exit-1 モードに陥り、ユーザーには役に立たない `[Error] claude exited with code 1` が表示されていました。修正で `prepareUserServers` を許可リストの drop と対称にし、根本的な制約を issue を読み返さずに発見できるよう、この文書が追加されました。
