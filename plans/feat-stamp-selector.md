# 設計書：MulmoPoint「スタンプ選択」機能

- 対象：作業ファイル選択画面（`src/components/WorkFileSelectorView.vue`）＋サーバー `server/api/routes/workFiles.ts`
- ブランチ：`experiment/slide-editor`（fork）／要 `yarn build`・python 変更なし
- ステータス：**実装完了・sandbox 検証済み／実機 build+push 待ち**（2026-08-13）
  - 変更：`src/config/apiRoutes.ts`（stamps/stampApply 追加）／`server/api/routes/workFiles.ts`（GET stamps・POST stamp-apply＋ヘルパー）／`src/components/WorkFileSelectorView.vue`（ボタン・モーダル・確認ダイアログ・state）／`test/routes/test_workFilesStamps.ts`（新規11件）
  - sandbox 検証：`yarn format`／`yarn typecheck`／`yarn lint`（0 error）／新規テスト 11 pass／workFiles 全テスト 168 pass。`yarn build` は実機（小町谷さん）。

---

## 1. ゴール

各ワーキングディレクトリ（WD）行の「同期」ボタンの**左隣**に「スタンプ選択」ボタンを新設する。
押すと `data/work/stamps/compressed/` のスタンプ（花モチーフの修了証／未受講ペア）から 1 件を目で見て選ぶモーダルを開き、
選択したペア（`<花名>_completed.png` と `<花名>_incompleted.png`）を、その WD の **Windows 側 `Stamps` フォルダ**へ
「いったん空にしてからコピー」する。同じカテゴリ（サブフォルダ）配下の他 WD が既に使っているスタンプには
「使用中」バッジを出す。

## 2. 確定した仕様（presentForm・全推奨案）

| # | 論点 | 決定 |
|---|------|------|
| Q1 | コピーする解像度 | **compressed（512px 配布版）**。ファイル名は元のまま `<花名>_completed.png` / `<花名>_incompleted.png` を維持 |
| Q2 | Stamps 全削除前の確認 | **確認ダイアログを 1 回はさむ**（D: への破壊的操作のため安全重視） |
| Q3 | 「使用中」バッジ | **現在の WD が使用中＝『現在使用中』（別色）／他の同列 WD が使用中＝『使用中』**の 2 段階で区別 |
| Q4 | ボタンの表示範囲 | **同期ボタンと同じく「登録済み WD」のときだけ表示**（`v-else` ブロック内） |
| 追加 | ツールチップ | 「使用中」バッジのツールチップに**使用している WD 名**を出す |
| 追加 | ラベル | モーダルの各サムネに**花名ラベル**を出す（例：キキョウ／フクシア／彼岸花（ヒガンバナ）） |

## 3. データモデルとパス解決

### 3-1. スタンプ元（全 WD 共通・グローバル）
- 実体：`data/work/stamps/compressed/<id>.png`（workspace 相対）
  - `<id>` = `<花名>_completed` または `<花名>_incompleted`
  - 現状 9 花 × ペア（bellflower / fuchsia / snowball / trumpetvine / bougainvillea / rose_pink / yamayuri / higanbana / hibiscus_red）
- ラベル：`data/work/stamps/index.json` の `assets[]`（`variant=="completed"` の `label` を採用）
  - 表示用の短い花名は `label` から `/\s*修了証スタンプ.*$/` を除去して算出（例「キキョウ 修了証スタンプ（フルカラー）」→「キキョウ」）
  - index.json が無い／該当なしのときは `<花名>`（ファイル名 stem）へフォールバック
- モーダルには **`_completed.png` のみ**をサムネ表示（1 花＝1 タイル）。`_incompleted.png` はペアの相方として裏で扱う。
- 表示対象は **ペアが揃っている花のみ**（`_completed` と `_incompleted` の両方が存在）。片方欠けは一覧から除外し `log.warn`。

### 3-2. WD の Windows 側 Stamps フォルダ
- WD の Windows パス：既存 `resolveWdWindowsPath(wdId)` が返す（例 `D:\SW_Doc\Materials\Smallworld with AI\CLAUDE-00001 …`）。
  - フロントは既に `wd.windowsWdPath` を持つのでリクエストに載せられる（同期ボタンと同じ流儀）。サーバー側は body 省略時 `resolveWdWindowsPath` にフォールバック。
- Stamps フォルダ：Windows `<wdWinPath>\Stamps`／WSL アクセス `windowsToWsl(wdWinPath) + "/Stamps"`（既存 `windowsToWsl` で `D:\` → `/mnt/d/`）。

### 3-3. 「使用中」判定（同一カテゴリの兄弟 WD 走査）
- カテゴリ＝作業ルート（`getWorkRootWin()` 既定 `D:\SW_Doc\Materials`）直下のサブフォルダ（NAM / Smallworld with AI など）。
- 既存 `scanRoot()` が `categories[].wds[]`（各 `id` / `title` / `windowsWdPath`）を返すので、`wdId` を含むカテゴリを特定 →
  そのカテゴリ内の全 WD の `<windowsWdPath>\Stamps` を走査し、各 WD が持つ `*_completed.png` のファイル名集合を取る。
- あるスタンプ `id`（＝ `<花名>_completed`）について：
  - 現在 WD の Stamps に `<花名>_completed.png` があれば `usedByCurrent = true`
  - 他 WD の Stamps にあれば `usedBySiblings.push({ id, title })`
- マッチング単位は **`_completed.png` のファイル名一致**（花名一致）。

## 4. バックエンド設計（`server/api/routes/workFiles.ts` ＋ `src/config/apiRoutes.ts`）

`apiRoutes.work` に 2 本追加：

```ts
/** GET — スタンプ一覧＋当該 WD のカテゴリ内使用状況。?wdId=<id> */
stamps: "/api/work/stamps",
/** POST — 選択スタンプを WD の Windows 側 Stamps へ「全消し→ペアをコピー」。 */
stampApply: "/api/work/stamp-apply",
```

### 4-1. `GET /api/work/stamps?wdId=<id>`
レスポンス：
```jsonc
{
  "stamps": [
    {
      "id": "bellflower_completed",     // completed の stem（選択キー）
      "flower": "キキョウ",              // 表示ラベル（index.json 由来／fallback は花名）
      "label": "キキョウ 修了証スタンプ（フルカラー）",
      "thumbPath": "data/work/stamps/compressed/bellflower_completed.png", // /api/files/raw?path= で表示
      "completedFile": "bellflower_completed.png",
      "incompletedFile": "bellflower_incompleted.png",
      "usedByCurrent": false,
      "usedBySiblings": [ { "id": "CLAUDE-00002", "title": "始めよう VS Code + Claude Code 環境" } ]
    }
    // …
  ]
}
```
処理：
1. `wdId` 検証（`isValidWorkWdId`）。不正は 400。
2. `data/work/stamps/compressed/` を走査し `*_completed.png` を列挙、`_incompleted.png` の存在をペア確認。
3. `index.json` を読みラベル付与（無ければ fallback）。
4. `scanRoot()` で `wdId` のカテゴリを特定 → カテゴリ内全 WD の Stamps を走査して `usedByCurrent` / `usedBySiblings` を算出。
5. スタンプ元／カテゴリが見つからないときも 200＋部分結果（usage 空）で返し、フロントで空表示にできるようにする。

### 4-2. `POST /api/work/stamp-apply`  body `{ wdId, stampId, windowsWdPath? }`
処理：
1. `wdId` 検証（400）。`stampId` は compressed の `*_completed` stem 集合に含まれること（不正は 400）。
2. `windowsWdPath` は body 優先、無ければ `resolveWdWindowsPath(wdId)`。解決不可は 409（「Windows パスを解決できません」）。
3. ペア両ファイル（`<花名>_completed.png` / `<花名>_incompleted.png`）が compressed に存在することを確認（欠けは 409）。
4. WSL Stamps ディレクトリ = `windowsToWsl(wdWinPath) + "/Stamps"`。無ければ `fsp.mkdir(recursive)` で作成。
5. **全消し**：Stamps 直下の全エントリを削除。安全ガード＝各エントリの親が Stamps ディレクトリであることを `isContainedChild` 系で確認してから `fsp.rm(entry, { recursive: true, force: true })`。**Stamps ディレクトリ自身は消さない**。
6. **コピー**：`data/work/stamps/compressed/<pair>` の 2 ファイルを Stamps 直下へ（`writeFileAtomic` またはバイナリコピー・既存 `mirrorCopy` 流儀を踏襲）。
7. `log.info("workFiles.stampApply", …)` で `{ wdId, stampId, removed, copied }` を記録。
8. レスポンス `{ applied: true, wdId, stampId, removed: <消した数>, copied: ["…_completed.png","…_incompleted.png"] }`。

補足：
- **登録（WSL 実体化）は不要**。Stamps は Windows(D:) 側だけの操作なので API は登録状態を要求しない（ボタンの出し分けはフロントで Q4 のとおり登録済みに限定）。
- ファイル I/O は `server/utils/files/atomic.ts`（`writeFileAtomic`）と既存の mirror ヘルパー流儀に合わせ、ルート直書き `fs.readFile/writeFile` は避ける（CLAUDE.md 規約）。定数・パスは `WORKSPACE_*` を使用。

## 5. フロントエンド設計（`src/components/WorkFileSelectorView.vue`）

> このファイルは既にボタン文言を生 JP でハードコードしている（「同期」「抹消」「登録」）。本機能の文言も同ファイルの既存慣習に合わせ生 JP で追加する（i18n キー追加は不要）。

### 5-1. ボタン
- 「同期」ボタンの**直前**（`<template v-else>` 内、`onSync` ボタンの前）に配置。
- 見た目：同期ボタンと同テイストの outline（`border-purple-300 text-purple-600 hover:bg-purple-50` など・同期＝青と区別）。material icon 案 `local_florist`（花）。
- `:disabled="wdBusy.has(wd.id)"`、`@click="openStampModal(wd)"`、`title="スタンプ（修了証／未受講）を選んで、この WD の Stamps フォルダに設定します"`。

### 5-2. モーダル
- 状態：`stampModal = ref<{ wd: WdInfo } | null>`、`stampList = ref<StampItem[]>`、`stampLoading`、`stampSelectedId`、`stampApplying`、`stampConfirmOpen`。
- 開く：`openStampModal(wd)` → `apiGet(API_ROUTES.work.stamps, { wdId })` → `stampList` セット → モーダル表示（fetch は try/catch＋`!ok` 両方処理）。
- レイアウト：グリッド（サムネ `/api/files/raw?path=<thumbPath>` ＋下に花名ラベル）。
  - **バッジ**（サムネ右上オーバーレイ）：
    - `usedByCurrent` → 「現在使用中」（例：青／緑の実線バッジ）
    - `usedBySiblings.length>0` → 「使用中」（例：アンバーのバッジ）、`title` に使用 WD 名を列挙（`usedBySiblings.map(w => w.title || w.id).join(", ")`）
    - 両方該当時は「現在使用中」を主表示し、ツールチップに兄弟 WD も併記
  - タイルクリックで選択（枠ハイライト）。**使用中でも選択・コピー可**（Q 仕様どおり）。
  - フッター：「このスタンプを設定」ボタン（`:disabled="!stampSelectedId || stampApplying"`）＋「閉じる」。
- 純関数 `stampBadge(stamp): { kind: "current" | "sibling" | "none", tip: string }` を切り出しユニットテスト対象にする。

### 5-3. 確認ダイアログ（Q2）
- 「このスタンプを設定」→ 確認オーバーレイ：
  「**{WD} の Stamps フォルダの既存内容をすべて削除**し、選択したスタンプ（修了証／未受講のペア）をコピーします。よろしいですか？」
  → OK で `applyStamp()`。
- `applyStamp()`：`setWdBusy(wd.id, true)` → `apiPost(API_ROUTES.work.stampApply, { wdId, stampId, windowsWdPath })` → 成功時 `setSyncNote(wd.id, "✓ スタンプを設定しました（<花名>）")`（既存 `syncNote` 機構を再利用）→ **モーダルを即閉じる**（確定）→ `finally` で busy 解除。エラーは `errorMsg` に表示。

## 6. エッジケース

- Stamps フォルダ未存在：一覧では usage 空、apply 時に mkdir。
- ペア欠け（`_incompleted` 無し）：一覧から除外＋warn。apply でペア欠けは 409。
- Windows パス解決不可 / `/mnt/d` 未マウント（サンドボックス等）：apply は 409/500 で明示エラー、フロントは `errorMsg` 表示。実機（`/home/tsune`）では正常。
- 多重押下：`wdBusy` で抑止。
- 破壊操作の限定：削除は Stamps 直下エントリのみ（`isContainedChild` ガード）。WD ルートや祖先には決して触れない。

## 7. テスト

- サーバー `test/routes/test_workFilesStamps.ts`（新規）：
  - `windowsWdPath` に**ドライブ文字なしの一時ディレクトリ**を渡す（`windowsToWsl` は `X:\` のみ書き換えるため POSIX 一時パスは素通り）→ 実ファイルで list / apply を検証。
  - list：兄弟 WD の Stamps 有無で `usedByCurrent` / `usedBySiblings` が立つ／立たない。
  - apply：既存内容を全消し→ペア 2 ファイルがコピーされる／`removed`・`copied` の実数。
  - 400（wdId 不正・未知 stampId）、409（ペア欠け・パス解決不可）。
- フロント：純関数 `stampBadge` のユニットテスト（current / sibling / none / 併用）。
- サンドボックスで `yarn format` / `yarn lint` / `yarn typecheck` / `yarn test` を Claude が実行（build は実機）。

## 8. ビルド／退避（標準フロー）

1. Claude 実装＋sandbox 検証（format/lint/typecheck/test）。
2. 小町谷さん：`yarn build` → サーバー再起動 → 実機動作確認。
3. OK なら Claude が fork `experiment/slide-editor` にローカル commit（末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`）→ 小町谷さんが `git push fork experiment/slide-editor`。
4. python 変更なし＝素材バックアップ不要。スタンプ素材（`data/work/stamps/`）自体は既存の `sw-backup-materials.sh` 範囲。

## 9. 確定した実装細部（2026-08-13）

1. ボタンのアイコン／色：**`local_florist`＋紫系**（同期＝青と区別）で確定。
2. apply 成功後のモーダル挙動：**即閉じる**で確定（成功文言は `syncNote` に残す）。
3. 「使用中」判定：**`_completed.png` のファイル名一致**で確定（ハッシュ比較は不要）。
