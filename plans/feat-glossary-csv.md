# 用語集 CSV の生成（`build-glossary` スキル ＋ 索引側の改修）

2026-08-30 起案。小町谷さんとの第1〜3弾の確認で確定した設計。**実装前の合意文書**。

`SWLESSON-90001 用語集` を**スライドではなく CSV** で作る。ポータルサイトのテーブル表示を
意図した成果物で、`Smallworld with AI News.csv` / `Smallworld with AI Index.csv` と同系統。

既存の教材索引（`feat-training-index-csv.md`）と**同型の3フェーズ構成**を取る。python ツールが
機械的に決まる列を作り、hidden agent worker が内容を要する列を書き、python ツールが D: へ反映する。

---

## 1. 成果物

| # | パス | 内容 |
|---|---|---|
| ① | `<WD>/v00N/SWLESSON-90001 用語集_yyyymmdd_v00N.csv` | 作業版。**BOM あり UTF-8**（Excel で開いたときの視認性のため） |
| ② | `<WD>/ReleasedVersion/SWLESSON-90001 用語集_yyyymmdd_v00N.csv` | リリース版。①のコピー（BOM あり） |
| ③ | `<WD>/ReleasedVersion/HISTORY.md` | 改訂履歴。`\|バージョン番号\|作成日\|内容\|` の3列（既存 pptx と同じ書式） |
| ④ | `Smallworld with AI/Smallworld with AI Glossary.csv` | ポータル参照用の固定パス。②の最新版を **BOM 無し UTF-8** に変換してコピー |
| ⑤ | `Smallworld with AI/Smallworld with AI News.csv` | 用語集の更新を1行として載せる（既存ファイルへの追記系統の追加） |

`<WD>` = `data/work/SWLESSON-90001/`（D: 側は `D:\SW_Doc\Materials\Smallworld with AI\SWLESSON-90001 用語集\`）

**エンコーディングの根拠**：既存 `Index.csv` / `News.csv` は `_encode_csv()` により
**UTF-8 BOM なし・CRLF・末尾改行なし・RFC4180 最小クォート**。④はポータルが読むので
この形式に完全に揃える。①②は人が Excel で開くので BOM を付ける。

---

## 2. CSV スキーマ（全8列・確定）

ヘッダは英語（既存2ファイルと揃え、AppSheet 側の扱いを統一する）。

| 列 | 値 | 規約 |
|---|---|---|
| `Domain` | `Smallworld` 固定 | 将来 Git・Claude など別分野の用語集を作るときの分類軸として持つ |
| `Initial` | `A`〜`Z` / `#` | `Term` の先頭文字を大文字化。数字・記号始まり（`430`）は `#` |
| `Term` | 用語（アルファベット表記） | 原典の表記に合わせる。`product.def` のように小文字・ドット付きもそのまま |
| `Term_JA` | 日本語での呼び名 | 訳語が定着していない語（`Spatial Tag` 等）は**空欄でよい** |
| `Aliases` | 同義語をカンマ区切り | 例：`Object` の行に `Real World Object, RWO, Record`。**同義語で独立行を作らない** |
| `Summary` | 一口サマリ | **全角 30〜60字**・改行禁止。`Index.csv` の `Description` と同じ尺 |
| `Description` | 詳細説明 | **全角 150〜400字**（ガイド §2-4 の規約をそのまま引き継ぐ） |
| `References` | `#SWLESSON-00001` スペース区切り | 用語が使われている文書の Doc ID。**代表用語で教材に出ないものは空欄** |

**`References` は最初から Doc ID を丸ごと書く**（2026-08-30 方針変更）。番号のみ（`#00001`）だと
将来 `SWAI-*` / `GIT-*` に広げたとき `SWAI-00001` と `SWLESSON-00001` が衝突するため、
**初版から `#SWLESSON-00001` 形式**にして将来の拡張に備える。

### `Description` の文体規約（ガイド §2-4 ＝ 原典 42 語の実測から確立）

- **`「用語」は〜である。` の形で始める**
- **Smallworld 独自語は用語を引用符「」で囲む／一般 GIS 用語は囲まない。** 原典では
  `Coordinate System`（472字）と `Logical Field` が引用符ゼロで、汎用 GIS の定義文として
  そのまま読める文章になっている。一方 `Alternative` / `Commit` / `Merge` / `Post` /
  `Dataset` / `World` は必ず引用符付き。**この字種の差で語彙の層が識別できる状態を保つ**
- **関連語の相互参照は必ず対にする**（原典は `Inheritance` ↔ `Override`、`Module` ↔ `Product` が双方向）
- **略語は展開形を最初に示す**（`「UVA」は「Unique Value Allocator」の略である。`）
- **物理的な実体（ファイル名・フォルダ名）まで書く**（`データセット「ace.ds」に格納される`）
- KB に根拠のない記述は書かない（推測で補わない）

### 並び順

`Initial` 昇順 → `Term` 昇順（大文字小文字を無視した辞書順）。`#` グループは末尾。
原典は「語のない頭文字の行は作らない」（15種のみ）— CSV では `Initial` 列に値が入るだけなので自然に満たされる。

---

## 3. データフロー（3フェーズ・索引と同型）

```
Phase 1  build_glossary.py scan    … 対象 pptx の判定・機械マッチ・ステージング生成
Phase 2  hidden agent worker       … build-glossary スキルが Summary / Description / References を書く
Phase 3  build_glossary.py apply   … マージ → v00N/ → ReleasedVersion → HISTORY.md → D: 反映
```

**Phase 3 は worker の完了フックの中で走る**（既存の索引作成と同じ）。サンドボックスの Claude は
D: に書けないので、Claude はステージングにだけ書き、D: への反映はサーバーが行う。

ステージング：`data/work/.glossary/<カテゴリ>/`

### Phase 1 — `scan` の仕事

1. カテゴリ配下から **`SWLESSON-\d+` の WD だけ**を列挙する（`SWLESSON-90001` は除く）
2. 各 WD の `ReleasedVersion/` から**最新バージョンの pptx** を選ぶ（既存 `pick_released()` と同じロジック）
3. **前回の用語集の mtime** を得る
   = `SWLESSON-90001 用語集/ReleasedVersion/*_v*.csv` のうち版が最大のものの mtime。
   **ファイルが無ければ全 pptx が対象**
4. mtime がそれより新しい pptx だけを対象にする。**0 件なら `EXIT_EMPTY`(3) で終了**し、
   成果物を一切触らない（既存 CSV をヘッダだけの CSV で潰さないための安全弁。索引と同じ思想）
5. 既存の最新 CSV を**用語マスタ**として読む（追記型で育てる）
6. 対象 pptx の全文テキストを抽出（既存 `extract_pptx_slides()` を流用）
7. **機械マッチ**：各語の `Term` / `Term_JA` / `Aliases` が本文に出るか探し、
   **前後の文脈つきで候補を出す**（判定は Claude がするので、ここでは拾うだけ）
8. ステージングへ出力

```
data/work/.glossary/Smallworld with AI/
  pending.json        … 作業指示（対象 pptx の一覧・マスタの語数・新語抽出の依頼）
  master.csv          … 既存マスタのコピー（8列）
  text/<SWLESSON-ID>.txt   … pptx 全文（新語抽出と誤検出判定の材料）
  refhits.json        … 機械マッチの候補（用語 → 文書ID → 前後の文脈）
  rows/               … Claude が書く先（1語 1ファイル）
  refs.json           … Claude が確定させた References
```

### Phase 2 — `build-glossary` スキル（hidden worker）の仕事

1. `pending.json` を読む
2. **`refhits.json` の候補を文脈で判定**して `refs.json` を書く
   （`Style` / `Image` / `Object` のような一般英単語は誤検出するため、
   「用語として使われているか」を文脈で見る）
3. `text/*.txt` を読んで**マスタに無い新語**を抽出する
4. 新語と、`Summary` / `Description` が空欄の既存語を **5系統に分けて Smallworld サブエージェントへ並行で投げる**

| 系統 | 語（初版の例） |
|---|---|
| バージョン管理 | Alternative / Commit / Merge / Post / Checkpoint / Rollback / Rollforward / Version Management / Conflict |
| データ構造 | Object / Dataset / Collection / Physical Field / Logical Field / Geometry Field / Mandatory Field / Record Exemplar |
| 空間 | World / Universe / Spatial Tag / Coordinate System / Style / Manifold / Spatial Context / Database Priority |
| 開発 | Inheritance / Override / Message file / ACE / Case Tool / Apply / Application / UVA |
| product・module | product / product.def / module / module.def / load_list.txt / requires / package / image / 430 |

各サブエージェントは **KB（`/mnt/readonly/smallworld-knowledge-base-4d880d38`）の実ファイルを開いて**
根拠（ファイル名＋行番号）つきで書く。**記憶や推測で書かない。**

5. 結果を `rows/<slug>.json` に**1語ずつ順に**書く（サーバーがファイル数を数えて進捗を出すため）

```json
{
  "term": "Alternative",
  "term_ja": "オルタナティブ",
  "aliases": "",
  "summary": "データセットの版。親子関係を持ち、同時に書き込めるのは1利用者だけ。",
  "description": "「Alternative」はデータセットのバージョンである。……",
  "kb_evidence": "knowledge/data-model.md:412"
}
```

### Phase 3 — `apply` の仕事

1. `master.csv` ＋ `rows/*.json` ＋ `refs.json` をマージ（既存行は保全し、`References` だけ更新）
2. `Initial` を決め、並び順を確定
3. 版番号を決める（`ReleasedVersion/` の既存 CSV の最大版 ＋1。無ければ `v001`）
4. ①`<WD>/v00N/…_yyyymmdd_v00N.csv` を **BOM あり**で書く
5. ②`ReleasedVersion/` へコピー
6. ③`HISTORY.md` に1行追加（`\|v00N\|yyyy/mm/dd\|<内容>\|`）
7. D: へ反映

---

## 4. `build_index.py`（索引側）の改修 — 4点

### ① `Category` を三分類に改める

```python
NEWS_RELEASE_CATEGORY = "3.リリース情報"
NEWS_NOTICE_CATEGORY  = "1.お知らせ"
NEWS_GLOSSARY_CATEGORY = "2.用語集"
```

既存 `News.csv` には `リリース情報` / `お知らせ` が入っている。**両方やる**（第1弾 Q5）：
- 小町谷さんが D: 側の `Notice.csv` を書き換える
- **かつ** `read_notice_rows()` に**正規化**を持たせる（`お知らせ` → `1.お知らせ` 等）。
  今後どちらの書き方で来ても通るようにして事故を防ぐ

**並び順は `CreatedAt` 降順のまま**（第3弾 Q6）。番号はポータル側で絞り込み・表示順を制御するためのもの。

### ② `SWLESSON-90001` を `Index.csv` から除外

```python
GLOSSARY_WD_ID = "SWLESSON-90001"
```

`collect_rows()` でこの ID を飛ばす。用語集はポータルの別テーブルで見せるので教材一覧には出さない。
（`pick_released()` は pptx を探すので CSV しか無い WD は行を作れず警告になる。除外を先に判定する）

### ③ 最新の用語集 CSV を固定パスへコピー

`<WD>/ReleasedVersion/` の最大版 CSV を
`<カテゴリ>/Smallworld with AI Glossary.csv` へ **BOM を外して**コピーする。

### ④ `News.csv` に用語集の行を足す

現在 `build_news_csv()` は **①Index 行（リリース情報）＋②Notice.csv（お知らせ）** の2系統。
ここに **③用語集**を足す。

| 列 | 値 |
|---|---|
| `News_ID` | `SWLESSON-90001` 固定 |
| `Version` | `HISTORY.md` の最新行の**バージョン番号**欄 |
| `Category` | `2.用語集` 固定 |
| `CreatedAt` | **`ReleasedVersion` の版付き CSV の mtime**（第3弾 Q5） |
| `Title` | `用語集に更新があります` 固定 |
| `Description` | `HISTORY.md` の最新行の**内容**欄 |

**注意**：小町谷さんのご指示は「"バージョン" 欄」でしたが、`HISTORY.md` の実際の列名は
**`バージョン番号`** です（実物で確認済み）。実装は実際の列名で引き当てます。

---

## 5. GUI — 「用語集作成」ボタンの新設

索引作成ボタンと並べる（第3弾 Q2）。**実機 build が必要。**

| ファイル | 改修内容 |
|---|---|
| `src/components/WorkFileSelectorView.vue` | カテゴリ見出しに「用語集作成」ボタンを追加 |
| `src/config/apiRoutes.ts` | 用語集生成のルートを定義（索引の隣） |
| `server/api/routes/workFiles.ts` | 3フェーズのハンドラ。既存の索引実装（3124行〜）と同型 |
| `test/routes/test_workFilesBuildGlossary.ts` | 純粋ヘルパのテスト（既存 `test_workFilesBuildIndex.ts` と同型） |

既存の索引実装から流用できるもの：`isAllowedIndexCategory` / `parsePendingCount` /
`buildIndexProgressLine` / `spawnBuildIndex` / 実行中ガード（`Set`）の作り。

---

## 5-2. リリース逆 push の CSV 対応【2026-08-30 実装済み・実機検証 OK】

**実機検証（2026-08-30）**：`POST /api/work/release-to-windows`（`wdId: SWLESSON-90001`）が
`copied: ["SWLESSON-90001 用語集_20260830_v001.csv"]` を返し、D: 側に CSV と `HISTORY.md` の
両方が入ることを確認した（修正前はここが `copied: []`）。なお `HISTORY.md` は
`historyCopied` がログにのみ出て **`copied` には含めない**（pptx と共通の既存挙動・仕様）。

**発見した不具合**：`POST /api/work/release-to-windows` が用語集 WD で `copied: []` を返し
**完全に空振りしていた**（実測）。`pushReleasedToWindows()` が pptx 前提だったため。

```ts
const wslFiles = await statPptxList(wslReleasedDir);
if (wslFiles.length === 0) return empty;   // ← 用語集 WD は pptx が永久に 0 本
...
const historyCopied = await mirrorHistoryFile(...);  // ← 到達しない
```

`HISTORY.md` は既に「pptx ではないが ReleasedVersion に同居する成果物」として
`mirrorHistoryFile()`（名前指定・コピーのみ・削除しない）で運ばれていたが、
**その呼び出しが安全弁より後ろにあった**のが効かない理由。

### 直し方 — CSV は HISTORY.md と同じ「コピーのみ」枠に置く

- `RELEASED_CSV_PATTERN` / `isSafeReleasedCsvFilename()` / `statCsvList()` / `mirrorCsvCopy()` を新設
- **`isSafePptxFilename()` は触らない。** あれは `combine` の `outFilename` 検証にも
  使われており、CSV を通すと pptx 以外を結合先に指定できてしまう
- **`mirrorDelete()` に CSV を通さない。** pptx 側は「相手に無い版は削除」という完全一致
  方向を持つので、CSV を載せると取り違えで消える。CSV はコピーのみ
- 安全弁を `hasReleasedArtifacts(pptxCount, csvCount)` に置き換え（pptx か CSV が
  1 件でもあれば続行／両方 0 なら相手を温存）
- `diffReleasedPptx()` で **source 側 pptx が 0 件なら削除方向を立てない**
  （CSV だけの WD を根拠に相手の pptx を消す余地を作らない）
- **`syncReleasedFromWindows`（D:→WSL）にも CSV のコピーを足した。** これが無いと
  GUI 運用（サーバーが D: に直接書く）で **WSL 側に用語集 CSV が残らず、次に
  サンドボックスから `scan` を回したとき master が空のまま全語を作り直して v00N を
  余分に切る**という踏みにくい罠が残る

---

## 6. 初版の収録範囲

**原典 42 語すべて ＋ SWLESSON 固有語（約 55 語）**（第2弾 Q4）。

- **原典 42 語**：`BG-00006/RelatedMaterials/10 User Training/99_221212_Glossary of Smallworld_v002TK.xlsx`
  （実読済み。頭文字 15 種・説明の英字数は最短 114・中央値 237・最長 581）
- **SWLESSON 固有語**：`product.def` / `module.def` / `load_list.txt` / `requires` /
  フォルダ名の `430` / closed・open イメージ / Module Manager / Module Builder /
  `source` と `resources` / プロダクトの種別3種 など
- 原典の同義語スタブ4件（`Real World Object` / `Record` / `RWO` / `Table`）は
  **独立行にせず `Aliases` 列に入れる**（第2弾 Q1）

既存 3 レッスンの巻末用語コラムから回収できる定義（`References` が埋まる語）：

| 語 | 00001 | 00002 | 00003 |
|---|:---:|:---:|:---:|
| product / `product.def` / 種別3種 | ○ | | ○ |
| module / `module.def` | ○ | | ○ |
| イメージ（`.msf`） | | ○ | ○ |
| package | | ○ | ○ |
| フォルダ名の `430` | ○ | ○ | |
| Magik | ○ | ○ | |
| オブジェクト系 | △ | ○ | |
| `load_list.txt` / `requires` / Module Manager / Module Builder / `source`・`resources` | | | ○ |

---

## 7. 昇格処理は**別案件**（この設計には含めない）

ガイド §2-4 は「用語集を起こしたら、各レッスンの巻末用語コラムから昇格した語を削り
`［※ 詳細は SWLESSON-90001 用語集］` の参照表記に置き換える」と定めている。

これは **00001・00002・00003 の3本とも v002 を起こして MulmoPoint で組み直し再リリース**する
ことを意味し、用語集の初版より重い可能性がある。**用語集 CSV が実在してから着手する**
（参照先が存在しない資料への参照になるのを避ける）。段取りは別途相談する。

---

## 8. 実装方針（2026-08-30 小町谷さんの判断で全件決着）

### 8-1. 新語抽出の粒度 — **UI ラベルとメソッド名は用語に含めない**

用語として採る／採らないの判定基準。スキルにこの表をそのまま書く。

| 採る | 採らない |
|---|---|
| 概念（`Alternative` / `World` / `Manifold`） | **UI ラベル**（`File` - `Build Module ...`・`Add Product`・`Check` / `Apply` ボタン） |
| 構成単位（`product` / `module` / `package`） | **Magik のメソッド名**（`sw_module_dialog.open()` / `sw!update_image()` / `quit()`） |
| 定義ファイル（`product.def` / `module.def` / `load_list.txt`） | ダイアログ名・ウィンドウ名そのもの |
| 記述キーワード（`requires`） | 実演でのみ使う固有名（`gp_water_komachiya` / `sw_lesson_00003`） |
| ファイル種別・拡張子（`.msf` / `.msg`） | 変数名・dynamic 変数（`!global_auto_declare?!`） |
| 命名規約の要素（フォルダ名の `430`） | キー操作（`Ctrl+y` / `F2 Z Enter`） |

**境界の考え方**：*その語を知らないと教材の説明が読めなくなるか*。`Add Product` は
「操作の名前」なので手順書の中で説明されれば足りる。`product` は概念なので用語集が要る。

### 8-2. `Term_JA` の表記 — **語の性質で3通りを使い分ける**

| 語の性質 | 表記 | 例 |
|---|---|---|
| 一般的な技術用語 | **訳語** | `Inheritance` → 継承、`Override` → オーバーライド※、`Conflict` → 競合 |
| Smallworld 独自用語 | **カナ** | `Alternative` → オルタナティブ、`Manifold` → マニフォールド |
| 英略語 | **そのまま** | `RWO` → RWO、`ACE` → ACE、`UVA` → UVA、`VMDS` → VMDS |
| 複合語 | **カナ＋日本語の混在も可** | `Version Management` → バージョン管理（「バージョンマネージメント」としない） |

※ `Override` は「上書き」ではなく定着したカナ「オーバーライド」を採る。
訳語が定着していない語（`Spatial Tag` 等）は**空欄でよい**。

### 8-3. `Summary` は `Description` と**別の文**にする

サマリを詳細の1文目の要約にしない。役割を分ける：

- **`Summary`（30〜60字）** … *一覧で読んで他の語と区別がつく*ことを優先。その語が
  「何の仲間で、何が他と違うか」を書く
- **`Description`（150〜400字）** … `「用語」は〜である。` から始まる定義文。相互参照・
  物理的な実体・略語の展開を含む

例（`Alternative`）：
- `Summary`：データセットの版。親子関係を持ち、同時に書き込めるのは1利用者だけ。
- `Description`：「Alternative」はデータセットのバージョンである。……（→「Merge」「Post」も参照）

### 8-4. 既存行の上書きは **Claude の判断に任せ、HISTORY.md に明記する**

原則は追記型（一度書いた `Summary` / `Description` は触らない）。ただし**新しい pptx で
その語の理解が明確に深まった場合は上書きを許容する**。

**上書きしたときは `HISTORY.md` の「内容」欄に修正箇所を明記する**（例：
`v003|2026/09/15|新語5件を追加。Alternative と Merge の詳細説明を SWLESSON-00004 の内容に合わせて改訂。`）。
これにより、どの版で定義が変わったかが後から辿れる。

### 8-5. `References` は最初から `#SWLESSON-00001` 形式（§2 に反映済み）

将来 `SWAI-*` / `GIT-*` に探索対象を広げても移行作業が発生しない。
今回の探索対象は `SWLESSON-\d+` 限定のままとする。
