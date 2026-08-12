# 作業ファイル選択画面「索引作成」ボタン — 実装仕様

**Status**: 実装済み（D: への実書き込みだけ手動テスト待ち — §8.3 / `docs/manual-testing.md` §13）
**Owner**: 小町谷さん
**Last updated**: 2026-08-12

実装時の確認結果:

- §1 の前提はすべて成立（D: 直読み可・pptx 直読み可・サンドボックスからは D: 書き込み不可・
  サンプル CSV は BOM なし/CRLF/末尾改行なし）。§1.3 の WD 数だけ 14 → **13** に変わっていたが、
  行が立つのは変わらず **9 件**（`scan` は動的に数えるので影響なし）。
- `build_index.py --selftest` と `test/routes/test_workFilesBuildIndex.ts` は全通。
  実 D: に対する `scan` も実行し、9 行の `draft.csv` と 9 本の brief（計 3.5 万字）が
  約 1 秒で出ることを確認した。
- **`apply` の D: への書き込みだけはサンドボックスから実行できない**（読み取り専用）。
  ホストのサーバープロセス経由＝ボタン押下での手動確認が必要。

作業ファイル選択画面（`WorkFileSelectorView.vue`）のサブフォルダ（カテゴリ）見出し行に
`[索引作成]` ボタンを新設し、押下でそのサブフォルダ直下に
`<サブフォルダ名> Index.csv` を生成する。AppSheet 側の教材ポータルが読む索引データを、
D: 上の教材フォルダから自動生成するのが目的。

CSV の 8 列のうち 6 列は機械的に決まり、`Description` と `Tags` の 2 列だけは
資料の内容を読んで書く必要がある。したがってこの機能は
**python ツール（機械列）＋ hidden agent worker（Claude が書く 2 列）** の
2 レイヤ構成になる。

---

## 0. 確定した設計判断（2026-08-12 小町谷さん）

| # | 論点 | 決定 |
|---|---|---|
| 1 | `Category` 列の値 | **ドキュメント ID の英字大文字部**（`CLAUDE` / `GIT` / `SWAI` / `GOOGLE` / `MULMO`）。サンプル CSV の `Git` / `生成AI` 風の表示名は採らない |
| 2 | Claude の関与のさせ方 | **裏でエージェント実行（ワンクリック）**。チャットへは遷移せず、モーダルに進捗を出す |
| 3 | 対象 0 件のカテゴリ | **ボタンを無効化**し tooltip に理由を出す。D: には何も書かない |
| 4 | 2 回目以降の `Description` / `Tags` | **`Training_ID` 一致で引き継ぎ、差分だけ Claude が書く** |

---

## 1. 実測した前提（2026-08-12 時点）

設計の根拠。実装時に前提が崩れていないか確認すること。

### 1.1 D: へのアクセス権

- 画面のスキャンは既に `/mnt/d` 経由で D: を直読みしている
  （`server/api/routes/workFiles.ts:266` `scanRoot()`、`workRootPath` 既定 `D:\SW_Doc\Materials`）。
  カテゴリ／WD／`ReleasedVersion` の列挙はそのまま流用できる。
- **サーバプロセス（WSL ホスト・非サンドボックス）は D: に書ける。**
  既存の `pushReleasedToWindows()`（`workFiles.ts:877`）が実際に D: へコピーしている。
- **エージェント（サンドボックス内）からは D: は読み取り専用**。書き込みプローブは
  `読み込み専用ファイルシステム` で失敗した。
  → **Claude は D: に一切触らない。ワークスペース側のステージングにだけ書き、
    D: への反映はサーバが行う。** これは既存のリリース逆同期と同じ役割分担。

### 1.2 pptx の直読み — 可能。DocumentLayouts.md は主情報源にしない

- ホストに `python-pptx 1.0.2` があり、D: 上の pptx をそのまま開けた。
- カテゴリ「Smallworld with AI」の対象 9 本を全部開いて全テキストを抽出して **0.76 秒 / 46,038 文字**。

  | pptx | 頁数 | 抽出文字数 |
  |---|---|---|
  | CLAUDE-00001 …_v003 | 43 | 22,064 |
  | CLAUDE-00002 …_v001 | 25 | 5,535 |
  | CLAUDE-00003 …_v002 | 21 | 4,555 |
  | GIT-00001 …_v015 | 12 | 1,871 |
  | GIT-00002 …_v005 | 11 | 1,445 |
  | GIT-00003 …_v004 | 13 | 2,104 |
  | GIT-00004 …_v005 | 17 | 1,661 |
  | SWAI-00001 …_v002 | 8 | 2,315 |
  | SWAI-00003 …_v001 | 25 | 4,488 |

- `DocumentLayouts.md` は**レイアウト指示書**で要約向きではなく（CLAUDE-00001 は 1,120 行）、
  さらに**行が立つ 9 WD のうち SWAI-00001 には存在しない**。
  → **pptx 本文抽出を主情報源、`DocumentLayouts.md` / `ProjectInformation.md` を補助**とする。

### 1.3 対象データの分布 — 行が立つのは 1 カテゴリだけ

| カテゴリ | WD 数 | `ReleasedVersion` の pptx | CSV 行数 |
|---|---|---|---|
| **Smallworld with AI** | 14 | 24 本 | **9** |
| NAM | 5 | 0 | 0（ボタン無効） |
| Spatial Eye | 21 | 0 | 0（ボタン無効） |
| バングラデシュ | 5 | 0 | 0（ボタン無効） |
| セミナー | 3 | 0 | 0（ボタン無効） |
| 名古屋 | 2 | 0 | 0（ボタン無効） |
| 組織運営 / Test | 各 1 | 0 | 0（ボタン無効） |

Smallworld with AI 以外は会議録画系 WD（`GWCALC-00001  2026-05-28` のように
「タイトル」相当が日付、中身は `.mp4` / `.docx`）で、教材 pptx の体系ではない。
決定 3 によりこれらのボタンは無効化されるので、日付がタイトル欄に入る問題は発生しない。

### 1.4 サンプル CSV のバイト形式

`/mnt/d/SW_Doc/Materials/Smallworld with AI/Smallworld with AI Index.csv`

- UTF-8 **BOM なし**
- 改行 **CRLF**
- **末尾改行なし**

この 3 点に合わせる（Excel/AppSheet 側の既存挙動を変えないため）。
なお同ファイルの**値**は仕様書と矛盾している（`Category` が `Git` / `生成AI`、
`Textbook` が `Files/…`）。モックと理解し、**列の並びだけを正**として扱う。

---

## 2. 生成物

### 2.1 出力先とファイル名

```
<workRootPath>\<カテゴリ>\<カテゴリ> Index.csv
例: D:\SW_Doc\Materials\Smallworld with AI\Smallworld with AI Index.csv
```

既存があれば上書き（決定 4 の引き継ぎを行ってから）。

### 2.2 バイト形式

- エンコーディング: UTF-8、**BOM なし**
- 改行: **CRLF**
- **末尾改行なし**
- クォート: RFC4180 の最小クォート（`,` `"` CR LF を含む場合のみ `"` で囲み、`"` は `""`）。
  `csv.writer(f, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)` で書き、最後の CRLF を落とす。
- 行順: **`Training_ID` 昇順**（英字接頭辞の辞書順 → 数値部の数値順）。
  ヘッダは 1 行目固定:
  `Training_ID,Version,Category,Title,Description,Textbook,Study_Materials,Tags`

### 2.3 列仕様

| # | 列 | 生成 | 規則 |
|---|---|---|---|
| 1 | `Training_ID` | 自動 | 採用した pptx ファイル名の先頭トークン（`^[A-Z]+-\d+`）。WD フォルダ名の ID と食い違う場合は**フォルダ側を採用**し警告行を出す（アプリ全体が WD フォルダの ID をキーにしているため） |
| 2 | `Version` | 自動 | ファイル名の `_v…` 部分をそのまま（`v003`）。枝番付き（`_v001-002.pptx`）なら `v001-002` を verbatim |
| 3 | `Category` | 自動 | `Training_ID` の先頭英字大文字部（`CLAUDE-00001` → `CLAUDE`） |
| 4 | `Title` | 自動 | ファイル名の `{ID} ` の後ろから `_YYYYMMDD_v…`（無ければ `_v…`）の前まで。前後空白 trim |
| 5 | `Description` | **Claude** | 資料内容に基づく 1 行サマリ。改行禁止。全角 30〜60 文字目安 |
| 6 | `Textbook` | 自動 | 採用した pptx の `SW_Doc` 始まりスラッシュ区切り相対パス（§2.4） |
| 7 | `Study_Materials` | 自動 | `<WD>/StudyMaterials/` 直下のファイル 1 本の同形式パス。0 件なら空欄（§2.5） |
| 8 | `Tags` | **Claude** | `#タグ名` をスペース区切りで 5 個程度（§4.3） |

### 2.4 `SW_Doc` 相対パスの導出

Windows パスを `\` → `/` に正規化し、**`SW_Doc` という名前のセグメントから後ろを切り出す**。

```
D:\SW_Doc\Materials\Smallworld with AI\CLAUDE-00001 Claude 私はこんな風に使ってます\ReleasedVersion\CLAUDE-00001 Claude 私はこんな風に使ってます_20260811_v003.pptx
  ↓
SW_Doc/Materials/Smallworld with AI/CLAUDE-00001 Claude 私はこんな風に使ってます/ReleasedVersion/CLAUDE-00001 Claude 私はこんな風に使ってます_20260811_v003.pptx
```

`SW_Doc` セグメントが存在しない（`workRootPath` が将来 `SW_Doc` 配下から外れた）場合は
**ドライブルートからの相対パス**にフォールバックし、警告行を出す。

### 2.5 `Study_Materials` の選定

- `<WD>/StudyMaterials/` **直下のみ**（再帰しない）、**ファイルのみ**。
- 除外: ドットファイル、`desktop.ini`、`Thumbs.db`。
- 0 件 or フォルダ自体が無い → **空欄**。
- 2 件以上 → **mtime が最新の 1 本**。

実測値（Smallworld with AI）:

| WD | StudyMaterials |
|---|---|
| CLAUDE-00001 | `Samples for hands-on-session.zip` |
| CLAUDE-00002 | `Claude Code インストール手順 (IT チームより配布されたもの).zip` |
| CLAUDE-00003 | `ubuntu-branch-setup.zip` |
| GIT-00001〜4 | なし → 空欄 |
| SWAI-00001 | なし → 空欄 |
| SWAI-00003 | `gp_prd430-kb.zip` |

### 2.6 採用バージョンの選定

`<WD>/ReleasedVersion/` 直下の `*.pptx` のうち、`_v(\d+(?:-\d+)*)\.pptx$` に一致するものだけを候補とする。

1. バージョンをセグメント列に分解して比較し（`v001` < `v002` < `v002-001` < `v003`、
   フロントの `versionSegments()` と同じ順序）**最大**を採る
2. 同一バージョンが複数 → ファイル名の `YYYYMMDD` が最大のもの
3. なお同着 → mtime が最新のもの
4. なお同着 → ファイル名の辞書順で最後

`ReleasedVersion` が無い / パターン一致の pptx が 0 件の WD は**行を作らずスキップ**。

---

## 3. 差分方式（決定 4）

`scan` は D: 上の既存 CSV を読み、`Training_ID` → `{Version, Description, Tags}` の表を作る。

各行が **pending（Claude が書く）** になるのは以下のいずれか:

- `Training_ID` が既存 CSV に無い（新規教材）
- 既存の `Version` と新しい `Version` が違う（改版された）
- 既存の `Description` が空
- 既存の `Tags` が空

いずれでもなければ `Description` / `Tags` を**そのまま引き継ぐ**（Claude を呼ばない）。

既存 CSV が読めない／壊れている場合は「無い」ものとして扱い（全行 pending）、警告行を出す。

この規則により、**Claude の記入が一部失敗して空欄で残った行は、次回の押下で自動的に
再挑戦対象になる**（収束する）。

---

## 4. python ツール `data/work/tools/build_index.py`

既存の python ツール群（`new_deck.py` / `page_ops.py` 等）と同じ場所・同じ流儀。
サーバが `spawn("python3", [...])` して stdout を SSE に流す。
依存は `python-pptx`（既存ツールと同じ）のみ。

### 4.1 `scan` サブコマンド

```
python3 build_index.py scan \
  --work-root "D:\SW_Doc\Materials" \
  --category  "Smallworld with AI" \
  --staging   "<workspace>/data/work/.index/Smallworld with AI"
```

やること:

1. ステージングディレクトリを**作り直す**（前回の `rows/` が混ざらないよう毎回消してから作る）
2. `<work-root>/<category>/` の WD を列挙（`^[A-Z]+-\d+\s+\S` に一致するフォルダ）
3. 各 WD で §2.6 のバージョン選定 → 対象 pptx を決定（無ければスキップ）
4. §2.3 の 1・2・3・4・6・7 列を算出
5. D: の既存 CSV を読んで §3 の引き継ぎ判定
6. pending 行について pptx / md から `brief/<Training_ID>.md` を生成（§4.2）
7. 成果物を書き出す:

   ```
   <staging>/draft.csv                     8 列。pending 行は 5・8 列が空
   <staging>/pending.json                  Claude に渡す作業指示（下記）
   <staging>/brief/<Training_ID>.md        pending 行ごとの資料抜粋
   <staging>/rows/                         空ディレクトリ（Claude がここに書く）
   ```

   `pending.json`:

   ```json
   {
     "category": "Smallworld with AI",
     "generated_at": "2026-08-12T15:04:00+09:00",
     "total_rows": 9,
     "pending": [
       { "training_id": "CLAUDE-00001", "version": "v003",
         "title": "Claude 私はこんな風に使ってます",
         "brief": "brief/CLAUDE-00001.md",
         "out":   "rows/CLAUDE-00001.json" }
     ]
   }
   ```

8. stdout に人が読める進捗を出す（SSE にそのまま流れる）:

   ```
   D: をスキャン: Smallworld with AI（14 WD）
   対象 9 件（最新版のみ）
   引き継ぎ 3 件 / Claude が記入 6 件
   下書きを生成しました: data/work/.index/Smallworld with AI/draft.csv
   PENDING: 6
   ```

   最終行の `PENDING: <n>` をサーバが読んで Phase 2 の要否を決める。

### 4.2 `brief/<Training_ID>.md` の内容と上限

Claude が 1 行サマリと 5 個のタグを書くのに必要な情報だけを載せ、上限を設ける。

- 見出し: `Training_ID` / `Title` / `Version` / pptx ファイル名 / 頁数
- 表紙（1 頁目）の全文
- 2 頁目以降の本文（**1 スライド最大 400 文字**、**最大 25 スライド**、
  超過は `…（以下省略）` を付す）
- `DocumentLayouts.md` があれば**先頭 60 行**
- `ProjectInformation.md` があれば**先頭 40 行**
- brief 1 本あたり**合計 8,000 文字**で打ち切り

実測（§1.2）から、この上限で 6 件 pending なら合計 3 万文字程度に収まる。

### 4.3 `rows/<Training_ID>.json` — Claude が書く形

```json
{
  "description": "Claude Cowork と Claude Code の実務での使い分けと設定のコツを実演で紹介する。",
  "tags": "#Claude #AI #プログラマ向け #必修科目 #チョイむず"
}
```

`apply` 側の検証:

- `description`: 非空・改行を含まない・500 文字以内。違反は当該行を空欄扱いにして警告
- `tags`: `#` 始まりのトークンがスペース区切りで 1〜10 個。トークンは空白と `#` を含まない。
  違反は当該行を空欄扱いにして警告
- ファイルが無い / JSON が壊れている → 当該行は空欄のまま警告

**タグ語彙はスキル側（§6）に置く**（アプリの再ビルドなしに小町谷さんが調整できるようにする）。
初期語彙は依頼文のリストをそのまま使い、「他にも任意のキーワードを記載可能」も明記する。

### 4.4 `apply` サブコマンド

```
python3 build_index.py apply \
  --work-root "D:\SW_Doc\Materials" \
  --category  "Smallworld with AI" \
  --staging   "<workspace>/data/work/.index/Smallworld with AI"
```

やること:

1. `draft.csv` を読み、`rows/*.json` を §4.3 で検証しつつマージ
2. **安全弁: マージ後の行数が 0 なら D: を触らず exit 3。**
   D: が一時的に読めない等でスキャンが空振りしたときに、
   正常な既存 CSV をヘッダだけの CSV で潰さないため
3. §2.2 のバイト形式で `<staging>/out.csv` を書く
4. `out.csv` を `<work-root>/<category>/<category> Index.csv` へコピー（`shutil.copyfile`）
5. `<staging>/result.json` に結果（行数・記入済み数・空欄で残った `Training_ID`・警告）を書く
6. stdout:

   ```
   9 行を書き出しました（Claude 記入 6 / 引き継ぎ 3）
   D: へ反映: SW_Doc/Materials/Smallworld with AI/Smallworld with AI Index.csv
   ```

   空欄が残った場合は追加で:

   ```
   ⚠ 2 件は Description/Tags が空欄のまま残りました: GIT-00003, SWAI-00001
     （次回「索引作成」を押すと再挑戦します）
   ```

### 4.5 終了コード

| code | 意味 |
|---|---|
| 0 | 成功 |
| 1 | 想定外のエラー（stderr にトレース） |
| 2 | 引数不正 / カテゴリが存在しない / ステージングが無い |
| 3 | 書き出す行が 0 件（D: 未変更） |

### 4.6 セルフテスト

`python3 build_index.py --selftest` で fixture ツリーを一時ディレクトリに作って検証する
（既存 `_selftest_textbox.sh` と同じ流儀。CI には載せず手動実行）。カバーする項目:

- バージョン選定（`v013`/`v014`/`v015` → `v015`、枝番、同一バージョン同着の tie-break）
- ファイル名パース（`_YYYYMMDD_v…` あり／なし、タイトル内の空白・全角、ID 不一致）
- `SW_Doc` 相対パス導出（`SW_Doc` セグメント無しのフォールバック）
- `Study_Materials`（0 件／1 件／複数件の mtime 選択／`desktop.ini` 除外）
- 引き継ぎ判定（新規／改版／空欄／変化なし）
- CSV バイト列（BOM なし・CRLF・末尾改行なし・カンマ含みフィールドのクォート）
- 0 行時の exit 3（既存 CSV が無傷であること）

---

## 5. サーバ実装

### 5.1 ルート

`src/config/apiRoutes.ts` の `work` に追記:

```ts
/** POST — カテゴリ（サブフォルダ）の教材索引 CSV を生成する（SSE）。
 *  ① build_index.py scan（機械列＋資料抜粋の下書きを WSL に生成）
 *  ② pending があれば hidden agent worker を起動し Description/Tags を書かせる
 *  ③ worker 完了フックで build_index.py apply（D: へ反映）
 *  SSE はあくまで観測者で、切断しても ②③ は完走する。 */
buildIndex: "/api/work/build-index",
```

ハンドラは `server/api/routes/workFiles.ts` に置く（`scanRoot()` / `getWorkRootWin()` /
`pipeToSse()` が既にここにある）。ボディは `{ category: string }` のみ。

### 5.2 カテゴリ検証がセキュリティ境界

`category` は**必ず `scanRoot()` が返したカテゴリ名の集合に含まれることを確認**してから
使う。これがパス操作の許可リストであり、`..` やパス区切りの混入を構造的に排除する
（`isValidWorkWdId()` と同じ思想）。含まれなければ 400。

ステージングは `data/work/.index/<カテゴリ名>/`。カテゴリ名は上記の許可リスト由来なので
空白・日本語のまま使ってよい。

### 5.3 3 フェーズの流れ

```
POST /api/work/build-index { category }
  │
  ├─ カテゴリ検証（許可リスト）             → 不一致なら 400
  ├─ 実行中ガード（下記 5.4）               → 実行中なら 409
  │
  ├─ Phase 1  spawn python3 build_index.py scan …
  │            stdout を pipeToSse で SSE へ。最終行 `PENDING: n` を控える
  │            exit != 0 → `ERROR: …` を送って終了（D: 未変更）
  │
  ├─ PENDING == 0 のとき → Phase 2 を飛ばして Phase 3 へ
  │
  ├─ Phase 2  spawnSystemWorker({
  │              message: "/build-training-index <staging 相対パス>",
  │              roleId: "general", hidden: true,
  │              onComplete: → Phase 3 })
  │            起動失敗（背景セッション上限 4 件到達 等）→ `ERROR: …`
  │            SSE 観測: 2 秒ごとに `<staging>/rows/*.json` を数え
  │                     `Claude が記入中... (4/9)` を差分があったときだけ送る
  │
  └─ Phase 3  （worker 完了フック内）spawn python3 build_index.py apply …
               stdout を SSE へ流し、成功なら `DONE: <カテゴリ> Index.csv`
               exit 3 → `ERROR: 書き出す行が 0 件のため D: を変更しませんでした`
```

**Phase 3 は完了フックの中に置く**（SSE ハンドラの中に置かない）。
モーダルを閉じても・ブラウザをリロードしても D: への反映は完走する。
SSE が切れている場合は送信を諦めるだけ（`res.writableEnded` を見て黙って捨てる）。

### 5.4 ガードと上限

- **実行中ガード**: モジュールレベルの `Set<string>`（カテゴリ名）。
  Phase 1 の直前に登録し、Phase 3 の完了時（成功・失敗どちらも）に外す。
  実行中に再度 POST → **409** `{ error: "「<カテゴリ>」の索引作成は実行中です" }`。
  `collectionAgentActions.ts` の `running` Map と同じ流儀（プロセス内メモリで良い。
  worker はプロセスと共に死ぬので永続化するとボタンが固まるだけ）。
- **観測タイムアウト**: worker が 10 分で完了しない場合、SSE に
  `⚠ Claude の処理が長引いています。バックグラウンドで続行中です（完了すると D: に反映されます）`
  を出して SSE を閉じる。**worker は kill しない**し、完了フックはそのまま生きている。
- **背景セッション上限**: `MAX_BACKGROUND_SESSIONS = 4`。到達時は `spawnSystemWorker` が
  `{ ok: false, error }` を返すので、その文言をそのまま `ERROR:` で見せる。

### 5.5 既存資産の再利用

| 使うもの | 場所 |
|---|---|
| `scanRoot()` / `getWorkRootWin()` | `workFiles.ts:266` / `:243` |
| `pipeToSse()` | `workFiles.ts:544` |
| `spawnSystemWorker()`（hidden worker 起動＋完了フック） | `server/api/routes/agent.ts:136` |
| ルートから hidden worker を起動する前例 | `server/api/routes/collectionAgentActions.ts` |

---

## 6. スキル `data/skills/build-training-index/SKILL.md`

worker に渡すプロンプト本体。TypeScript に埋め込まず**スキルファイルに置く**ので、
文言やタグ語彙を再ビルドなしに調整できる（`mc-manage-skills` の仕組みで
`.claude/skills/` へミラーされる）。

worker へのメッセージは `/build-training-index <staging のワークスペース相対パス>`。

スキルの手順:

1. `<staging>/pending.json` を読む
2. 各 `pending[]` について `<staging>/<brief>` を読み、
   `<staging>/<out>` に §4.3 の JSON を 1 ファイルずつ Write する
   （1 件ずつ書くこと。サーバがファイル数で進捗を出している）
3. **D: 配下（`/mnt/d/...`）には一切書かない。`draft.csv` も書き換えない。**
   反映はサーバが行う
4. `apply` は自分で実行しない
5. 全件書き終えたら終了（報告メッセージは不要。hidden セッションなので誰も読まない）

スキル本文に含める `Tags` の語彙（初期値・拡張可）:

```
#Git #Backlog #Claude #Mulmo #Smallworld #Magik #AI #NAM #水道 #下水道
#管網解析 #ナレッジベース #管理者向け #プログラマ向け #必修科目
#易しい #チョイむず #ハイレベル
```

書き方の指示:

- `description` は資料が「誰に何をどこまで教えるものか」が分かる 1 行。全角 30〜60 文字目安。
  改行禁止。教材タイトルの言い換えで終わらせない
- `tags` は 5 個程度。**分野**（`#Git` `#Claude` 等）＋**対象読者**（`#プログラマ向け` 等）＋
  **難易度**（`#易しい` / `#チョイむず` / `#ハイレベル`）を最低 1 個ずつ含める

---

## 7. フロントエンド実装

### 7.1 カテゴリ見出し行の作り直し

現在の見出し（`WorkFileSelectorView.vue:18-25`）は行全体が 1 つの `<button>` なので、
中にボタンを足せない（ネストした button は不正）。外側を `<div>` にし、
トグルは chevron ＋ カテゴリ名だけを持つ `<button>` に縮める。

```
∨ Smallworld with AI              [索引作成]   13 件
└─ トグル button（flex-1）─┘      └ 新ボタン ┘  └ 件数 ┘
```

新ボタンのクラスは**この画面の既存ボタンに合わせる**
（`px-3 py-1 rounded text-sm font-medium border …`）。
`docs/ui-controls.md` の `h-8` はクローム行の規約で、キャンバス内のこの行には適用しない。

### 7.2 無効化条件（決定 3）

```ts
// released 版を 1 つも持たないカテゴリは索引を作れない
function canBuildIndex(cat: CategoryInfo): boolean {
  return cat.wds.some((wd) => wd.versions.some((ver) => ver.kind === "released"));
}
```

`scan` の戻り値だけで判定できる（追加リクエスト不要）。無効時の `title`:
`ReleasedVersion に pptx が無いため索引を作成できません`。

### 7.3 モーダル

既存の `modalPhase` / `modalLog` / `runModalSse()` / `drainModalSse()` をそのまま使う
（この画面の他 5 つのモーダルと同じ作り）。

```
┌ 索引作成 — Smallworld with AI ─────────────┐
│ ① 確認   出力先: Smallworld with AI Index.csv │
│          対象 13 WD / Claude が Description と │
│          Tags を記入します                     │
│                     [キャンセル] [索引作成]    │
│ ② ログ   D: をスキャン: … / 対象 9 件 / …      │
│          Claude が記入中... (4/6)              │
│          DONE: Smallworld with AI Index.csv    │
│                                      [閉じる]  │
└────────────────────────────────────────┘
```

`handleBuildIndexDone()` は `scanFiles()` を呼び直す（`Version` 表示等の整合のため）。
モーダルを閉じても Phase 2/3 は継続する旨を ① に一文入れる。

### 7.4 i18n

このビューは日本語専用（ファイル冒頭に
`eslint-disable @intlify/vue-i18n/no-raw-text` の宣言がある）。
新規文言も生文字列で書き、i18n バンドルには入れない。

---

## 8. テスト

### 8.1 python（`build_index.py --selftest`）

§4.6 の一覧。ロジックの真実源はここ。

### 8.2 node:test（`test/` 配下）

純粋関数として切り出して単体テストする:

- `isAllowedIndexCategory(category, categories)` — 許可リスト検証
- 実行中ガードの登録／解除（二重 POST が 409 になること、
  Phase 3 失敗でも解除されること）
- `PENDING: n` 行のパース（欠落時は「pending 不明」として Phase 2 を実行）
- 進捗行の組み立て（`rows/` のファイル数 → `Claude が記入中... (n/total)`、
  差分が無いときは送らない）

`collectionAgentActions.ts` の `spawn` のように **`spawnSystemWorker` と
python spawn を注入可能にして**、テストで実エージェント・実 python を動かさない。

### 8.3 手動テスト（`docs/manual-testing.md` に追記）

1. Smallworld with AI で押下 → 9 行の CSV が D: に出る。BOM なし・CRLF・末尾改行なしを
   `od` で確認
2. 同じカテゴリでもう一度押下 → `引き継ぎ 9 件 / Claude が記入 0 件` になり
   `Description` / `Tags` が 1 文字も変わらないこと
3. 1 本だけ新版をリリースしてから押下 → その 1 行だけ Claude が書き直すこと
4. NAM のボタンが無効で tooltip が出ること
5. Phase 2 の途中でモーダルを閉じる → しばらく後に D: に CSV が出来ていること
6. 実行中に再度押下 → 409 のメッセージが出ること

---

## 9. 変更ファイル一覧

| ファイル | 変更 |
|---|---|
| `data/work/tools/build_index.py` | **新規**（ワークスペース側。git 追跡外） |
| `data/skills/build-training-index/SKILL.md` | **新規**（ワークスペース側） |
| `mulmoclaude/src/config/apiRoutes.ts` | `work.buildIndex` を追加 |
| `mulmoclaude/server/api/routes/workFiles.ts` | ルート＋3 フェーズ実装、ガード、純粋ヘルパの export |
| `mulmoclaude/src/components/WorkFileSelectorView.vue` | 見出し行の作り直し、`[索引作成]`、モーダル |
| `mulmoclaude/test/…` | node:test 追加 |
| `mulmoclaude/docs/manual-testing.md` | §8.3 を追記 |

`yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` を通してから完了とする。

---

## 10. 残る留意点

- **`workRootPath` は `config/settings.json` に無く既定値 `D:\SW_Doc\Materials` で動いている。**
  設定で変えられた場合も §2.4 の `SW_Doc` セグメント探索で動くが、`SW_Doc` を含まない
  ルートに移されたら `Textbook` の形が変わる（警告を出す）。
- **`Category` 列は ID 接頭辞なので、教材が増えて新しい接頭辞が出れば自動で新カテゴリ値になる。**
  AppSheet 側が値の集合を固定で持っているなら、そちらの追随が必要。
- **`GIT-00002` は版によってタイトルの表記が違う**
  （`滅多にやらないローカル…`(v003/v004) と `滅多にやらない ローカル…`(v005)）。
  `Title` は採用した版のファイル名由来なので、版が上がると `Title` も変わり得る。仕様どおり。
- **NAM 等のカテゴリで将来 pptx をリリースするとボタンが有効になる。**
  その場合フォルダ名の「タイトル」相当が日付（`GWCALC-00001  2026-05-28`）なので、
  `Title` に日付が入る。教材として索引に載せるなら WD フォルダ名の改称が必要。
