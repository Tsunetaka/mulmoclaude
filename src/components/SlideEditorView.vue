<template>
  <div class="h-full flex flex-col bg-[#0d1220] text-white select-none overflow-hidden">
    <!-- ── WD 未選択: work-files にリダイレクト中 ── -->
    <div v-if="!wdId" class="flex-1 flex items-center justify-center">
      <span class="material-icons animate-spin text-xl text-gray-600">refresh</span>
    </div>

    <!-- ── ロード中 ── -->
    <div v-else-if="loading" class="flex-1 flex items-center justify-center gap-3 text-gray-500">
      <span class="material-icons animate-spin text-xl">refresh</span>
      {{ t("common.loading") }}
    </div>

    <!-- ── エラー ── -->
    <div v-else-if="loadError" class="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400 px-8 text-center">
      <span class="material-icons text-4xl text-red-400">error_outline</span>
      <p class="text-sm">{{ loadError }}</p>
      <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- directional arrow is a decorative UI affordance on the back-navigation button -->
      <button class="text-sm text-[#4a8acc] hover:underline" @click="backToPicker">← {{ t("slides.backToPicker") }}</button>
    </div>

    <!-- ── データ待ち（新構造の再オンボード / 生成待ち） ── -->
    <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- internal slide-editing tool; not subject to i18n -->
    <div v-else-if="waiting" class="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400 px-8 w-full max-w-lg mx-auto text-center">
      <span class="material-icons animate-spin text-3xl text-[#4a8acc]">refresh</span>
      <p class="text-sm font-semibold text-[#8aacd0]">スライドデータを待っています…</p>
      <p class="text-xs text-[#3a5a7a]">
        この WD にはまだ編集用バージョン（v001 など）がありません。<br />チェックアウト / 分割 / 新規作成で生成されると自動で表示されます。
      </p>
      <button class="text-sm text-[#4a8acc] hover:underline mt-2" @click="backToPicker">← {{ t("slides.backToPicker") }}</button>
    </div>
    <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->

    <!-- ── エディタ本体 ── -->
    <template v-else-if="deck">
      <!-- ヘッダー -->
      <div class="h-10 flex-shrink-0 flex items-center gap-2 px-3 bg-[#0a1830] border-b border-[#1a2a44]">
        <span class="badge-wd">{{ wdId }}</span>
        <span class="badge-ver">{{ deck.version }}</span>
        <span
          v-if="sourceLabel"
          class="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[#0d1828] text-[#5a7aa0] border border-[#1a2a44] whitespace-nowrap"
          :title="sourceLabel"
        >
          {{ sourceLabel }}
        </span>
        <span class="flex-1 min-w-0"></span>
        <!-- eslint-disable-next-line @intlify/vue-i18n/no-raw-text -- abbreviated unit suffixes (p / sec) in compact header -->
        <span class="text-[10px] text-[#4a6a8a] whitespace-nowrap flex-shrink-0"> {{ deck.totalPages }}p / {{ deck.sections.length }}sec </span>
        <!-- 操作系コントロール（canvas 更新・チャットトグル・テーマ）は上部リボン
             （SlideEditorRibbon）に集約する。ここには識別バッジと概要のみを置く。 -->
      </div>

      <!-- ボディ -->
      <div class="flex flex-1 overflow-hidden min-h-0">
        <!-- ─ サイドバー ─ -->
        <div
          ref="sidebarEl"
          class="w-44 flex-shrink-0 bg-[#080e18] border-r border-[#141e2e] overflow-y-auto overflow-x-hidden focus:outline-none"
          style="scrollbar-width: thin; scrollbar-color: #2a3a5a transparent"
          tabindex="0"
          :aria-label="t('slides.pageListAria')"
          @wheel.stop
          @keydown="onSidebarKeydown"
        >
          <template v-for="(sec, si) in deck.sections" :key="si">
            <!-- セクション見出し（見出しボタン＋頁編集モード時のセクション操作） -->
            <div class="w-full flex items-center bg-[#0d1828] border-b border-[#141e2e]">
              <button class="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 hover:bg-[#162038] transition-colors text-left" @click="toggleSection(si)">
                <span
                  class="text-[8px] text-[#4a6a8a] flex-shrink-0 transition-transform duration-150"
                  :style="{ transform: collapsedSections.has(si) ? 'rotate(-90deg)' : 'rotate(0deg)' }"
                  >▼</span
                >
                <span class="text-[10px] font-bold text-[#8aacd0] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {{ sec.name }}
                </span>
                <span
                  v-if="pageEditMode && !isEditableSection(si, sec.name)"
                  class="material-icons text-[11px] text-[#5a7593] flex-shrink-0"
                  :title="t('slides.pageFixed')"
                  >lock</span
                >
                <span class="text-[9px] text-[#2a3a5a] flex-shrink-0">{{ sec.pages.length }}p</span>
              </button>
              <!-- セクション操作（編集可能セクションのみ・移動/リネーム/削除）。削除は空のときのみ。 -->
              <div v-if="pageEditMode && isEditableSection(si, sec.name)" class="flex items-center gap-0.5 pr-1 flex-shrink-0">
                <button
                  class="pe-btn"
                  :disabled="peBusy || !canMoveSectionUI(sec.name, -1)"
                  :title="t('slides.sectionMoveUp')"
                  :aria-label="t('slides.sectionMoveUp')"
                  @click.stop="moveSection(sec.name, 'up')"
                >
                  <span class="material-icons text-[13px]">arrow_upward</span>
                </button>
                <button
                  class="pe-btn"
                  :disabled="peBusy || !canMoveSectionUI(sec.name, 1)"
                  :title="t('slides.sectionMoveDown')"
                  :aria-label="t('slides.sectionMoveDown')"
                  @click.stop="moveSection(sec.name, 'down')"
                >
                  <span class="material-icons text-[13px]">arrow_downward</span>
                </button>
                <button
                  class="pe-btn"
                  :disabled="peBusy"
                  :title="t('slides.sectionRename')"
                  :aria-label="t('slides.sectionRename')"
                  @click.stop="askRenameSection(sec.name)"
                >
                  <span class="material-icons text-[13px]">edit</span>
                </button>
                <button
                  class="pe-btn pe-btn--danger"
                  :disabled="peBusy || sec.pages.length > 0"
                  :title="sec.pages.length > 0 ? t('slides.sectionDeleteNonEmpty') : t('slides.sectionDelete')"
                  :aria-label="t('slides.sectionDelete')"
                  @click.stop="askDeleteSection(sec.name)"
                >
                  <span class="material-icons text-[13px]">delete</span>
                </button>
              </div>
            </div>

            <!-- スライド一覧 -->
            <div v-if="!collapsedSections.has(si)" class="flex flex-col gap-1 p-1.5">
              <div v-for="page in sec.pages" :key="page.id" class="flex flex-col">
                <!-- focus:outline-none＝クリック後にキー操作すると残る白い枠（button の
                     :focus-visible リング）を抑止。選択状態は下の青枠が唯一の指標。 -->
                <button
                  class="rounded overflow-hidden border transition-all text-left w-full focus:outline-none focus-visible:outline-none"
                  :class="
                    currentId === page.id
                      ? 'border-[#3a78cc] bg-[#0d2040] shadow-[0_0_0_1px_#3a78cc40]'
                      : 'border-[#1e2e48] bg-[#0a1220] hover:border-[#3a5a88]'
                  "
                  :data-page-id="page.id"
                  @click="selectId(page.id)"
                >
                  <div class="relative">
                    <img :src="thumbUrl(page)" :alt="`p.${page.pageNo}`" class="w-full object-cover bg-[#141e2e]" loading="lazy" />
                    <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- compact status badge; slides tool is an internal workspace feature -->
                    <div v-if="page.checkedOut" class="absolute inset-0 bg-red-900/60 flex items-center justify-center">
                      <span class="text-[9px] font-bold text-red-200">CO中</span>
                    </div>
                    <!-- dirty ドット（編集済み・キャンバス再生成待ち） -->
                    <div v-if="page.dirty" class="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-yellow-400 shadow" />
                    <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
                  </div>
                  <div class="px-1.5 py-1 flex items-baseline gap-1">
                    <span class="text-[9px] font-bold text-[#4a6a8a] flex-shrink-0">{{ page.pageNo }}</span>
                    <span class="text-[9px] text-[#3a5a7a] overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                      {{ page.title }}
                    </span>
                  </div>
                </button>

                <!-- 頁編集コントロール（トグル ON 時）。編集可能セクションは ↑↓/🗑、
                     表紙／Thank You は錠前のみ（固定）。移動・削除は「現在選択中の頁」
                     に対してのみ有効（他頁は非活性）＝どの頁への操作か取り違えを防ぐ。 -->
                <div
                  v-if="pageEditMode"
                  class="flex items-center gap-0.5 px-0.5 pt-0.5 pb-1 rounded transition-colors"
                  :class="isEditableSection(si, sec.name) && currentId === page.id ? 'bg-[#0d2040]/60' : ''"
                >
                  <template v-if="isEditableSection(si, sec.name)">
                    <button
                      class="pe-btn"
                      :disabled="peBusy || currentId !== page.id || !canMovePage(page, -1)"
                      :title="currentId === page.id ? t('slides.pageMoveUp') : t('slides.pageEditSelectFirst')"
                      :aria-label="t('slides.pageMoveUp')"
                      @click.stop="movePage(page, -1)"
                    >
                      <span class="material-icons text-[13px]">arrow_upward</span>
                    </button>
                    <button
                      class="pe-btn"
                      :disabled="peBusy || currentId !== page.id || !canMovePage(page, 1)"
                      :title="currentId === page.id ? t('slides.pageMoveDown') : t('slides.pageEditSelectFirst')"
                      :aria-label="t('slides.pageMoveDown')"
                      @click.stop="movePage(page, 1)"
                    >
                      <span class="material-icons text-[13px]">arrow_downward</span>
                    </button>
                    <span class="flex-1"></span>
                    <button
                      class="pe-btn"
                      :disabled="peBusy || currentId !== page.id"
                      :title="currentId === page.id ? t('slides.pageTitleEdit') : t('slides.pageEditSelectFirst')"
                      :aria-label="t('slides.pageTitleEdit')"
                      @click.stop="askEditTitle(page)"
                    >
                      <span class="material-icons text-[13px]">title</span>
                    </button>
                    <button
                      class="pe-btn pe-btn--danger"
                      :disabled="peBusy || currentId !== page.id"
                      :title="currentId === page.id ? t('slides.pageDelete') : t('slides.pageEditSelectFirst')"
                      :aria-label="t('slides.pageDelete')"
                      @click.stop="askDeletePage(page)"
                    >
                      <span class="material-icons text-[13px]">delete</span>
                    </button>
                  </template>
                  <div v-else class="flex items-center gap-1 text-[9px] text-[#5a7593] px-1 py-0.5">
                    <span class="material-icons text-[12px]">lock</span>
                    <span>{{ t("slides.pageFixed") }}</span>
                  </div>
                </div>
              </div>

              <!-- ＋頁追加（編集可能セクションのみ）。空のテーマ適用済み本文ページを末尾へ挿入。 -->
              <button
                v-if="pageEditMode && isEditableSection(si, sec.name)"
                class="pe-add-btn"
                :disabled="peBusy"
                :aria-label="t('slides.pageAdd')"
                @click="addPage(sec.name, sec.pages.length)"
              >
                <span class="material-icons text-[13px]">add</span>
                <span>{{ t("slides.pageAdd") }}</span>
              </button>
            </div>
          </template>

          <!-- ＋セクション追加（頁編集モード時・先頭『表紙』の後〜Thank You の前に挿入） -->
          <button v-if="pageEditMode" class="pe-add-btn m-1.5" :disabled="peBusy" :aria-label="t('slides.sectionAdd')" @click="askAddSection">
            <span class="material-icons text-[13px]">playlist_add</span>
            <span>{{ t("slides.sectionAdd") }}</span>
          </button>
        </div>

        <!-- ─ メインビュー ─ -->
        <div class="flex-1 flex flex-col bg-[#0a0e16] items-center justify-center p-4 gap-3 overflow-hidden min-w-0">
          <!-- スライド画像 -->
          <!-- メインビューはページキャンバス（.pagecanvas/）優先。未生成時はサムネイルにフォールバック -->
          <div v-if="currentPage" ref="mainViewEl" class="flex-1 w-full min-h-0 flex items-center justify-center relative">
            <img
              ref="mainImgEl"
              :src="mainImgUrl(currentPage)"
              :alt="`p.${currentPage.pageNo}`"
              class="h-full max-w-full w-auto object-contain rounded shadow-2xl"
              style="box-shadow: 0 10px 50px rgba(0, 0, 0, 0.75)"
              @load="onMainImgLoad"
              @error="onMainImgError(currentPage.id)"
            />
            <!-- テキストボックス編集オーバーレイ（textboxEditMode・編集可能頁のみ）。
                 画像の実描画矩形（imgBox）に重ね、各 TB を % 配置の透明ボタンにする。
                 常時うっすら枠線＋ホバーで強調（tb-hotspot）。クリックで編集モーダル。 -->
            <div
              v-if="showTextboxOverlay && imgBox"
              class="absolute z-10"
              :style="{ left: imgBox.left + 'px', top: imgBox.top + 'px', width: imgBox.width + 'px', height: imgBox.height + 'px' }"
            >
              <button
                v-for="box in textboxes"
                :key="box.id"
                type="button"
                class="tb-hotspot"
                :style="hotspotStyle(box)"
                :aria-label="t('slides.textboxEdit')"
                @click="openTextboxModal(box)"
              ></button>
            </div>
            <!-- 編集対象外の頁（表紙／Thank You／未分類／チェックアウト中）の注記 -->
            <div
              v-else-if="textboxEditMode && currentPage && deck && !canEditTextboxes(deck, currentPage.id)"
              class="absolute top-0 left-0 right-0 bg-[#243247]/90 text-[#9fc0e6] text-[10px] font-bold text-center py-1 rounded-t pointer-events-none"
            >
              {{ t("slides.textboxNotEditable") }}
            </div>
            <!-- チェックアウト中バナー -->
            <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- status banner for internal slide editing tool -->
            <div
              v-if="currentPage.checkedOut"
              class="absolute top-0 left-0 right-0 bg-red-800/90 text-white text-xs font-bold text-center py-1.5 rounded-t pointer-events-none"
            >
              🔒 チェックアウト中{{ currentPage.checkoutBy ? `（${currentPage.checkoutBy}）` : "" }}
            </div>
            <!-- dirty バナー（サムネで暫定表示中・クリックで canvas 更新を促す） -->
            <button
              v-if="currentPage.dirty"
              class="absolute bottom-0 left-0 right-0 bg-yellow-700/85 text-yellow-50 text-[10px] font-bold text-center py-1 rounded-b hover:bg-yellow-600/90 transition-colors cursor-pointer"
              @click="openRefreshModal"
            >
              ✏ 編集をサムネで表示中 — クリックで canvas 更新（高解像度で反映）
            </button>
            <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
          </div>

          <!-- ページ情報 + ナビ -->
          <div v-if="currentPage" class="w-full flex items-center gap-3 flex-shrink-0">
            <span class="text-sm font-bold text-[#3a78cc] tabular-nums flex-shrink-0"> {{ currentPage.pageNo }} / {{ deck.totalPages }} </span>
            <span class="text-xs text-[#6a8aaa] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {{ currentPage.title }}
            </span>
            <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- purely decorative nav arrows; aria-label carries the accessible name -->
            <div class="flex gap-1.5 flex-shrink-0">
              <button class="nav-btn" :disabled="currentIndex <= 0" :aria-label="t('slides.prevPage')" @click="selectByIndex(currentIndex - 1)">◀</button>
              <button
                class="nav-btn"
                :disabled="currentIndex >= deck.totalPages - 1"
                :aria-label="t('slides.nextPage')"
                @click="selectByIndex(currentIndex + 1)"
              >
                ▶
              </button>
            </div>
            <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
          </div>
        </div>

        <!-- ─ Claude チャットペイン ─ -->
        <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- internal slide-editing tool; not subject to i18n -->
        <div v-if="showChatPane" class="chat-pane relative flex-shrink-0 flex flex-col bg-[#080e18] border-l border-[#141e2e]">
          <!-- ペインヘッダー -->
          <div class="h-9 flex-shrink-0 flex items-center gap-1.5 px-3 bg-[#0a1020] border-b border-[#141e2e]">
            <span class="material-icons text-sm text-[#5a95e0]">chat</span>
            <span class="text-[11px] font-bold text-[#a9cdef] flex-1">Claude に指示</span>
            <button
              class="flex items-center gap-0.5 text-[10px] text-[#7fa8d4] hover:text-[#cfe6ff] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="チャットを新規化（編集画面は閉じません）"
              aria-label="チャットを新規化"
              :disabled="agentRunning"
              @click="newChat"
            >
              <span class="material-icons text-sm">add_comment</span>
              新規
            </button>
            <button class="text-[#5a7593] hover:text-[#a9cdef] transition-colors" aria-label="チャットを閉じる" @click="showChatPane = false">
              <span class="material-icons text-sm">close</span>
            </button>
          </div>

          <!-- コンテキスト表示 -->
          <div v-if="currentPage" class="px-3 py-1.5 bg-[#060b14] border-b border-[#0d1628] text-[10px] text-[#7d9cbb] leading-tight">
            <span class="text-[#93b2d0]">WD:</span> {{ wdId }}
            <span class="text-[#556b86] mx-1">·</span>
            <span class="text-[#93b2d0]">p.</span>{{ currentPage.pageNo }}
            <template v-if="currentPage.title">
              <span class="text-[#556b86] mx-1">·</span>
              <span class="text-[#9fbdd8] overflow-hidden text-ellipsis whitespace-nowrap">{{ currentPage.title }}</span>
            </template>
          </div>

          <!-- メッセージリスト -->
          <div
            ref="chatMessagesEl"
            class="flex-1 overflow-y-auto p-2 flex flex-col gap-2 min-h-0"
            style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
          >
            <div v-if="recentChatMessages.length === 0" class="flex flex-col items-center justify-center h-full gap-2 text-center px-3">
              <span class="material-icons text-2xl text-[#33445a]">forum</span>
              <p class="text-[11px] text-[#8598ad]">スライドについて Claude に質問・指示できます</p>
            </div>
            <template v-for="msg in recentChatMessages" :key="msg.uuid">
              <div :class="msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'">
                <div
                  :class="[
                    'max-w-[90%] px-2.5 py-1.5 rounded-lg text-[12px] break-words leading-relaxed whitespace-pre-wrap',
                    msg.role === 'user' ? 'bg-[#123762] text-[#e4eefa] border border-[#2c4f82]' : 'bg-[#16222f] text-[#d3e2f1] border border-[#2a3b4e]',
                  ]"
                >
                  {{ msg.text }}
                </div>
              </div>
            </template>
            <!-- 実行中インジケーター -->
            <div v-if="agentRunning" class="flex justify-start">
              <div class="bg-[#16222f] border border-[#2a3b4e] px-2.5 py-1.5 rounded-lg">
                <span class="text-[11px] text-[#9fc0dd] animate-pulse">● 考えています…</span>
              </div>
            </div>
          </div>

          <!-- クイックアクション -->
          <div class="px-2 py-1.5 flex flex-wrap gap-1 border-t border-[#0d1628]">
            <button
              v-for="hint in QUICK_HINTS"
              :key="hint"
              class="text-[10px] bg-[#0f1c2c] hover:bg-[#15273c] text-[#93b2d0] hover:text-[#cfe6ff] px-2 py-0.5 rounded border border-[#1c2f45] hover:border-[#2a4568] transition-colors"
              :disabled="agentRunning"
              @click="sendQuickHint(hint)"
            >
              {{ hint }}
            </button>
          </div>

          <!-- 入力エリア -->
          <div class="px-2 pb-2 pt-1 flex-shrink-0">
            <div class="flex gap-1 items-end">
              <textarea
                ref="chatInputEl"
                v-model="chatInput"
                class="flex-1 bg-[#0d1a28] border border-[#1c2f45] focus:border-[#2f5a94] rounded text-[12px] text-[#e4eefa] placeholder-[#5f7286] px-2 py-1.5 resize-none focus:outline-none transition-colors"
                rows="3"
                placeholder="指示を入力… (Ctrl+Enter で送信)"
                @keydown.ctrl.enter.prevent="sendChatMessage"
                @keydown.meta.enter.prevent="sendChatMessage"
              />
              <button
                class="flex-shrink-0 self-end p-1.5 rounded bg-[#1a4a8a] hover:bg-[#2a5a9a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                :disabled="!chatInput.trim() || agentRunning"
                aria-label="送信"
                @click="sendChatMessage"
              >
                <span class="material-icons text-sm text-white">send</span>
              </button>
            </div>
          </div>

          <!-- チャット新規化の確認ダイアログ（メッセージが残っている時だけ表示） -->
          <div v-if="chatClearConfirmOpen" class="absolute inset-0 z-20 flex items-center justify-center bg-black/60 px-4">
            <div class="w-full max-w-[240px] rounded-lg border border-[#26405f] bg-[#0d1626] p-3 shadow-xl">
              <p class="text-[12px] font-bold text-[#cfe6ff] mb-1">チャットを新規化しますか？</p>
              <p class="text-[11px] leading-snug text-[#8fa9c6] mb-3">
                今のやり取りを終了して新しいチャットを開始します。編集画面は閉じません。これまでの会話は履歴に残ります。
              </p>
              <div class="flex justify-end gap-2">
                <button
                  class="text-[11px] px-2.5 py-1 rounded border border-[#2a3b4e] text-[#93b2d0] hover:text-[#cfe6ff] hover:border-[#3a5476] transition-colors"
                  @click="chatClearConfirmOpen = false"
                >
                  キャンセル
                </button>
                <button class="text-[11px] px-2.5 py-1 rounded bg-[#1a4a8a] hover:bg-[#2a5a9a] text-white transition-colors" @click="clearChat">
                  新規化する
                </button>
              </div>
            </div>
          </div>
        </div>
        <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
      </div>
    </template>

    <!-- ── canvas 更新モーダル（COM ページキャンバス再生成・SSE） ── -->
    <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- internal slide-editing tool; not subject to i18n -->
    <div v-if="refreshModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeRefreshModal">
      <div class="w-[32rem] max-w-[90vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">refresh</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">ページキャンバスを更新</span>
          <button
            class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30"
            :disabled="refreshPhase === 'running'"
            aria-label="閉じる"
            @click="closeRefreshModal"
          >
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <!-- 確認フェーズ -->
        <div v-if="refreshPhase === 'confirm'" class="px-4 py-3 space-y-3 text-[#8aacd0]">
          <p class="text-xs leading-relaxed">
            <span v-if="dirtyCount > 0"
              ><b class="text-yellow-300">{{ dirtyCount }} ページ</b>が再生成待ちです。</span
            >
            <span v-else>再生成待ちのページはありません（全ページ再生成は下のチェックを入れてください）。</span>
          </p>
          <div class="flex items-start gap-2 bg-[#2a1a0a] border border-[#5a3a10] rounded px-3 py-2">
            <span class="material-icons text-sm text-yellow-500 mt-0.5">warning</span>
            <p class="text-[11px] text-yellow-200 leading-relaxed">
              PowerPoint(COM)で描画します。実行前に <b>PowerPoint をすべて終了</b>してください（起動中は中止されます）。
            </p>
          </div>
          <label class="flex items-center gap-2 text-[11px] text-[#6a8aaa] cursor-pointer">
            <input v-model="refreshFull" type="checkbox" class="accent-[#3a78cc]" />
            全ページを強制再生成（dirty でないページも含む）
          </label>
        </div>

        <!-- SSE ログ -->
        <div
          v-else
          class="px-4 py-3 font-mono text-[11px] text-[#7aa0c0] bg-[#060b14] max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
        >
          <div v-for="(line, i) in refreshLog" :key="i">{{ line }}</div>
          <div v-if="refreshPhase === 'running'" class="text-yellow-300 animate-pulse">処理中...</div>
        </div>

        <!-- フッター -->
        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button
            v-if="refreshPhase === 'confirm'"
            class="px-3 py-1.5 rounded text-xs text-[#8aacd0] bg-[#16233c] hover:bg-[#1e2e48]"
            @click="closeRefreshModal"
          >
            キャンセル
          </button>
          <button v-if="refreshPhase === 'confirm'" class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]" @click="runCanvasRefresh">
            更新を実行
          </button>
          <button v-if="refreshPhase === 'done'" class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]" @click="closeRefreshModal">
            閉じる
          </button>
        </div>
      </div>
    </div>

    <!-- テーマ適用モーダル（Phase2・全ページ配色再適用の進捗） -->
    <div v-if="themeModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeThemeModal">
      <div class="w-[32rem] max-w-[90vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">palette</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">テーマ「{{ pendingTheme }}」を適用中</span>
          <button
            class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30"
            :disabled="themePhase === 'running'"
            aria-label="閉じる"
            @click="closeThemeModal"
          >
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <!-- SSE ログ -->
        <div
          class="px-4 py-3 font-mono text-[11px] text-[#7aa0c0] bg-[#060b14] max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
        >
          <div v-for="(line, i) in themeLog" :key="i">{{ line }}</div>
          <div v-if="themePhase === 'running'" class="text-yellow-300 animate-pulse">配色を適用中...</div>
          <div v-if="themePhase === 'done'" class="text-green-300">完了しました。高解像度の反映は「canvas 更新」で行ってください。</div>
          <div v-if="themePhase === 'error'" class="text-red-300">適用できませんでした。上のメッセージをご確認ください。</div>
        </div>

        <!-- フッター -->
        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button v-if="themePhase !== 'running'" class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]" @click="closeThemeModal">
            閉じる
          </button>
        </div>
      </div>
    </div>

    <!-- テンプレート適用モーダル（全ページをテンプレ土台に作り替え・確認 → SSE） -->
    <div v-if="templateModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeTemplateModal">
      <div class="w-[32rem] max-w-[90vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">dashboard_customize</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">テンプレート「{{ pendingTemplate }}」を適用</span>
          <button
            class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30"
            :disabled="templatePhase === 'running'"
            aria-label="閉じる"
            @click="closeTemplateModal"
          >
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <!-- 確認フェーズ -->
        <div v-if="templatePhase === 'confirm'" class="px-4 py-3 space-y-3 text-[#8aacd0]">
          <p class="text-xs leading-relaxed">
            全ページを <b class="text-[#6aaade]">{{ pendingTemplate }}</b> の土台に作り替えます。各ページの中身（タイトル・本文・画像）を
            テンプレに転記し、先頭を表紙・他を本文として配置し直します。
          </p>
          <div class="flex items-start gap-2 bg-[#2a1a0a] border border-[#5a3a10] rounded px-3 py-2">
            <span class="material-icons text-sm text-yellow-500 mt-0.5">warning</span>
            <p class="text-[11px] text-yellow-200 leading-relaxed">
              既存レイアウトはテンプレのものに置き換わります。日付・版番号は保持し、テーマ未適用のデッキはプレーンになります。
              帯と本文が重なる箇所は適用後に微調整してください。
            </p>
          </div>
        </div>

        <!-- SSE ログ -->
        <div
          v-else
          class="px-4 py-3 font-mono text-[11px] text-[#7aa0c0] bg-[#060b14] max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
        >
          <div v-for="(line, i) in templateLog" :key="i">{{ line }}</div>
          <div v-if="templatePhase === 'running'" class="text-yellow-300 animate-pulse">テンプレを適用中...</div>
          <div v-if="templatePhase === 'done'" class="text-green-300">完了しました。高解像度の反映は「canvas 更新」で行ってください。</div>
          <div v-if="templatePhase === 'error'" class="text-red-300">適用できませんでした。上のメッセージをご確認ください。</div>
        </div>

        <!-- フッター -->
        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button
            v-if="templatePhase === 'confirm'"
            class="px-3 py-1.5 rounded text-xs text-[#8aacd0] bg-[#16233c] hover:bg-[#1e2e48]"
            @click="closeTemplateModal"
          >
            キャンセル
          </button>
          <button v-if="templatePhase === 'confirm'" class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]" @click="runApplyTemplate">
            適用を実行
          </button>
          <button
            v-if="templatePhase === 'done' || templatePhase === 'error'"
            class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]"
            @click="closeTemplateModal"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>

    <!-- リリースモーダル（combine（COM 結合）→ ReleasedVersion 生成 → サーバー自動 Windows push） -->
    <div v-if="releaseModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeReleaseModal">
      <div class="w-[34rem] max-w-[90vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4acc7a]">publish</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">リリース — {{ wdId }}（{{ version }}）</span>
          <button
            class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30"
            :disabled="releasePhase === 'running'"
            aria-label="閉じる"
            @click="closeReleaseModal"
          >
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <!-- ① 出力ファイル名の確認 -->
        <div v-if="releasePhase === 'choose'" class="px-4 py-3 space-y-3 text-[#8aacd0]">
          <label class="block">
            <span class="text-xs font-medium">リリースファイル名（ReleasedVersion/ に生成）</span>
            <input
              v-model="releaseFilename"
              type="text"
              class="mt-1 w-full bg-[#060b14] border border-[#1a2a44] rounded px-2 py-1.5 text-xs font-mono text-[#9ac0e0]"
            />
          </label>
          <p class="text-[11px] text-[#6a8aaa] leading-relaxed">
            現在のバージョンを結合（COM）して 1 つの pptx を生成し、サーバーが Windows(D:) の
            <b class="text-[#8ab4e8]">ReleasedVersion</b> へ自動でコピー（逆同期）します。
          </p>
          <div v-if="dirtyCount > 0" class="flex items-start gap-2 bg-[#2a1a0a] border border-[#5a3a10] rounded px-3 py-2">
            <span class="material-icons text-sm text-yellow-500 mt-0.5">info</span>
            <p class="text-[11px] text-yellow-200 leading-relaxed">
              canvas 未更新のページが {{ dirtyCount }} 枚ありますが、結合は各ページの pptx
              を直接読むためリリース内容は最新です（プレビュー画像の再生成待ちなだけ）。
            </p>
          </div>
        </div>

        <!-- ② SSE ログ -->
        <div
          v-else
          class="px-4 py-3 font-mono text-[11px] text-[#7aa0c0] bg-[#060b14] max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
        >
          <div v-for="(line, i) in releaseLog" :key="i">{{ line }}</div>
          <div v-if="releasePhase === 'running'" class="text-yellow-300 animate-pulse">リリース中...</div>
          <div v-if="releasePhase === 'done' && releasePushedToWindows" class="text-green-300">リリースが完了し、Windows(D:) へも反映されました。</div>
          <div v-if="releasePhase === 'done' && !releasePushedToWindows" class="text-green-300">
            ReleasedVersion（WSL）を生成しました。上のログで Windows(D:) への反映（📤）をご確認ください。
          </div>
          <div v-if="releasePhase === 'error'" class="text-red-300">リリースできませんでした。上のメッセージをご確認ください。</div>
        </div>

        <!-- フッター -->
        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button
            v-if="releasePhase === 'choose'"
            class="px-3 py-1.5 rounded text-xs text-[#8aacd0] bg-[#16233c] hover:bg-[#1e2e48]"
            @click="closeReleaseModal"
          >
            キャンセル
          </button>
          <button
            v-if="releasePhase === 'choose'"
            class="px-3 py-1.5 rounded text-xs text-white bg-green-700 hover:bg-green-600 disabled:opacity-40"
            :disabled="!releaseFilename.trim()"
            @click="runRelease"
          >
            リリース実行
          </button>
          <button
            v-if="releasePhase === 'done' || releasePhase === 'error'"
            class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]"
            @click="closeReleaseModal"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>

    <!-- 頁チェックアウトモーダル（選択ページを Windows へ出す・複数可・SSE） -->
    <div v-if="checkoutModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeCheckoutModal">
      <div class="w-[42rem] max-w-[92vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">file_download</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">ページをチェックアウト — {{ wdId }}（{{ version }}）</span>
          <button
            class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30"
            :disabled="checkoutPhase === 'running'"
            aria-label="閉じる"
            @click="closeCheckoutModal"
          >
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <!-- 選択フェーズ：サムネ一覧＋チェックボックス（ロック済みは選択不可） -->
        <div v-if="checkoutPhase === 'choose'" class="px-4 py-3 space-y-3">
          <p class="text-[11px] text-[#8aacd0] leading-relaxed">
            Windows(D:) で手編集するページを選んでください（複数可）。チェックアウト中のページは Claude
            編集・一括操作（テーマ／テンプレ適用）・リリースがブロックされます。
          </p>
          <div class="grid grid-cols-4 gap-2 max-h-[22rem] overflow-y-auto pr-1" style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent">
            <label
              v-for="page in allPages"
              :key="page.id"
              class="relative flex flex-col items-center gap-1 p-1.5 rounded border cursor-pointer"
              :class="
                page.checkedOut
                  ? 'border-red-800 opacity-60 cursor-not-allowed'
                  : checkoutSelected.has(page.id)
                    ? 'border-[#4a8acc] bg-[#0a1830]'
                    : 'border-[#1a2a44] hover:border-[#2a3a60]'
              "
            >
              <img :src="thumbUrl(page)" class="w-full aspect-video object-contain bg-[#060b14] rounded" alt="" />
              <div class="flex items-center gap-1 text-[10px] text-[#8aacd0]">
                <input
                  type="checkbox"
                  class="accent-[#4a8acc]"
                  :disabled="page.checkedOut"
                  :checked="checkoutSelected.has(page.id)"
                  @change="toggleCheckoutPage(page.id)"
                />
                <span>p.{{ page.pageNo }}</span>
                <span v-if="page.checkedOut" class="text-red-300 font-bold">CO中</span>
              </div>
            </label>
          </div>
        </div>

        <!-- SSE ログ -->
        <div
          v-else
          class="px-4 py-3 font-mono text-[11px] text-[#7aa0c0] bg-[#060b14] max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
        >
          <div v-for="(line, i) in checkoutLog" :key="i">{{ line }}</div>
          <div v-if="checkoutPhase === 'running'" class="text-yellow-300 animate-pulse">チェックアウト中...</div>
          <div v-if="checkoutPhase === 'done'" class="text-green-300">
            完了しました。Windows の .checkedoutpages で編集し、「チェックイン」で戻してください。
          </div>
        </div>

        <!-- フッター -->
        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button
            v-if="checkoutPhase === 'choose'"
            class="px-3 py-1.5 rounded text-xs text-[#8aacd0] bg-[#16233c] hover:bg-[#1e2e48]"
            @click="closeCheckoutModal"
          >
            キャンセル
          </button>
          <button
            v-if="checkoutPhase === 'choose'"
            class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a] disabled:opacity-40"
            :disabled="checkoutSelected.size === 0"
            @click="runPageCheckout"
          >
            チェックアウト実行（{{ checkoutSelected.size }}）
          </button>
          <button
            v-if="checkoutPhase === 'done' || checkoutPhase === 'error'"
            class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]"
            @click="closeCheckoutModal"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>

    <!-- 頁チェックインモーダル（戻す(apply)/破棄(discard) を各行で選ぶ・SSE） -->
    <div v-if="checkinModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeCheckinModal">
      <div class="w-[42rem] max-w-[92vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">file_upload</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">ページをチェックイン — {{ wdId }}（{{ version }}）</span>
          <button
            class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30"
            :disabled="checkinPhase === 'running'"
            aria-label="閉じる"
            @click="closeCheckinModal"
          >
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <!-- 選択フェーズ：ロック中ページ一覧＋各行 apply/discard -->
        <div v-if="checkinPhase === 'choose'" class="px-4 py-3 space-y-3">
          <p class="text-[11px] text-[#8aacd0] leading-relaxed">
            チェックアウト中のページを戻します。各ページで「戻す」（Windows の編集を取り込む）か「破棄」（取り込まずロックだけ解除）を選べます。
          </p>
          <div class="space-y-2 max-h-[22rem] overflow-y-auto pr-1" style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent">
            <div v-for="page in lockedPages" :key="page.id" class="flex items-center gap-3 p-2 rounded border border-[#1a2a44] bg-[#0a1220]">
              <img :src="thumbUrl(page)" class="w-20 aspect-video object-contain bg-[#060b14] rounded flex-shrink-0" alt="" />
              <div class="flex-1 min-w-0">
                <div class="text-xs text-[#8aacd0] truncate">p.{{ page.pageNo }} {{ page.title }}</div>
                <div class="text-[10px] text-red-300">
                  CO中<template v-if="page.checkoutBy">（{{ page.checkoutBy }}）</template>
                </div>
              </div>
              <label class="flex items-center gap-1 text-[11px] text-[#8aacd0] cursor-pointer">
                <input
                  type="radio"
                  class="accent-[#4a8acc]"
                  :name="`ci-${page.id}`"
                  :checked="checkinModes[page.id] !== 'discard'"
                  @change="setCheckinMode(page.id, 'apply')"
                />
                戻す
              </label>
              <label class="flex items-center gap-1 text-[11px] text-yellow-300 cursor-pointer">
                <input
                  type="radio"
                  class="accent-yellow-500"
                  :name="`ci-${page.id}`"
                  :checked="checkinModes[page.id] === 'discard'"
                  @change="setCheckinMode(page.id, 'discard')"
                />
                破棄
              </label>
            </div>
          </div>
          <div v-if="lockedPages.length === 0" class="text-[11px] text-[#6a8aaa]">チェックアウト中のページはありません。</div>
        </div>

        <!-- SSE ログ -->
        <div
          v-else
          class="px-4 py-3 font-mono text-[11px] text-[#7aa0c0] bg-[#060b14] max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
        >
          <div v-for="(line, i) in checkinLog" :key="i">{{ line }}</div>
          <div v-if="checkinPhase === 'running'" class="text-yellow-300 animate-pulse">チェックイン中...</div>
          <div v-if="checkinPhase === 'done'" class="text-green-300">完了しました。高解像度の反映は「canvas 更新」で行ってください。</div>
        </div>

        <!-- フッター -->
        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button
            v-if="checkinPhase === 'choose'"
            class="px-3 py-1.5 rounded text-xs text-[#8aacd0] bg-[#16233c] hover:bg-[#1e2e48]"
            @click="closeCheckinModal"
          >
            キャンセル
          </button>
          <button
            v-if="checkinPhase === 'choose'"
            class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a] disabled:opacity-40"
            :disabled="lockedPages.length === 0"
            @click="runPageCheckin"
          >
            チェックイン実行
          </button>
          <button
            v-if="checkinPhase === 'done' || checkinPhase === 'error'"
            class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]"
            @click="closeCheckinModal"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>

    <!-- ── 頁編集モーダル（削除確認 + 削除/移動/追加の SSE 進捗） ── -->
    <div v-if="pageEditModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closePageEditModal">
      <div class="w-[32rem] max-w-[90vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">low_priority</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">{{ pageEditTitle }} — {{ wdId }}（{{ version }}）</span>
          <button
            class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30"
            :disabled="pageEditPhase === 'running'"
            aria-label="閉じる"
            @click="closePageEditModal"
          >
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <!-- ① 削除の確認 -->
        <div v-if="pageEditPhase === 'confirm'" class="px-4 py-3 space-y-3 text-[#8aacd0]">
          <p class="text-xs leading-relaxed">
            この頁を削除します。ページ pptx とプレビュー画像は削除され、後続ページの 通し番号（フッター）は自動で振り直されます。<b class="text-red-300"
              >元に戻せません</b
            >。
          </p>
          <!-- 削除対象のサムネイル（取り違え防止）。 -->
          <div v-if="pendingDelete" class="flex items-center gap-3 p-2 rounded bg-[#060b14] border border-[#1a2a44]">
            <img
              :src="thumbUrl(pendingDelete)"
              :alt="`p.${pendingDelete.pageNo}`"
              class="w-32 flex-shrink-0 rounded border border-[#22304c] object-cover bg-[#141e2e]"
            />
            <div class="min-w-0">
              <div class="text-[11px] font-bold text-[#9fbdd8]">対象: p.{{ pendingDelete.pageNo }}</div>
              <div v-if="pendingDelete.title" class="text-[11px] text-[#6a8aaa] mt-0.5 break-words">{{ pendingDelete.title }}</div>
            </div>
          </div>
        </div>

        <!-- ② SSE ログ -->
        <div
          v-else
          class="px-4 py-3 font-mono text-[11px] text-[#7aa0c0] bg-[#060b14] max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed"
          style="scrollbar-width: thin; scrollbar-color: #1a2a3a transparent"
        >
          <div v-for="(line, i) in pageEditLog" :key="i">{{ line }}</div>
          <div v-if="pageEditPhase === 'running'" class="text-yellow-300 animate-pulse">処理中...</div>
          <div v-if="pageEditPhase === 'done'" class="text-green-300">完了しました。canvas は「更新」ボタンで高解像度化できます。</div>
          <div v-if="pageEditPhase === 'error'" class="text-red-300">実行できませんでした。上のメッセージをご確認ください。</div>
        </div>

        <!-- フッター -->
        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button
            v-if="pageEditPhase === 'confirm'"
            class="px-3 py-1.5 rounded text-xs text-[#8aacd0] bg-[#16233c] hover:bg-[#1e2e48]"
            @click="closePageEditModal"
          >
            キャンセル
          </button>
          <button v-if="pageEditPhase === 'confirm'" class="px-3 py-1.5 rounded text-xs text-white bg-red-700 hover:bg-red-600" @click="confirmDeletePage">
            削除する
          </button>
          <button
            v-if="pageEditPhase === 'done' || pageEditPhase === 'error'"
            class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a]"
            @click="closePageEditModal"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>

    <!-- ── タイトル編集モーダル（現在頁のタイトルを入力・空可） ── -->
    <div v-if="titleModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeTitleModal">
      <div class="w-[32rem] max-w-[90vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">title</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">タイトルの編集 — {{ wdId }}（{{ version }}）</span>
          <button class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30" :disabled="peBusy" aria-label="閉じる" @click="closeTitleModal">
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <div class="px-4 py-3 space-y-2 text-[#8aacd0]">
          <div v-if="titleTarget" class="flex items-center gap-3 p-2 rounded bg-[#060b14] border border-[#1a2a44]">
            <img
              :src="thumbUrl(titleTarget)"
              :alt="`p.${titleTarget.pageNo}`"
              class="w-28 flex-shrink-0 rounded border border-[#22304c] object-cover bg-[#141e2e]"
            />
            <div class="min-w-0 text-[11px] text-[#6a8aaa]">対象: p.{{ titleTarget.pageNo }}</div>
          </div>
          <label class="block text-[11px] text-[#7d9cbb]">タイトル（空にすると消去します）</label>
          <input
            v-model="titleInput"
            type="text"
            :disabled="titleLoading || peBusy"
            maxlength="500"
            class="w-full px-2 py-1.5 rounded bg-[#060b14] border border-[#22304c] text-xs text-[#cfe0f0] focus:border-[#3a78cc] focus:outline-none disabled:opacity-50"
            :placeholder="titleLoading ? '読み込み中...' : 'タイトルを入力（空も可）'"
            @keydown.enter="confirmEditTitle"
          />
          <p v-if="titleError" class="text-[11px] text-red-300">{{ titleError }}</p>
        </div>

        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button class="px-3 py-1.5 rounded text-xs text-[#8aacd0] bg-[#16233c] hover:bg-[#1e2e48]" :disabled="peBusy" @click="closeTitleModal">
            キャンセル
          </button>
          <button
            class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a] disabled:opacity-40"
            :disabled="peBusy || titleLoading"
            @click="confirmEditTitle"
          >
            設定する
          </button>
        </div>
      </div>
    </div>

    <!-- ── テキストボックス編集モーダル（本文テキストボックスの文字列を入力・空可） ── -->
    <div v-if="tbModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeTextboxModal">
      <div class="w-[38rem] max-w-[92vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">text_fields</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">テキストの編集 — {{ wdId }}（{{ version }}）</span>
          <button class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30" :disabled="peBusy" aria-label="閉じる" @click="closeTextboxModal">
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <div class="px-4 py-3 space-y-2 text-[#8aacd0]">
          <label class="block text-[11px] text-[#7d9cbb]">テキスト（改行で段落・空にすると消去します）</label>
          <textarea
            v-model="tbInput"
            :disabled="peBusy"
            rows="8"
            maxlength="5000"
            class="w-full px-2 py-1.5 rounded bg-[#060b14] border border-[#22304c] text-xs text-[#cfe0f0] leading-relaxed focus:border-[#3a78cc] focus:outline-none disabled:opacity-50 resize-y"
            placeholder="テキストを入力（空も可）"
          ></textarea>
          <p class="text-[10px] text-[#5a7593]">※ 段落内の部分的な書式（一部だけ太字・色替え）は段落先頭の書式に揃います。長文は枠内に自動縮小されます。</p>
        </div>

        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button class="px-3 py-1.5 rounded text-xs text-[#8aacd0] bg-[#16233c] hover:bg-[#1e2e48]" :disabled="peBusy" @click="closeTextboxModal">
            キャンセル
          </button>
          <button
            class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a] disabled:opacity-40"
            :disabled="peBusy"
            @click="confirmEditTextbox"
          >
            設定する
          </button>
        </div>
      </div>
    </div>

    <!-- ── セクション編集モーダル（追加／リネーム／削除の確認・入力） ── -->
    <div v-if="sectionModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60" @click.self="closeSectionModal">
      <div class="w-[30rem] max-w-[90vw] bg-[#0d1526] border border-[#1a2a44] rounded-lg shadow-2xl overflow-hidden">
        <div class="flex items-center gap-2 px-4 py-2.5 bg-[#0a1830] border-b border-[#1a2a44]">
          <span class="material-icons text-sm text-[#4a8acc]">segment</span>
          <span class="text-sm font-bold text-[#8aacd0] flex-1">
            {{ sectionModalMode === "add" ? "セクションの追加" : sectionModalMode === "rename" ? "セクションのリネーム" : "セクションの削除" }} — {{ wdId }}（{{
              version
            }}）
          </span>
          <button class="text-[#3a5a7a] hover:text-[#6a9acc] disabled:opacity-30" :disabled="peBusy" aria-label="閉じる" @click="closeSectionModal">
            <span class="material-icons text-sm">close</span>
          </button>
        </div>

        <div class="px-4 py-3 space-y-3 text-[#8aacd0]">
          <!-- 追加：挿入位置 -->
          <div v-if="sectionModalMode === 'add'" class="space-y-1">
            <label class="block text-[11px] text-[#7d9cbb]">挿入位置</label>
            <select
              v-model.number="sectionInsertIndex"
              class="w-full bg-[#0d1a28] border border-[#1c2f45] focus:border-[#2f5a94] rounded text-xs text-[#e4eefa] px-2 py-1.5 focus:outline-none"
            >
              <option v-for="slot in sectionSlots" :key="slot.index" :value="slot.index">
                「{{ slot.afterName }}」の後{{ slot.beforeName ? `（「${slot.beforeName}」の前）` : "（末尾）" }}
              </option>
            </select>
          </div>

          <!-- 追加／リネーム：名前入力 -->
          <div v-if="sectionModalMode !== 'delete'" class="space-y-1">
            <label class="block text-[11px] text-[#7d9cbb]">{{ sectionModalMode === "add" ? "新しいセクション名" : "新しい名前" }}</label>
            <input
              v-model="sectionNameInput"
              type="text"
              class="w-full bg-[#0d1a28] border border-[#1c2f45] focus:border-[#2f5a94] rounded text-xs text-[#e4eefa] placeholder-[#5f7286] px-2 py-1.5 focus:outline-none"
              placeholder="例: 概要 / 手順 / 補足"
              @keydown.enter.prevent="confirmSectionModal"
            />
            <p v-if="sectionNameError" class="text-[11px] text-red-300">{{ sectionNameError }}</p>
            <p class="text-[10px] text-[#5a7593] leading-relaxed">同名・予約名（Thank You 系・未分類）は使えません。表紙と Thank You の位置は固定です。</p>
          </div>

          <!-- 削除：確認 -->
          <div v-else class="space-y-2">
            <p class="text-xs leading-relaxed">
              セクション <b class="text-[#9fbdd8]">「{{ sectionTargetName }}」</b> を削除します。<br />
              このセクションは空（頁 0）なので、頁は失われません。
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-2 px-4 py-2.5 bg-[#0a1220] border-t border-[#1a2a44]">
          <button class="px-3 py-1.5 rounded text-xs text-[#8aacd0] bg-[#16233c] hover:bg-[#1e2e48]" :disabled="peBusy" @click="closeSectionModal">
            キャンセル
          </button>
          <button
            v-if="sectionModalMode === 'delete'"
            class="px-3 py-1.5 rounded text-xs text-white bg-red-700 hover:bg-red-600 disabled:opacity-40"
            :disabled="peBusy"
            @click="confirmSectionModal"
          >
            削除する
          </button>
          <button
            v-else
            class="px-3 py-1.5 rounded text-xs text-white bg-[#1a4a8a] hover:bg-[#2a5a9a] disabled:opacity-40"
            :disabled="peBusy || !sectionNameCheck.ok"
            @click="confirmSectionModal"
          >
            {{ sectionModalMode === "add" ? "追加する" : "変更する" }}
          </button>
        </div>
      </div>
    </div>
    <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { PAGE_ROUTES } from "../router/pageRoutes";
import { apiGet, apiFetchRaw } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { useAppApi } from "../composables/useAppApi";
import { useActiveSession } from "../composables/useActiveSession";
import { useSlideEditor, UNAPPLIED_THEME } from "../composables/useSlideEditor";
import {
  parseVersionDirs,
  isVersionName,
  buildDeck,
  isEditableSection,
  canEditTitle,
  canEditTextboxes,
  computeMoveTarget,
  sidebarNavTarget,
  canMoveSection,
  sectionInsertSlots,
  validateNewSectionName,
  type SlideStructure,
  type SlideManifest,
  type DeckModel,
  type DeckPage,
} from "../utils/slides/slideDeck";
import { SLIDE_ROLE_ID } from "../utils/slides/newDeck";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const appApi = useAppApi();
const activeSessionRef = useActiveSession();
const slideEditor = useSlideEditor();

// チェックアウト中の一括操作ブロックでサーバーが返す HTTP ステータス（409 Conflict）。
const HTTP_CONFLICT = 409;

// Matches the server's TreeNode shape returned by /api/files/dir
interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

// ── State ───────────────────────────────────────────────────────────────────

const loading = ref(false);
const loadError = ref<string | null>(null);
const waiting = ref(false); // 編集用バージョン未生成 → ポーリング待機
const deck = ref<DeckModel | null>(null);
const version = ref<string>(""); // 開いている version フォルダ名（例: v001）
const sourcePptx = ref<string>(""); // structure.source.from（派生元の版名 or 元 pptx 名）
const sourceKind = ref<string>(""); // structure.source.kind（"released" | "editing" | …）
const currentId = ref<string>("");
const collapsedSections = ref(new Set<number>());
const sidebarEl = ref<HTMLDivElement | null>(null);
// ページキャンバス（.pagecanvas/）の読み込みに失敗したページ ID セット。
// 失敗したページはサムネイル（.thumbcache/）にフォールバックする。
const canvasFailed = ref(new Set<string>());
// canvas 更新後に画像 URL を強制再取得させるためのキャッシュバスター。
const reloadNonce = ref(0);

// ── canvas 更新モーダル（COM ページキャンバス再生成・SSE） ─────────────────────
const refreshModalOpen = ref(false);
const refreshPhase = ref<"confirm" | "running" | "done">("confirm");
const refreshFull = ref(false);
const refreshLog = ref<string[]>([]);

// ── テーマ適用モーダル（Phase2・全ページ配色再適用・SSE） ─────────────────────
const themeModalOpen = ref(false);
const themePhase = ref<"running" | "done" | "error">("running");
const themeLog = ref<string[]>([]);
const pendingTheme = ref<string>("");

// ── テンプレート適用モーダル（全ページをテンプレ土台に作り替え・確認 → SSE） ─────
const templateModalOpen = ref(false);
const templatePhase = ref<"confirm" | "running" | "done" | "error">("confirm");
const templateLog = ref<string[]>([]);
const pendingTemplate = ref<string>("");

// ── リリースモーダル（combine（COM 結合）→ ReleasedVersion 生成 → 自動 Windows push・SSE） ─
const releaseModalOpen = ref(false);
const releasePhase = ref<"choose" | "running" | "done" | "error">("choose");
const releaseLog = ref<string[]>([]);
const releaseFilename = ref<string>("");
/** SSE ログに「📤 D: へ push」行が出たか＝実際に Windows(D:) へコピーされたか。
 *  完了メッセージで D: 反映を過大表示しないため（未反映なら ReleasedVersion 生成のみ表記）。 */
const releasePushedToWindows = computed<boolean>(() => releaseLog.value.some((line) => line.includes("📤")));

/** dirty（canvas 再生成待ち）ページ数。ヘッダーバッジと確認文言に使う。 */
const dirtyCount = computed<number>(() => deck.value?.pages.filter((page) => page.dirty).length ?? 0);

// ── 頁チェックアウト／チェックインモーダル（選択ページを Windows へ往復・SSE） ─────
/** モーダルの状態遷移（選択 → 実行中 → 完了/エラー）。 */
type ModalPhase = "choose" | "running" | "done" | "error";
/** チェックイン各行の扱い（apply＝戻す／discard＝破棄）。 */
type CheckinMode = "apply" | "discard";

const checkoutModalOpen = ref(false);
const checkoutPhase = ref<ModalPhase>("choose");
const checkoutLog = ref<string[]>([]);
const checkoutSelected = ref<Set<string>>(new Set());

const checkinModalOpen = ref(false);
const checkinPhase = ref<ModalPhase>("choose");
const checkinLog = ref<string[]>([]);
/** ページ ID → "apply"（戻す）| "discard"（破棄）。チェックイン各行の選択（既定 apply）。 */
const checkinModes = ref<Record<string, CheckinMode>>({});

/** 全ページ（チェックアウトモーダルの一覧用）。 */
const allPages = computed<DeckPage[]>(() => deck.value?.pages ?? []);
/** チェックアウト中（ロック中）ページ（チェックインモーダルの一覧用）。 */
const lockedPages = computed<DeckPage[]>(() => deck.value?.pages.filter((page) => page.checkedOut) ?? []);
/** チェックアウト中ページ数（リボンの「チェックイン」ボタン活性/バッジ用）。 */
const lockedCount = computed<number>(() => lockedPages.value.length);

// ── Chat pane state ──────────────────────────────────────────────────────────

// The slide-editor chat pane always runs on the "slide" role
// (SLIDE_ROLE_ID, shared via utils/slides/newDeck). sendMessageAs
// forces a session bound to this role without navigating off /slides.

const showChatPane = ref(false);
const chatInput = ref("");
const chatMessagesEl = ref<HTMLDivElement | null>(null);
const chatInputEl = ref<HTMLTextAreaElement | null>(null);
// 「＋新規」＝編集画面は閉じずにチャットだけ新しいセッションへ切り替える（トークン節約用）。
// メッセージが1件でもあれば誤操作防止の確認ダイアログを挟む（空なら即クリア）。
const chatClearConfirmOpen = ref(false);

const QUICK_HINTS = ["このページを説明して", "テキストを修正して", "レイアウトを改善して", "図解にして"] as const;

/** 現在のセッションが実行中かどうか */
const agentRunning = computed(() => activeSessionRef?.value?.isRunning ?? false);

interface ChatMessage {
  uuid: string;
  role: "user" | "assistant";
  text: string;
}

function isTextResponseEntry(result: { toolName: string; data?: unknown }): boolean {
  if (result.toolName !== "text-response") return false;
  const roleData = result.data as { role?: string } | undefined;
  return roleData?.role === "user" || roleData?.role === "assistant";
}

function toTextResponseMessage(result: { uuid: string; message: string; data?: unknown }): ChatMessage {
  const roleData = result.data as { role: string; text?: string };
  return { uuid: result.uuid, role: roleData.role as "user" | "assistant", text: roleData.text ?? result.message ?? "" };
}

/** アクティブセッションから最新20件のテキストメッセージを返す */
const recentChatMessages = computed<ChatMessage[]>(() => {
  const session = activeSessionRef?.value;
  if (!session) return [];
  return session.toolResults.filter(isTextResponseEntry).slice(-20).map(toTextResponseMessage);
});

// メッセージ追加時に自動スクロール
watch(recentChatMessages, () => {
  void nextTick(() => {
    if (chatMessagesEl.value) {
      chatMessagesEl.value.scrollTop = chatMessagesEl.value.scrollHeight;
    }
  });
});

// チャットペインが開いたとき入力欄にフォーカス
watch(showChatPane, (open) => {
  if (open) {
    void nextTick(() => chatInputEl.value?.focus());
  }
});

let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(wdDir: string): void {
  stopPolling();
  pollTimer = setInterval(() => {
    void loadDeckSilent(wdDir);
  }, 3000);
}

// ── Route binding ────────────────────────────────────────────────────────────

const wdId = computed<string | null>(() => {
  const param = route.params.wdId;
  return typeof param === "string" && param.length > 0 ? param : null;
});

// 選択画面から `?version=v002` で開きたい版を指定できる。存在すればその版を、
// 無ければ最新版を開く（discoverVersion 内で解決）。未指定なら最新。
const requestedVersion = computed<string | null>(() => {
  const query = route.query.version;
  const value = Array.isArray(query) ? query[0] : query;
  return typeof value === "string" && isVersionName(value) ? value : null;
});

// ── 頁編集（削除・移動・新規追加・SSE）──────────────────────────────────────────
// リボンの「頁編集」トグル ON でサイドバー各サムネに操作ボタン、編集可能セクション
// 末尾に「＋頁追加」を出す。表紙／Thank You は固定（page_ops.py が拒否・UI も錠前表示）。
const { pageEditMode } = slideEditor; // template auto-unwrap 用に top-level 参照
const peBusy = ref(false); // 頁編集の実行中（多重実行防止）
const pageEditModalOpen = ref(false);
const pageEditPhase = ref<"confirm" | "running" | "done" | "error">("running");
const pageEditLog = ref<string[]>([]);
const pageEditTitle = ref<string>(""); // モーダル見出し（削除/移動/追加）
const pendingDelete = ref<DeckPage | null>(null); // 削除確認中のページ
const pageAddSelectId = ref<string>(""); // 追加完了後に選択する新規ページ ID（PAGE_ID: 行から）

/** ↑↓ 移動が可能か（編集可能範囲の端では false）。 */
function canMovePage(page: DeckPage, direction: -1 | 1): boolean {
  return deck.value !== null && computeMoveTarget(deck.value, page.id, direction) !== null;
}

/** 削除確認モーダルを開く（破壊的操作なので確認フェーズを挟む）。 */
function askDeletePage(page: DeckPage): void {
  if (peBusy.value) return;
  pendingDelete.value = page;
  pageEditTitle.value = "頁の削除";
  pageEditLog.value = [];
  pageEditPhase.value = "confirm";
  pageEditModalOpen.value = true;
}

/** 削除の確定（確認モーダルの「削除する」）。 */
async function confirmDeletePage(): Promise<void> {
  const page = pendingDelete.value;
  if (!page) return;
  await runPageEdit(API_ROUTES.work.pageDelete, { pageIds: [page.id] }, "頁の削除");
  pendingDelete.value = null;
}

/** ↑↓ 移動を即実行（確認なし・進捗モーダル）。移動後もその頁を選択したままにする
 *  （id ネイティブの currentId＋reloadDeck の preserve で維持。連続移動できるように）。 */
async function movePage(page: DeckPage, direction: -1 | 1): Promise<void> {
  if (peBusy.value || !deck.value) return;
  const target = computeMoveTarget(deck.value, page.id, direction);
  if (!target) return;
  currentId.value = page.id; // 移動対象＝選択頁を明示（reloadDeck preserve で維持される）
  await runPageEdit(API_ROUTES.work.pageMove, { pageId: page.id, toSection: target.toSection, toIndex: target.toIndex }, "頁の移動");
}

/** ＋頁追加を即実行（編集可能セクション末尾へ空の本文ページを挿入）。 */
async function addPage(section: string, toIndex: number): Promise<void> {
  if (peBusy.value) return;
  pageAddSelectId.value = "";
  await runPageEdit(API_ROUTES.work.pageAdd, { section, toIndex }, "頁の追加");
}

/** SSE ログの `PAGE_ID:<id>` 行から新規ページ ID を拾う（頁追加時のみ）。 */
function pickAddedPageId(log: string[]): string {
  const marker = "PAGE_ID:";
  const line = log.find((entry) => entry.includes(marker));
  return line ? line.slice(line.indexOf(marker) + marker.length).trim() : "";
}

/** 頁編集後にデッキを再読込し、追加した新規ページがあれば選択する。 */
async function reloadDeckAfterEdit(): Promise<void> {
  await reloadDeck();
  if (pageAddSelectId.value && deck.value?.pages.some((page) => page.id === pageAddSelectId.value)) {
    currentId.value = pageAddSelectId.value;
  }
}

/** 頁編集 SSE の共通実行。成功で deck 再読込（追加時は新規ページを選択）。 */
async function runPageEdit(routePattern: string, body: Record<string, unknown>, label: string): Promise<void> {
  if (!wdId.value || !version.value) return;
  peBusy.value = true;
  pageEditTitle.value = label;
  pageEditModalOpen.value = true;
  pageEditPhase.value = "running";
  pageEditLog.value = [];
  const url = fillRoute(routePattern, wdId.value, version.value);
  try {
    const res = await apiFetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      pageEditLog.value.push(await errorLineFromResponse(res));
      pageEditPhase.value = "error";
      return;
    }
    const done = await drainSse(res.body, pageEditLog);
    pageAddSelectId.value = pickAddedPageId(pageEditLog.value);
    pageEditPhase.value = done ? "done" : "error";
    if (done) await reloadDeckAfterEdit();
  } catch (err) {
    pageEditLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    pageEditPhase.value = "error";
  } finally {
    peBusy.value = false;
  }
}

/** 頁編集モーダルを閉じる（実行中は閉じない）。 */
function closePageEditModal(): void {
  if (peBusy.value) return;
  pageEditModalOpen.value = false;
  pendingDelete.value = null;
}

// ── タイトル編集（現在頁のタイトルを設定・SSE）─────────────────────────────────
// 頁編集モードの操作行「✎タイトル」から。表紙／Thank You は固定（ボタンを出さず・
// page_ops.py も拒否）。開いたとき GET で現在のタイトルを読み初期表示、空も許可（クリア）。
// 進捗表示は共有の頁編集モーダル（runPageEdit）を再利用する。
const titleModalOpen = ref(false);
const titleTarget = ref<DeckPage | null>(null); // タイトル編集中のページ
const titleInput = ref("");
const titleLoading = ref(false); // GET で現在タイトルを取得中
const titleError = ref("");

/** タイトル編集モーダルを開き、現在のタイトルを GET で読み込んで初期表示する。 */
async function askEditTitle(page: DeckPage): Promise<void> {
  if (peBusy.value || !deck.value) return;
  if (!canEditTitle(deck.value, page.id)) return; // 表紙／Thank You は編集不可
  titleTarget.value = page;
  titleInput.value = page.title; // 暫定＝manifest 値。GET 成功で実タイトルに置換
  titleError.value = "";
  titleModalOpen.value = true;
  await loadCurrentTitle(page.id);
}

/** 現在頁の実タイトルを GET で取得して入力欄に反映する（失敗時は manifest 値のまま）。 */
async function loadCurrentTitle(pageId: string): Promise<void> {
  if (!wdId.value || !version.value) return;
  titleLoading.value = true;
  try {
    const res = await apiGet<{ title?: string }>(fillRoute(API_ROUTES.work.pageTitle, wdId.value, version.value), { pageId });
    if (res.ok && titleTarget.value?.id === pageId && typeof res.data.title === "string") {
      titleInput.value = res.data.title;
    } else if (!res.ok) {
      titleError.value = `現在のタイトルを読み込めませんでした（${res.error}）`;
    }
  } catch (err) {
    titleError.value = `現在のタイトルを読み込めませんでした（${err instanceof Error ? err.message : String(err)}）`;
  } finally {
    titleLoading.value = false;
  }
}

/** タイトル設定を実行（空も可）。進捗は共有の頁編集モーダルを再利用。 */
async function confirmEditTitle(): Promise<void> {
  const page = titleTarget.value;
  if (!page || peBusy.value || titleLoading.value) return;
  const title = titleInput.value;
  titleModalOpen.value = false;
  await runPageEdit(API_ROUTES.work.pageSetTitle, { pageId: page.id, title }, "タイトルの設定");
}

/** タイトル編集モーダルを閉じる（実行中は閉じない）。 */
function closeTitleModal(): void {
  if (peBusy.value) return;
  titleModalOpen.value = false;
  titleTarget.value = null;
}

// ── セクション編集（追加・移動・削除・リネーム・SSE）─────────────────────────────
// 頁編集モード（pageEditMode）ON でセクション見出し行に ↑↓/✎/🗑 と、末尾に「＋セクション
// 追加」を出す。表紙（先頭）／Thank You は固定（page_ops.py が拒否・UI も錠前）。SSE 実行は
// 頁編集と同じ runPageEdit を再利用（section-* は PAGE_ID を返さないので単に再読込する）。
type SectionModalMode = "add" | "rename" | "delete";
const sectionModalOpen = ref(false);
const sectionModalMode = ref<SectionModalMode>("add");
const sectionNameInput = ref(""); // 追加/リネームの新しい名前
const sectionTargetName = ref(""); // リネーム/削除の対象セクション名
const sectionInsertIndex = ref(1); // 追加の挿入位置（sections 配列の index）

/** 追加モーダルで選べる挿入位置（先頭『表紙』の後〜Thank You の前）。 */
const sectionSlots = computed(() => (deck.value ? sectionInsertSlots(deck.value) : []));

/** 新しい名前の事前検証（空・予約名・重複）。python が真実源だが即時フィードバック用。 */
const sectionNameCheck = computed(() => {
  const names = deck.value?.sections.map((sec) => sec.name) ?? [];
  const exclude = sectionModalMode.value === "rename" ? sectionTargetName.value : undefined;
  return validateNewSectionName(sectionNameInput.value, names, exclude);
});

/** 事前検証エラーの日本語文言（空文字＝エラーなし）。 */
const sectionNameError = computed(() => {
  if (sectionModalMode.value === "delete") return "";
  const check = sectionNameCheck.value;
  if (check.ok) return "";
  if (check.problem === "empty") return "セクション名を入力してください";
  if (check.problem === "reserved") return "その名前は予約されています（Thank You 系・未分類 は使えません）";
  return "同名のセクションが既にあります";
});

/** ↑↓ でセクションを動かせるか（編集可能帯の端では false）。 */
function canMoveSectionUI(name: string, direction: -1 | 1): boolean {
  return deck.value !== null && canMoveSection(deck.value, name, direction);
}

/** セクション追加モーダルを開く（既定の挿入位置＝Thank You の直前）。 */
function askAddSection(): void {
  if (peBusy.value || !deck.value) return;
  const slots = sectionInsertSlots(deck.value);
  sectionModalMode.value = "add";
  sectionNameInput.value = "";
  sectionInsertIndex.value = slots.length ? slots[slots.length - 1].index : 1;
  sectionModalOpen.value = true;
}

/** セクションリネームモーダルを開く（現在名を初期値に）。 */
function askRenameSection(name: string): void {
  if (peBusy.value) return;
  sectionModalMode.value = "rename";
  sectionTargetName.value = name;
  sectionNameInput.value = name;
  sectionModalOpen.value = true;
}

/** セクション削除の確認モーダルを開く（空セクションのみ・ボタンは非空で非活性）。 */
function askDeleteSection(name: string): void {
  if (peBusy.value) return;
  sectionModalMode.value = "delete";
  sectionTargetName.value = name;
  sectionModalOpen.value = true;
}

/** セクションモーダルを閉じる（実行中は閉じない）。 */
function closeSectionModal(): void {
  if (peBusy.value) return;
  sectionModalOpen.value = false;
}

/** ↑↓ 移動を即実行（確認なし・進捗は頁編集モーダルを再利用）。 */
async function moveSection(name: string, direction: "up" | "down"): Promise<void> {
  if (peBusy.value) return;
  await runPageEdit(API_ROUTES.work.sectionMove, { name, direction }, "セクションの移動");
}

/** モーダルの確定（追加／リネーム／削除）。追加・リネームは事前検証を通過した時のみ。 */
async function confirmSectionModal(): Promise<void> {
  const mode = sectionModalMode.value;
  if (mode === "add") {
    if (!sectionNameCheck.value.ok) return;
    const name = sectionNameInput.value.trim();
    const toIndex = sectionInsertIndex.value;
    sectionModalOpen.value = false;
    await runPageEdit(API_ROUTES.work.sectionAdd, { name, toIndex }, "セクションの追加");
    return;
  }
  if (mode === "rename") {
    if (!sectionNameCheck.value.ok) return;
    const name = sectionTargetName.value;
    const toName = sectionNameInput.value.trim();
    sectionModalOpen.value = false;
    if (toName === name) return; // 変更なしは何もしない
    await runPageEdit(API_ROUTES.work.sectionRename, { name, toName }, "セクションのリネーム");
    return;
  }
  const name = sectionTargetName.value;
  sectionModalOpen.value = false;
  await runPageEdit(API_ROUTES.work.sectionDelete, { name }, "セクションの削除");
}

const pptxBasename = computed(() => sourcePptx.value.replace(/\.pptx$/i, ""));

// 派生元ラベル。現在編集中の版番号（deck.version）と紛らわしくならないよう、
// 3 つ目のバッジは必ず「元: …」と前置きして "派生元" であることを明示する。
// released 由来 = 元リリース版 / editing 由来 = 元編集版。
const sourceLabel = computed(() => {
  const from = pptxBasename.value;
  if (!from) return "";
  const origin = sourceKind.value === "released" ? "元リリース" : sourceKind.value === "editing" ? "元編集" : "元";
  return `${origin}: ${from}`;
});

// ── Current-page derivation (id-native) ───────────────────────────────────────

const currentPage = computed<DeckPage | null>(() => {
  if (!deck.value) return null;
  return deck.value.pages.find((page) => page.id === currentId.value) ?? deck.value.pages[0] ?? null;
});

const currentIndex = computed<number>(() => {
  if (!deck.value) return -1;
  return deck.value.pages.findIndex((page) => page.id === currentId.value);
});

// ── テキストボックス編集（本文テキストボックスの文字列を設定・SSE）─────────────────
// リボンの「テキストボックス編集」トグル ON でメインビュー画像上に編集可能 TB の
// ハイライトを重ね、クリックで編集モーダルを開く。表紙／Thank You／未分類／チェックアウト
// 頁は対象外。進捗表示は共有の頁編集モーダル（runPageEdit）を再利用する。
const { textboxEditMode } = slideEditor; // template auto-unwrap 用に top-level 参照

interface TextboxInfo {
  id: number;
  rect: [number, number, number, number]; // [nx, ny, nw, nh]（スライド寸法で 0〜1 正規化）
  text: string;
}
const textboxes = ref<TextboxInfo[]>([]); // 現在頁の編集可能テキストボックス
const mainViewEl = ref<HTMLDivElement | null>(null);
const mainImgEl = ref<HTMLImageElement | null>(null);
// 画像の実描画矩形（mainViewEl 基準の px）。object-contain のレターボックス補正込みで
// getBoundingClientRect から求める。オーバーレイ（% 配置）の基準枠に使う。
const imgBox = ref<{ left: number; top: number; width: number; height: number } | null>(null);

/** メインビュー画像上にテキストボックス編集オーバーレイを出すか（編集可能頁のみ）。 */
const showTextboxOverlay = computed<boolean>(() => {
  if (!textboxEditMode.value || !deck.value || !currentPage.value) return false;
  return canEditTextboxes(deck.value, currentPage.value.id);
});

/** 各テキストボックスの % 配置スタイル（imgBox を基準枠にした割合）。 */
function hotspotStyle(box: TextboxInfo): Record<string, string> {
  const [normLeft, normTop, normWidth, normHeight] = box.rect;
  return {
    left: `${(normLeft * 100).toString()}%`,
    top: `${(normTop * 100).toString()}%`,
    width: `${(normWidth * 100).toString()}%`,
    height: `${(normHeight * 100).toString()}%`,
  };
}

/** mainImgEl の実描画矩形を測って imgBox に反映する（未表示なら null）。 */
function measureImgBox(): void {
  const img = mainImgEl.value;
  const box = mainViewEl.value;
  if (!img || !box) {
    imgBox.value = null;
    return;
  }
  const imgRect = img.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  if (imgRect.width < 1 || imgRect.height < 1) {
    imgBox.value = null;
    return;
  }
  imgBox.value = { left: imgRect.left - boxRect.left, top: imgRect.top - boxRect.top, width: imgRect.width, height: imgRect.height };
}

/** 画像ロード完了で描画矩形を測り直す（オーバーレイ整列用）。 */
function onMainImgLoad(): void {
  measureImgBox();
}

/** 現在頁の編集可能テキストボックスを GET で取得する（読み取り専用）。 */
async function loadTextboxes(pageId: string): Promise<void> {
  if (!wdId.value || !version.value) return;
  try {
    const res = await apiGet<{ editable?: boolean; boxes?: TextboxInfo[] }>(fillRoute(API_ROUTES.work.pageTextboxes, wdId.value, version.value), { pageId });
    if (currentId.value !== pageId) return; // 取得中に頁が変わった
    textboxes.value = res.ok && Array.isArray(res.data.boxes) ? res.data.boxes : [];
  } catch {
    textboxes.value = [];
  } finally {
    await nextTick();
    measureImgBox();
  }
}

// モード ON / 頁変更で TB を取得（対象外頁ならクリア）。deck 再読込後の再取得は保存側で行う。
watch([textboxEditMode, currentId], () => {
  if (showTextboxOverlay.value && currentPage.value) {
    void loadTextboxes(currentPage.value.id);
  } else {
    textboxes.value = [];
  }
});

const onWinResize = (): void => measureImgBox();
onMounted(() => window.addEventListener("resize", onWinResize));
onUnmounted(() => window.removeEventListener("resize", onWinResize));

const tbModalOpen = ref(false);
const tbTarget = ref<TextboxInfo | null>(null); // 編集中の TB
const tbInput = ref("");

/** テキストボックスをクリック → 編集モーダルを開く（現在テキストを prefill）。 */
function openTextboxModal(box: TextboxInfo): void {
  if (peBusy.value) return;
  tbTarget.value = box;
  tbInput.value = box.text;
  tbModalOpen.value = true;
}

/** テキスト設定を実行（空も可）。進捗は共有の頁編集モーダルを再利用し、成功後 TB を再取得。 */
async function confirmEditTextbox(): Promise<void> {
  const box = tbTarget.value;
  const page = currentPage.value;
  if (!box || !page || peBusy.value) return;
  const text = tbInput.value;
  tbModalOpen.value = false;
  await runPageEdit(API_ROUTES.work.pageSetTextbox, { pageId: page.id, shapeId: box.id, text }, "テキストの設定");
  if (showTextboxOverlay.value) await loadTextboxes(page.id);
}

/** テキストボックス編集モーダルを閉じる（実行中は閉じない）。 */
function closeTextboxModal(): void {
  if (peBusy.value) return;
  tbModalOpen.value = false;
  tbTarget.value = null;
}

// ── Navigation ───────────────────────────────────────────────────────────────

function backToPicker(): void {
  router.back();
}

function selectId(pageId: string): void {
  currentId.value = pageId;
}

function selectByIndex(index: number): void {
  if (!deck.value) return;
  const page = deck.value.pages[index];
  if (page) currentId.value = page.id;
}

/**
 * サイドバー（サムネイルペイン）にフォーカスがある時、キーボードで選択頁を切り替える。
 * ↑↓/PgUp/PgDn＝前後の頁、Home/End＝先頭/末尾。既定ではペインが縦スクロール
 * してしまうため、対象キーは preventDefault で抑止して選択移動に置き換える。
 */
function onSidebarKeydown(event: KeyboardEvent): void {
  if (!deck.value) return;
  const next = sidebarNavTarget(event.key, currentIndex.value, deck.value.pages.length);
  if (next === null) return;
  event.preventDefault();
  const page = deck.value.pages[next];
  if (!page) return;
  currentId.value = page.id;
  revealPageInSidebar(page.id);
}

/** 選択頁がサイドバーに見えるよう、折りたたみ中セクションを開いてからスクロールする。 */
function revealPageInSidebar(pageId: string): void {
  if (!deck.value) return;
  const secIndex = deck.value.sections.findIndex((sec) => sec.pages.some((page) => page.id === pageId));
  if (secIndex >= 0 && collapsedSections.value.has(secIndex)) {
    collapsedSections.value.delete(secIndex);
    collapsedSections.value = new Set(collapsedSections.value); // Set の変更を追跡させる
  }
  void nextTick(() => {
    const sel = `[data-page-id="${CSS.escape(pageId)}"]`;
    sidebarEl.value?.querySelector<HTMLElement>(sel)?.scrollIntoView({ block: "nearest" });
  });
}

function toggleSection(idx: number): void {
  if (collapsedSections.value.has(idx)) {
    collapsedSections.value.delete(idx);
  } else {
    collapsedSections.value.add(idx);
  }
  // Trigger reactivity (Set mutations aren't tracked automatically)
  collapsedSections.value = new Set(collapsedSections.value);
}

// ── URL helpers ────────────────────────────────────────────────────────────────

function versionBase(): string {
  return `data/work/${wdId.value}/${version.value}`;
}

function rawUrl(path: string): string {
  return `${API_ROUTES.files.raw}?path=${encodeURIComponent(path)}`;
}

/** 画像 URL にキャッシュバスターを付与（canvas 更新後の再取得用）。 */
function imgUrl(path: string): string {
  const base = rawUrl(path);
  return reloadNonce.value > 0 ? `${base}&_=${reloadNonce.value}` : base;
}

function thumbUrl(page: DeckPage): string {
  if (!wdId.value || !version.value) return "";
  const file = page.thumb ?? `${page.id}_md.png`;
  return imgUrl(`${versionBase()}/.thumbcache/${file}`);
}

/** ページキャンバス（PowerPoint 生成・高解像度）の URL */
function canvasUrl(page: DeckPage): string {
  if (!wdId.value || !version.value) return "";
  const file = page.canvas ?? `${page.id}.png`;
  return imgUrl(`${versionBase()}/.pagecanvas/${file}`);
}

/**
 * メインビュー用 URL。通常はページキャンバス（高解像度）を優先し、
 * 未生成 or 読み込み失敗時はサムネイルにフォールバックする。
 * dirty ページは canvas が古い（COM 未更新）ため、更新済みサムネを優先表示して
 * 編集内容を即座に見せる（canvas 更新で高解像度に置き換わる）。
 */
function mainImgUrl(page: DeckPage): string {
  if (page.dirty) return thumbUrl(page);
  return canvasFailed.value.has(page.id) ? thumbUrl(page) : canvasUrl(page);
}

function onMainImgError(pageId: string): void {
  canvasFailed.value.add(pageId);
  // Set の変更は Vue がトラックしないため新しい Set を代入してリアクティビティを発火
  canvasFailed.value = new Set(canvasFailed.value);
}

// ── canvas 更新（COM ページキャンバス再生成・SSE） ────────────────────────────

function fillRoute(routePattern: string, wdVal: string, ver: string): string {
  return routePattern.replace(":wd", wdVal).replace(":version", ver);
}

function openRefreshModal(): void {
  refreshLog.value = [];
  refreshFull.value = false;
  refreshPhase.value = "confirm";
  refreshModalOpen.value = true;
}

function closeRefreshModal(): void {
  if (refreshPhase.value === "running") return; // 実行中は閉じさせない
  refreshModalOpen.value = false;
}

/** SSE ストリームを読んで指定ログに追記し、DONE を検出する（canvas 更新・テーマ適用で共用）。 */
async function drainSse(body: ReadableStream<Uint8Array>, log: { value: string[] }): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const msg = line.slice(6);
      log.value.push(msg);
      if (msg.startsWith("DONE:")) done = true;
    }
  }
  return done;
}

/** 非 OK レスポンスから表示用のエラー行を作る。サーバーが JSON `{ error, locked }` を
 *  返していればその文言を使い、無ければ `HTTP <status>` に縮退する。409 + locked は
 *  「チェックアウト中の一括操作ブロック」なので、実行不可の理由が伝わる定型文にする。 */
async function errorLineFromResponse(res: Response): Promise<string> {
  let serverMsg = "";
  let locked = false;
  try {
    const data = (await res.json()) as { error?: string; locked?: boolean };
    if (typeof data.error === "string") serverMsg = data.error;
    locked = data.locked === true;
  } catch {
    /* JSON 本文が無い / パース不能 → status への縮退にフォールバック */
  }
  if (res.status === HTTP_CONFLICT && locked) {
    return `⛔ ${serverMsg || "チェックアウト中のページがあるため、この操作は実行できません。先にチェックインしてください。"}`;
  }
  return serverMsg ? `ERROR: ${serverMsg}` : `ERROR: HTTP ${res.status}`;
}

async function runCanvasRefresh(): Promise<void> {
  if (!wdId.value || !version.value) return;
  refreshPhase.value = "running";
  refreshLog.value = [];
  const url = fillRoute(API_ROUTES.work.canvasRefresh, wdId.value, version.value);
  try {
    const res = await apiFetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: refreshFull.value }),
    });
    if (!res.ok || !res.body) {
      refreshLog.value.push(await errorLineFromResponse(res));
      refreshPhase.value = "confirm";
      return;
    }
    const done = await drainSse(res.body, refreshLog);
    refreshPhase.value = done ? "done" : "confirm";
    if (done) await reloadAfterRefresh();
  } catch (err) {
    refreshLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    refreshPhase.value = "confirm";
  }
}

/** canvas 更新完了後にデッキを再読込し、新しい画像を確実に取得する。 */
async function reloadAfterRefresh(): Promise<void> {
  await reloadDeck();
}

// ── テーマ再適用（Phase2・リボンのテーマプルダウン発） ────────────────────────
// デッキ全ページに配色を適用（表紙グラデ／概要帯／本文 Step 色）→ サムネ再生成。
// canvas は dirty になるので後で「更新」ボタンで高解像度化する。

async function runApplyTheme(themeId: string): Promise<void> {
  if (!wdId.value || !version.value) return;
  if (themeId === UNAPPLIED_THEME) return; // 「（未適用）」への差し戻しは不可（適用済みは未適用に戻せない）
  if (themeId === slideEditor.theme.value) return; // 同一テーマは no-op
  pendingTheme.value = themeId;
  themePhase.value = "running";
  themeLog.value = [];
  themeModalOpen.value = true;
  const url = fillRoute(API_ROUTES.work.theme, wdId.value, version.value);
  try {
    const res = await apiFetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: themeId }),
    });
    if (!res.ok || !res.body) {
      themeLog.value.push(await errorLineFromResponse(res));
      themePhase.value = "error";
      return;
    }
    const done = await drainSse(res.body, themeLog);
    themePhase.value = done ? "done" : "error";
    if (done) {
      slideEditor.theme.value = themeId; // プルダウンの選択を確定
      await reloadDeck();
    }
  } catch (err) {
    themeLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    themePhase.value = "error";
  }
}

function closeThemeModal(): void {
  if (themePhase.value === "running") return; // 実行中は閉じさせない
  themeModalOpen.value = false;
}

// ── テンプレート適用（リボンのテンプレ選択発） ────────────────────────────────
// 全ページを指定テンプレの土台に作り替える（整形コピー方式）。破壊的操作なので
// 確認フェーズを挟む。完了後は structure.theme（plain or 維持）が反映される。

/** リボンでテンプレが選ばれたら確認モーダルを開く。 */
function openTemplateModal(templateId: string): void {
  pendingTemplate.value = templateId;
  templateLog.value = [];
  templatePhase.value = "confirm";
  templateModalOpen.value = true;
}

function closeTemplateModal(): void {
  if (templatePhase.value === "running") return; // 実行中は閉じさせない
  templateModalOpen.value = false;
}

async function runApplyTemplate(): Promise<void> {
  if (!wdId.value || !version.value || !pendingTemplate.value) return;
  templatePhase.value = "running";
  templateLog.value = [];
  const url = fillRoute(API_ROUTES.work.applyTemplate, wdId.value, version.value);
  try {
    const res = await apiFetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: pendingTemplate.value }),
    });
    if (!res.ok || !res.body) {
      templateLog.value.push(await errorLineFromResponse(res));
      templatePhase.value = "error";
      return;
    }
    const done = await drainSse(res.body, templateLog);
    templatePhase.value = done ? "done" : "error";
    // 完了後の再読込で structure.theme（plain / 維持）がプルダウンにも反映される。
    if (done) await reloadDeck();
  } catch (err) {
    templateLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    templatePhase.value = "error";
  }
}

// ── リリース（リボンの「リリース」ボタン発） ──────────────────────────────────
// 編集中バージョンの .pages を COM 結合（combine）して ReleasedVersion/<file>.pptx を生成し、
// サーバーが D: 上の該当 WD フォルダへ自動 push する。作業ファイル選択画面の
// リリースと同一の口（API_ROUTES.work.combine）・同一の命名規約を用いる。

/** YYYYMMDD（ローカル日付）。リリース既定ファイル名の日付部に使う。 */
function todayYmd(): string {
  const now = new Date();
  const pad = (num: number): string => String(num).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/** リリース既定ファイル名 `<WD> <title>_<YYYYMMDD>_<version>.pptx`。title は D: フォルダ名
 *  由来（サーバーの resolveWdTitle）。解決失敗時は `<WD>_<YYYYMMDD>_<version>.pptx` に縮退。 */
async function buildDefaultReleaseName(): Promise<string> {
  const wdVal = wdId.value ?? "";
  let title = "";
  try {
    const res = await apiGet<{ title: string | null }>(fillRoute(API_ROUTES.work.wdTitle, wdVal, ""));
    if (res.ok && res.data.title) {
      ({ title } = res.data as { title: string });
    }
  } catch {
    /* タイトル解決失敗は WD-ID のみに縮退（機能は継続） */
  }
  const base = title ? `${wdVal} ${title}` : wdVal;
  return `${base}_${todayYmd()}_${version.value}.pptx`;
}

/** リボンでリリースが押されたら、既定ファイル名を用意して確認モーダルを開く。 */
async function openReleaseModal(): Promise<void> {
  if (!wdId.value || !version.value) return;
  releaseLog.value = [];
  releasePhase.value = "choose";
  releaseFilename.value = await buildDefaultReleaseName();
  releaseModalOpen.value = true;
}

function closeReleaseModal(): void {
  if (releasePhase.value === "running") return; // 実行中は閉じさせない
  releaseModalOpen.value = false;
}

async function runRelease(): Promise<void> {
  if (!wdId.value || !version.value || !releaseFilename.value.trim()) return;
  releasePhase.value = "running";
  releaseLog.value = [];
  const url = fillRoute(API_ROUTES.work.combine, wdId.value, version.value);
  try {
    const res = await apiFetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outFilename: releaseFilename.value.trim() }),
    });
    if (!res.ok || !res.body) {
      releaseLog.value.push(await errorLineFromResponse(res));
      releasePhase.value = "error";
      return;
    }
    const done = await drainSse(res.body, releaseLog);
    releasePhase.value = done ? "done" : "error";
    // 結合時にサーバーが表紙のリリース日を更新するため、デッキを再読込して反映する。
    if (done) await reloadDeck();
  } catch (err) {
    releaseLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    releasePhase.value = "error";
  }
}

// ── 頁チェックアウト（リボンの「チェックアウト」ボタン発） ────────────────────
// 選んだページだけを .checkedoutpages へ出し Windows(D:) へ push（往復）。ロック中は
// Claude 編集・一括操作・リリースがブロックされる。完了後はデッキ再読込でバッジ反映。

function openCheckoutModal(): void {
  checkoutLog.value = [];
  checkoutPhase.value = "choose";
  checkoutSelected.value = new Set();
  checkoutModalOpen.value = true;
}

function closeCheckoutModal(): void {
  if (checkoutPhase.value === "running") return; // 実行中は閉じさせない
  checkoutModalOpen.value = false;
}

function toggleCheckoutPage(pageId: string): void {
  const next = new Set(checkoutSelected.value);
  if (next.has(pageId)) next.delete(pageId);
  else next.add(pageId);
  checkoutSelected.value = next;
}

async function runPageCheckout(): Promise<void> {
  if (!wdId.value || !version.value) return;
  const pageIds = [...checkoutSelected.value];
  if (pageIds.length === 0) return;
  checkoutPhase.value = "running";
  checkoutLog.value = [];
  const url = fillRoute(API_ROUTES.work.pageCheckout, wdId.value, version.value);
  try {
    const res = await apiFetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageIds }),
    });
    if (!res.ok || !res.body) {
      checkoutLog.value.push(await errorLineFromResponse(res));
      checkoutPhase.value = "error";
      return;
    }
    const done = await drainSse(res.body, checkoutLog);
    checkoutPhase.value = done ? "done" : "error";
    if (done) await reloadDeck();
  } catch (err) {
    checkoutLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    checkoutPhase.value = "error";
  }
}

// ── 頁チェックイン（リボンの「チェックイン」ボタン発） ────────────────────────
// チェックアウト中ページを戻す（apply＝編集を取り込む）／破棄（discard＝取り込まず
// ロック解除）。各行で選べる。apply があれば完了後にサムネが自動再生成される。

function openCheckinModal(): void {
  checkinLog.value = [];
  checkinPhase.value = "choose";
  const modes: Record<string, CheckinMode> = {};
  for (const page of lockedPages.value) modes[page.id] = "apply"; // 既定は「戻す」
  checkinModes.value = modes;
  checkinModalOpen.value = true;
}

function closeCheckinModal(): void {
  if (checkinPhase.value === "running") return; // 実行中は閉じさせない
  checkinModalOpen.value = false;
}

function setCheckinMode(pageId: string, mode: CheckinMode): void {
  checkinModes.value = { ...checkinModes.value, [pageId]: mode };
}

async function runPageCheckin(): Promise<void> {
  if (!wdId.value || !version.value) return;
  const apply: string[] = [];
  const discard: string[] = [];
  for (const page of lockedPages.value) {
    if (checkinModes.value[page.id] === "discard") discard.push(page.id);
    else apply.push(page.id);
  }
  if (apply.length === 0 && discard.length === 0) return;
  checkinPhase.value = "running";
  checkinLog.value = [];
  const url = fillRoute(API_ROUTES.work.pageCheckin, wdId.value, version.value);
  try {
    const res = await apiFetchRaw(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply, discard }),
    });
    if (!res.ok || !res.body) {
      checkinLog.value.push(await errorLineFromResponse(res));
      checkinPhase.value = "error";
      return;
    }
    const done = await drainSse(res.body, checkinLog);
    checkinPhase.value = done ? "done" : "error";
    if (done) await reloadDeck();
  } catch (err) {
    checkinLog.value.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    checkinPhase.value = "error";
  }
}

// ── Chat helpers ─────────────────────────────────────────────────────────────

/** 現在のスライドコンテキストをメッセージの先頭に付与する文字列を返す */
function buildSlideContext(): string {
  const page = currentPage.value;
  if (!page || !deck.value || !wdId.value) return "";
  const titlePart = page.title ? ` / タイトル: 「${page.title}」` : "";
  return `[スライド編集] WD: ${wdId.value} ${version.value} / p.${page.pageNo}/${deck.value.totalPages} (id: ${page.id})${titlePart}\n\n`;
}

function sendChatMessage(): void {
  const text = chatInput.value.trim();
  if (!text || agentRunning.value) return;
  appApi.sendMessageAs(buildSlideContext() + text, SLIDE_ROLE_ID);
  chatInput.value = "";
}

function sendQuickHint(hint: string): void {
  if (agentRunning.value) return;
  appApi.sendMessageAs(buildSlideContext() + hint, SLIDE_ROLE_ID);
}

/** チャットだけを新しいセッションへ切り替える（編集画面は閉じない）。
 *  実行中は無効。メッセージが残っていれば確認ダイアログを挟む。 */
function newChat(): void {
  if (agentRunning.value) return;
  if (recentChatMessages.value.length > 0) {
    chatClearConfirmOpen.value = true;
    return;
  }
  clearChat();
}

/** 実際のクリア（新規セッションを in-place で有効化）。旧セッションは履歴に残る。 */
function clearChat(): void {
  chatClearConfirmOpen.value = false;
  appApi.startFreshSessionAs(SLIDE_ROLE_ID);
  chatInput.value = "";
  void nextTick(() => chatInputEl.value?.focus());
}

// ── Data loading ──────────────────────────────────────────────────────────────

/** `<WD>/` 直下の version サブフォルダを列挙し、最新（先頭）を返す。 */
async function discoverVersion(wdDir: string): Promise<string | null> {
  const dirPath = `data/work/${wdDir}`;
  const dirRes = await apiGet<TreeNode>(`${API_ROUTES.files.dir}?path=${encodeURIComponent(dirPath)}`);
  if (!dirRes.ok) return null;
  const versions = parseVersionDirs(dirRes.data.children ?? []);
  const requested = requestedVersion.value;
  if (requested && versions.includes(requested)) return requested;
  return versions[0] ?? null;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const res = await apiGet<{ kind: string; content: string }>(`${API_ROUTES.files.content}?path=${encodeURIComponent(path)}`);
  if (!res.ok) return null;
  try {
    return JSON.parse(res.data.content) as T;
  } catch {
    return null;
  }
}

/**
 * structure.json（必須）＋ manifest.json（任意）を読み deck に反映。成功で true。
 * opts.preserve=true のときは現在の選択ページ・セクション開閉状態を維持する
 * （外部編集後の再読込で先頭ページに飛ばされないようにするため）。
 */
async function applyDeck(wdDir: string, ver: string, opts?: { preserve?: boolean }): Promise<boolean> {
  const base = `data/work/${wdDir}/${ver}`;
  const structure = await fetchJson<SlideStructure>(`${base}/.pages/structure.json`);
  if (!structure) return false;
  const manifest = await fetchJson<SlideManifest>(`${base}/.thumbcache/manifest.json`);
  version.value = ver;
  sourcePptx.value = structure.source?.from ?? "";
  sourceKind.value = structure.source?.kind ?? "";
  slideEditor.theme.value = structure.theme ?? UNAPPLIED_THEME; // theme 欄が無いデッキは「（未適用）」を初期選択
  const prevId = currentId.value;
  deck.value = buildDeck(structure, manifest);
  const keep = opts?.preserve === true && deck.value.pages.some((page) => page.id === prevId);
  currentId.value = keep ? prevId : (deck.value.pages[0]?.id ?? "");
  if (!keep) collapsedSections.value = new Set();
  canvasFailed.value = new Set();
  return true;
}

/** デッキを再読込して最新のサムネ・dirty 状態を反映する（選択ページは維持）。 */
async function reloadDeck(): Promise<void> {
  reloadNonce.value += 1; // 画像 URL を変えてブラウザキャッシュを回避
  if (wdId.value && version.value) await applyDeck(wdId.value, version.value, { preserve: true });
}

/** ポーリング用の静かなロード（成功したら待機を解除）。 */
async function loadDeckSilent(wdDir: string): Promise<void> {
  if (wdId.value !== wdDir) return;
  const ver = await discoverVersion(wdDir);
  if (!ver || wdId.value !== wdDir) return;
  if (await applyDeck(wdDir, ver)) {
    waiting.value = false;
    stopPolling();
  }
}

async function loadDeck(wdDir: string): Promise<void> {
  loading.value = true;
  loadError.value = null;
  waiting.value = false;
  deck.value = null;
  stopPolling();

  const isStale = (): boolean => wdId.value !== wdDir;

  try {
    const ver = await discoverVersion(wdDir);
    if (isStale()) return;
    if (!ver) {
      waiting.value = true;
      startPolling(wdDir);
      return;
    }
    const ok = await applyDeck(wdDir, ver);
    if (isStale()) return;
    if (!ok) {
      waiting.value = true;
      startPolling(wdDir);
    }
  } catch (err) {
    if (!isStale()) loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    if (!isStale()) loading.value = false;
  }
}

// ── Watchers ──────────────────────────────────────────────────────────────────

watch(
  [wdId, requestedVersion],
  ([wdVal]) => {
    stopPolling();
    waiting.value = false;
    if (wdVal) {
      void loadDeck(wdVal);
    } else {
      deck.value = null;
      loadError.value = null;
      // WD 未指定で /slides に来た場合は WorkFileSelectorView にリダイレクト
      router.replace({ name: PAGE_ROUTES.workFiles }).catch(() => {});
    }
  },
  { immediate: true },
);

// チャット（slide ロール）エージェントの実行が完了したら、デッキを再読込して
// python-pptx 編集の結果（dirty フラグ・更新済みサムネ）を画面へ反映する。
watch(agentRunning, (running, wasRunning) => {
  if (wasRunning && !running && deck.value) void reloadDeck();
});

// ── 上部リボンへコントロールを集約する連携 ──────────────────────────────────
// canvas 更新・チャットトグルの実体はこのビューが持ち、リボンからは共有ストア
// 経由でトリガー／状態参照する（App.vue chrome のリボンとは親子関係が無いため）。
slideEditor.register({
  onApplyTheme: (themeId: string) => void runApplyTheme(themeId),
  onApplyTemplate: (templateId: string) => openTemplateModal(templateId),
  onRefresh: () => openRefreshModal(),
  onRelease: () => void openReleaseModal(),
  onPageCheckout: () => openCheckoutModal(),
  onPageCheckin: () => openCheckinModal(),
  onToggleChat: () => {
    showChatPane.value = !showChatPane.value;
  },
});
watch(deck, (value) => (slideEditor.active.value = Boolean(value)), { immediate: true });
watch(dirtyCount, (value) => (slideEditor.dirtyCount.value = value), { immediate: true });
watch(lockedCount, (value) => (slideEditor.lockedCount.value = value), { immediate: true });
watch(showChatPane, (value) => (slideEditor.chatOpen.value = value), { immediate: true });

onUnmounted(() => {
  stopPolling();
  slideEditor.unregister();
});
</script>

<style scoped>
@reference "../index.css";

/* ── バッジ ── */
.badge-wd {
  @apply flex-shrink-0 text-[10px] font-bold bg-[#1a3a66] text-[#6aaade] px-1.5 py-0.5 rounded;
}
.badge-ver {
  @apply flex-shrink-0 text-[10px] bg-[#0e2638] text-[#4a8acc] px-1.5 py-0.5 rounded;
}

/* ── ナビボタン ── */
.nav-btn {
  @apply text-[11px] bg-[#1a2a44] hover:bg-[#2a3a66] text-[#6a9acc] px-2.5 py-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed;
}

/* ── 頁編集コントロール（サイドバー・トグル ON 時） ── */
.pe-btn {
  @apply flex items-center justify-center w-5 h-5 rounded text-[#7aa0c0]
         bg-[#12203a] hover:bg-[#1e3252] border border-[#22304c]
         transition-colors disabled:opacity-25 disabled:cursor-not-allowed;
}
.pe-btn--danger {
  @apply text-red-300 hover:text-red-100 hover:bg-red-900/50 border-[#3a2030];
}
.pe-add-btn {
  @apply flex items-center justify-center gap-1 w-full py-1 rounded text-[9px] font-medium
         text-[#6aaade] bg-[#0e2036] hover:bg-[#16304e]
         border border-dashed border-[#2a4060] hover:border-[#3a5a8a]
         transition-colors disabled:opacity-40 disabled:cursor-not-allowed;
}

/* ── テキストボックス編集オーバーレイ（textboxEditMode 時） ── */
/* 編集可能な TB を常時うっすら枠線で示し、ホバーで強調する（仕様 Q3）。 */
.tb-hotspot {
  position: absolute;
  border: 1px dashed rgba(122, 176, 255, 0.55);
  background: rgba(80, 140, 230, 0.08);
  border-radius: 3px;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}
.tb-hotspot:hover,
.tb-hotspot:focus-visible {
  border: 1px solid rgba(150, 200, 255, 0.95);
  background: rgba(90, 150, 240, 0.22);
  box-shadow: 0 0 0 1px rgba(150, 200, 255, 0.5);
  outline: none;
}

/* ── Claude チャットペイン ── */
.chat-pane {
  width: 280px;
  min-width: 240px;
  max-width: 360px;
  scrollbar-width: thin;
  scrollbar-color: #1a2a3a transparent;
}
</style>
