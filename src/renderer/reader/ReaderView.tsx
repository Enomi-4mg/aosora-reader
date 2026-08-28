/**
 * Reader 本体(要件 §4.3 / §12)。
 *
 * レンダリング単位は「章」。章の DOM は一度だけ構築し、ページ送りは
 * CSS multicolumn と transform だけで行う(要件 §10「全Documentを毎ページ再レンダリングしない」)。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { currentChapter, useReaderStore } from '../state/useReaderStore'
import { useAnnotationsStore } from '../state/useAnnotationsStore'
import { useSettingsStore } from '../state/useSettingsStore'
import { BlockRenderer } from './BlockRenderer'
import { LayoutController, type LayoutMetrics } from './layout/LayoutController'
import { useProgressSaver } from './hooks/useProgressSaver'
import { useReaderKeyboard } from './hooks/useReaderKeyboard'
import { ContentsPanel } from '../panels/ContentsPanel'
import { AnnotationsPanel } from '../panels/AnnotationsPanel'
import { SearchPanel } from '../panels/SearchPanel'
import { SettingsPanel } from '../settings/SettingsPanel'
import { domPointToPosition, selectionToTextRange, textRangeToDomRange } from './dom/positionMapping'
import { paintHighlights, paintSavedHighlights, paintTtsHighlight } from './dom/highlightPainter'
import { chapterEndPosition, chapterStartPosition, extractRangeText, normalizeRange } from '@shared/model/position'
import { SelectionMenu, type SelectionState } from './SelectionMenu'
import { MemoForm } from './MemoForm'
import { useReadingSession } from './hooks/useReadingSession'
import { useTtsController } from './hooks/useTtsController'
import { TtsControls } from './TtsControls'
import { DictionaryPopover } from '../panels/DictionaryPopover'
import { AuthorPopover } from '../panels/AuthorPopover'
import { estimateRemainingMinutes, formatReadingTime } from '@shared/reading'
import type { DictionaryResult, ReadingStats } from '@shared/model/annotations'
import { ReaderContextMenu } from './ReaderContextMenu'
import type { TextPosition } from '@shared/model/position'

interface Props {
  onBackToLibrary: () => void
  onOpenBook?: (bookId: string) => void
}

/** ページ送りの帯の幅。reader.css の .page-zone と同じ値。 */
const EDGE_RATIO = 0.12
const EDGE_MIN_PX = 40

type EdgeZone = 'prev' | 'next'

/**
 * クリック位置がページ送りの帯に入っているか。
 *
 * 帯を要素で受けると下の本文を選択できなくなるので、当たり判定は座標で持つ。
 * 縦書きは右から左へ読むため、次ページが左側にある。
 */
function edgeZoneAt(stage: HTMLElement, clientX: number, vertical: boolean): EdgeZone | null {
  const r = stage.getBoundingClientRect()
  const band = Math.max(EDGE_MIN_PX, r.width * EDGE_RATIO)
  if (clientX - r.left <= band) return vertical ? 'next' : 'prev'
  if (r.right - clientX <= band) return vertical ? 'prev' : 'next'
  return null
}

export function ReaderView({ onBackToLibrary, onOpenBook }: Props): JSX.Element {
  const store = useReaderStore()
  const { settings } = useSettingsStore()
  const annotations = useAnnotationsStore()
  const chapter = currentChapter(store)

  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<LayoutController | null>(null)
  const [metrics, setMetrics] = useState<LayoutMetrics>({ pageCount: 1, currentPage: 0 })
  const swipe = useRef({ pointerId: -1, startX: 0, startY: 0, moved: false })
  const suppressPageClick = useRef(false)
  const [dragging, setDragging] = useState(false)
  /** ページ送りの帯にポインタが乗っているか。.page-zone の hover 表示に使う。 */
  const [edgeHover, setEdgeHover] = useState<EdgeZone | null>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [dictionaryResult, setDictionaryResult] = useState<DictionaryResult | null>(null)
  const [dictionaryLoading, setDictionaryLoading] = useState(false)
  const [dictionaryOpen, setDictionaryOpen] = useState(false)
  const [authorOpen, setAuthorOpen] = useState(false)
  const [readingStats, setReadingStats] = useState<ReadingStats | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [focusAwake, setFocusAwake] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string; position: TextPosition | null } | null>(null)
  /** 現在位置へのメモ入力。window.prompt は Electron で使えないので自前の UI で受ける。 */
  const [positionMemo, setPositionMemo] = useState<{ x: number; y: number; position: TextPosition } | null>(null)
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!store.book) return
    void annotations.load(store.book.id)
    return () => annotations.clear()
  }, [store.book?.id])

  /**
   * 復元の基準となる本文位置。
   *
   * 再ページング時に「いま見えている位置」を DOM から読み直してはいけない。
   * useLayoutEffect が走る時点では新しいフォント/組み方で再レイアウト済みで、
   * LayoutController のページ幾何(step / currentPage)はまだ旧値だからである。
   * 常に store の TextPosition を正とし、そこからページを導出し直す(要件 §20-1)。
   */
  const positionRef = useRef(store.position)
  positionRef.current = store.position

  /** 章切替や検索ジャンプで、この位置へ移りたいという明示指定。 */
  const pendingRestore = useRef(store.position)

  /**
   * 再ページング中はスクロールイベントで位置を上書きしない。
   * 組み方を切り替えるとブラウザがスクロール位置をリセットして scroll を発火するため、
   * その値を拾うと復元前の位置が章頭で潰れてしまう。
   */
  const restoring = useRef(false)

  // --- LayoutController の生成と設定同期 ---
  useLayoutEffect(() => {
    if (!viewportRef.current || !contentRef.current || !store.book) return
    layoutRef.current = new LayoutController({
      viewport: viewportRef.current,
      content: contentRef.current,
      settings,
      bookId: store.book.id
    })
    return () => {
      layoutRef.current = null
    }
  }, [store.book?.id])

  useLayoutEffect(() => {
    layoutRef.current?.update({ settings })
  }, [settings])

  /**
   * 再ページングが必要になる条件(要件 §4.5)。
   * 「いま見ている位置」を先に控え、再計測後にその位置へ戻す。
   * これがフォントサイズ・writingMode・リサイズをまたいでも
   * 同じ本文位置に留まれる仕組み。
   */
  useLayoutEffect(() => {
    const l = layoutRef.current
    if (!l || !chapter) return
    const keep = pendingRestore.current ?? positionRef.current
    pendingRestore.current = null
    restoring.current = true
    let cancelled = false
    let frame = 0
    const settle = (): void => {
      if (cancelled) return
      l.measure()
      // ページ番号は保存値ではなく、そのつど本文座標から導出し直す。
      if (keep && keep.chapterId === chapter.id) l.goToPosition(keep)
      setMetrics(l.metrics())
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (!cancelled) restoring.current = false
        })
      })
    }
    // Web Font の読み込み完了後に測る。書体変更直後の代替フォント寸法を
    // ページ数として確定すると、後から境界が一列ずれるため。
    void document.fonts.ready.then(settle)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [
    chapter?.id,
    settings.fontSize,
    settings.fontFamily,
    settings.lineHeight,
    settings.letterSpacing,
    settings.writingMode,
    settings.readingMode,
    settings.columns,
    settings.pageMargin,
    settings.fontWeight,
    settings.paragraphSpacing
  ])

  // ウィンドウリサイズでも同じ位置に留まる
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const ro = new ResizeObserver(() => {
      const l = layoutRef.current
      if (!l) return
      // リサイズ後も同じ本文位置に留まる(要件 §16 Progress Tests)
      const keep = positionRef.current
      restoring.current = true
      l.measure()
      if (keep) l.goToPosition(keep)
      setMetrics(l.metrics())
      setTimeout(() => { restoring.current = false }, 250)
    })
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])

  // --- 論理操作。縦横・ページ/スクロールの違いはここから先に出さない ---
  const next = useCallback(() => {
    const l = layoutRef.current
    if (!l) return
    if (!l.next()) {
      // 章末なら次章へ(要件 §4.6)
      if (
        store.book &&
        store.index &&
        store.chapterIndex < store.book.chapters.length - 1
      ) {
        const nextChapterIndex = store.chapterIndex + 1
        const nextChapter = store.book.chapters[nextChapterIndex]!
        const target = chapterStartPosition(store.index, nextChapter.id)
        pendingRestore.current = target
        store.setChapter(nextChapterIndex)
        if (target) store.setPosition(target)
      }
      return
    }
    setMetrics(l.metrics())
    syncPosition()
  }, [store.book, store.index, store.chapterIndex])

  const previous = useCallback(() => {
    const l = layoutRef.current
    if (!l) return
    if (!l.previous()) {
      if (store.book && store.index && store.chapterIndex > 0) {
        const previousChapterIndex = store.chapterIndex - 1
        const previousChapter = store.book.chapters[previousChapterIndex]!
        const target = chapterEndPosition(store.index, previousChapter.id)
        pendingRestore.current = target
        store.setChapter(previousChapterIndex)
        if (target) store.setPosition(target)
      }
      return
    }
    setMetrics(l.metrics())
    syncPosition()
  }, [store.book, store.index, store.chapterIndex])

  const syncPosition = useCallback(() => {
    if (restoring.current) return
    const p = layoutRef.current?.currentPosition()
    if (p) store.setPosition(p)
  }, [])

  useProgressSaver(store.book?.id ?? null, store.position, store.percentage)
  useReadingSession(store.book?.id ?? null, store.index, store.position, store.percentage)

  // --- ハイライト描画(検索一致)。CSS Custom Highlight API に集約 ---
  const currentMatch = useMemo(() => {
    const r = store.searchResult
    return (r && r.count > 0 ? r.matches[store.searchCursor] : null) ?? null
  }, [store.searchResult, store.searchCursor])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const matches = store.searchResult?.matches ?? []
    paintHighlights(content, matches, currentMatch)
  }, [store.searchResult, currentMatch, chapter?.id, settings.writingMode])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    paintSavedHighlights(content, annotations.highlights)
  }, [annotations.highlights, chapter?.id, settings.writingMode])

  // 検索結果へジャンプ
  useEffect(() => {
    if (!currentMatch || !store.book) return
    const targetChapter = store.book.chapters.findIndex(
      (c) => c.id === currentMatch.chapterId
    )
    if (targetChapter >= 0 && targetChapter !== store.chapterIndex) {
      pendingRestore.current = currentMatch.position
      store.setChapter(targetChapter)
      return
    }
    const l = layoutRef.current
    if (l && contentRef.current) {
      const r = textRangeToDomRange(currentMatch.range, contentRef.current)
      if (r) {
        l.goToPosition(currentMatch.position)
        setMetrics(l.metrics())
      }
    }
  }, [currentMatch])

  const goToPosition = useCallback(
    (chapterIdx: number, position: Parameters<typeof store.setPosition>[0]) => {
      pendingRestore.current = position
      if (chapterIdx !== store.chapterIndex) store.setChapter(chapterIdx)
      else {
        const l = layoutRef.current
        if (l) {
          l.goToPosition(position)
          setMetrics(l.metrics())
        }
      }
      store.setPosition(position)
    },
    [store.chapterIndex]
  )

  const bookmarkAt = useCallback((position: TextPosition) => {
    if (!position || !store.index) return
    const entry = store.index.byBlockId.get(position.blockId)
    const nearby = entry?.block.plainText.slice(position.offset, position.offset + 24).trim()
    const label = `${entry?.chapter.title ?? '現在位置'}${nearby ? ` ― ${nearby}${nearby.length >= 24 ? '…' : ''}` : ''}`
    void annotations.addBookmark(position, label)
    store.setSidebarTab('bookmarks')
  }, [store.index])

  const addBookmark = useCallback(() => {
    if (store.position) bookmarkAt(store.position)
  }, [store.position, bookmarkAt])

  const followPosition = useCallback((position: Parameters<typeof store.setPosition>[0]) => {
    const chapterIdx = store.book?.chapters.findIndex((item) => item.id === position.chapterId) ?? -1
    if (chapterIdx >= 0) goToPosition(chapterIdx, position)
  }, [store.book, goToPosition])

  const tts = useTtsController({
    book: store.book,
    index: store.index,
    position: store.position,
    settings,
    onFollow: followPosition
  })

  useEffect(() => {
    const content = contentRef.current
    if (content) paintTtsHighlight(content, tts.currentRange)
  }, [tts.currentRange, chapter?.id])

  useEffect(() => {
    if (!store.book) return
    void window.aozora.getReadingStats(store.book.id, settings.estimatedCharsPerMinute)
      .then(setReadingStats).catch(() => setReadingStats(null))
  }, [store.book?.id, settings.estimatedCharsPerMinute])

  const toggleFullscreen = useCallback(() => {
    void window.aozora.getFullscreen()
      .then((current) => window.aozora.setFullscreen(!current))
      .then(setFullscreen)
  }, [])

  const closeTransient = useCallback((): boolean => {
    if (selection || dictionaryOpen || authorOpen || contextMenu || positionMemo) {
      clearSelection()
      setDictionaryOpen(false)
      setAuthorOpen(false)
      setContextMenu(null)
      setPositionMemo(null)
      return true
    }
    return false
  }, [selection, dictionaryOpen, authorOpen, contextMenu, positionMemo])

  useReaderKeyboard({
    next,
    previous,
    onBackToLibrary,
    onBookmark: addBookmark,
    onToggleFullscreen: toggleFullscreen,
    onEscape: closeTransient
  })

  if (store.loading) return <div className="reader-loading">読み込み中…</div>
  if (store.error) {
    return (
      <div className="reader-loading">
        <p>{store.error}</p>
        <button onClick={onBackToLibrary}>本棚へ戻る</button>
      </div>
    )
  }
  if (!store.book || !chapter) return <div className="reader-loading">…</div>

  const pct = Math.round(store.percentage * 100)

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    if (settings.readingMode !== 'pagination' || event.button !== 0) return
    // 本文ドラッグは選択に譲り、余白ドラッグだけをページスワイプに使う。
    if ((event.target as Element).closest('.content')) return
    swipe.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const zone =
      settings.readingMode === 'pagination'
        ? edgeZoneAt(event.currentTarget, event.clientX, settings.writingMode === 'vertical')
        : null
    if (zone !== edgeHover) setEdgeHover(zone)

    const gesture = swipe.current
    if (gesture.pointerId !== event.pointerId) return
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    if (!gesture.moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      gesture.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
    }
  }

  /**
   * 帯のクリックでページを送る。
   *
   * 帯そのものに当たり判定を持たせると本文を選択できなくなるので、
   * ここで座標から判定する。選択が残っているときは送らない
   * (本文をなぞり終えたクリックでページが飛ぶのを防ぐ)。
   */
  const onStageClick = (event: React.MouseEvent<HTMLElement>): void => {
    if (settings.readingMode !== 'pagination') return
    if (suppressPageClick.current) return
    const native = window.getSelection()
    if (native && !native.isCollapsed) return
    const zone = edgeZoneAt(event.currentTarget, event.clientX, settings.writingMode === 'vertical')
    if (zone === 'next') next()
    else if (zone === 'prev') previous()
  }

  const finishSwipe = (event: React.PointerEvent<HTMLElement>): void => {
    const gesture = swipe.current
    if (gesture.pointerId !== event.pointerId) {
      requestAnimationFrame(captureSelection)
      return
    }
    const dx = event.clientX - gesture.startX
    if (gesture.moved && Math.abs(dx) >= 52) {
      // 本文をつかんで動かす感覚に合わせる。縦書きの次ページは左側にあるため
      // 右へ引くと次、横書きは左へ引くと次になる。
      if (settings.writingMode === 'vertical' ? dx > 0 : dx < 0) next()
      else previous()
      suppressPageClick.current = true
      requestAnimationFrame(() => { suppressPageClick.current = false })
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    swipe.current.pointerId = -1
    setDragging(false)
    requestAnimationFrame(captureSelection)
  }

  const captureSelection = (): void => {
    const content = contentRef.current
    if (!content || !store.book || !store.index) return
    const native = window.getSelection()
    if (!native || native.rangeCount === 0 || native.isCollapsed ||
      !content.contains(native.anchorNode) || !content.contains(native.focusNode)) {
      setSelection(null)
      return
    }
    const mapped = selectionToTextRange(store.book.id, content)
    if (!mapped) return
    const range = normalizeRange(store.index, mapped)
    const text = extractRangeText(store.index, range)
    if (!text) return
    const rect = native.getRangeAt(0).getBoundingClientRect()
    setSelection({
      range,
      text,
      x: Math.max(12, Math.min(window.innerWidth - 360, rect.left + rect.width / 2 - 140)),
      y: Math.max(74, rect.top - 52)
    })
  }

  const clearSelection = (): void => {
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const pageClick = (action: () => void): void => {
    if (!suppressPageClick.current) action()
  }

  return (
    <div
      className={`reader ${store.focusMode ? 'focus' : ''} ${focusAwake ? 'ui-awake' : ''}`}
      onMouseMove={() => {
        if (!store.focusMode) return
        setFocusAwake(true)
        if (focusTimer.current) clearTimeout(focusTimer.current)
        focusTimer.current = setTimeout(() => setFocusAwake(false), 1400)
      }}
      onClick={() => setContextMenu(null)}
    >
      {/*
        * ツールバーに出すのは、読んでいる最中に押すものだけに絞る。
        * 左は移動(本棚・目次・注釈)、右は検索と読み上げ。
        * 栞・著者・集中・全画面は設定パネルへ集約した。
        */}
      <header className="toolbar">
        <button className="ghost home" onClick={onBackToLibrary}>← 本棚</button>
        <button className="ghost" onClick={() => {
          if (store.sidebarOpen && store.sidebarTab === 'contents') store.toggleSidebar()
          else store.setSidebarTab('contents')
        }} aria-expanded={store.sidebarOpen}>
          目次
        </button>
        <button className="ghost" onClick={() => store.setSidebarTab('annotations')} aria-label="注釈一覧">注釈</button>
        {store.searchOpen ? (
          <SearchPanel onJump={goToPosition} />
        ) : (
          <div className="toolbar-title">
            <strong>{store.book.title}</strong>
            {store.book.author && <button className="author-link" onClick={() => setAuthorOpen(true)}>{store.book.author}</button>}
          </div>
        )}
        {!store.searchOpen && (
          <button className="ghost" onClick={store.openSearch} aria-label="本文を検索">検索</button>
        )}
        <TtsControls controller={tts} />
        <button
          className="ghost"
          onClick={() => store.setSettingsOpen(!store.settingsOpen)}
          aria-label="表示設定"
        >
          設定
        </button>
        {store.settingsOpen && (
          <SettingsPanel
            onClose={() => store.setSettingsOpen(false)}
            reader={{
              focusMode: store.focusMode,
              fullscreen,
              hasAuthor: store.book.author !== null,
              onToggleFocus: () => store.setFocusMode(!store.focusMode),
              onToggleFullscreen: toggleFullscreen,
              onAddBookmark: () => {
                addBookmark()
                store.setSettingsOpen(false)
              },
              onShowAuthor: () => {
                store.setSettingsOpen(false)
                setAuthorOpen(true)
              }
            }}
          />
        )}
        {authorOpen && <AuthorPopover book={store.book} onOpenBook={onOpenBook} onClose={() => setAuthorOpen(false)} />}
      </header>

      <div className="reader-body">
        {store.sidebarOpen && (
          <aside className="sidebar" aria-label="サイドパネル">
            {store.sidebarTab === 'contents' ? <ContentsPanel
              onJump={(i: number) => {
                // 目次からのジャンプは章の先頭へ
                const target = store.book?.chapters[i]?.blocks[0]
                pendingRestore.current =
                  target && store.book
                    ? {
                        bookId: store.book.id,
                        chapterId: store.book.chapters[i]!.id,
                        blockId: target.id,
                        offset: 0
                      }
                    : null
                store.setChapter(i)
                if (pendingRestore.current) store.setPosition(pendingRestore.current)
              }}
            /> : <AnnotationsPanel onJump={(position) => {
              const chapterIdx = store.book?.chapters.findIndex((item) => item.id === position.chapterId) ?? -1
              if (chapterIdx >= 0) goToPosition(chapterIdx, position)
            }} />}
          </aside>
        )}

        <main
          className={`reader-stage ${dragging ? 'dragging' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setEdgeHover(null)}
          onPointerUp={finishSwipe}
          onPointerCancel={finishSwipe}
          onClick={onStageClick}
          onContextMenu={(event) => {
            event.preventDefault()
            const text = window.getSelection()?.toString().trim() ?? ''
            const caret = (document as Document & {
              caretRangeFromPoint?: (x: number, y: number) => Range | null
            }).caretRangeFromPoint?.(event.clientX, event.clientY)
            const position = caret && store.book
              ? domPointToPosition(store.book.id, caret.startContainer, caret.startOffset)
              : store.position
            setContextMenu({
              x: Math.min(event.clientX, window.innerWidth - 210),
              y: Math.min(event.clientY, window.innerHeight - 130),
              text,
              position
            })
          }}
        >
          <div
            ref={viewportRef}
            className={`viewport wm-${settings.writingMode} mode-${settings.readingMode}`}
            style={
              {
                '--font-family': settings.fontFamily,
                '--font-size': `${settings.fontSize}px`,
                '--font-weight': settings.fontWeight,
                '--line-height': settings.lineHeight,
                '--letter-spacing': `${settings.letterSpacing}em`,
                '--page-margin': `${settings.pageMargin}px`,
                '--paragraph-spacing': `${settings.paragraphSpacing}em`,
                '--column-count': settings.columns
              } as React.CSSProperties
            }
            onScroll={settings.readingMode === 'scroll' ? syncPosition : undefined}
          >
            <div ref={contentRef} className="content" lang="ja">
              {store.chapterIndex === 0 && (
                <header className="book-frontmatter" aria-label="作品情報">
                  <h1>{store.book.title}</h1>
                  {store.book.subtitle && <p className="book-subtitle">{store.book.subtitle}</p>}
                  {store.book.author && <p className="book-author">{store.book.author}</p>}
                  {store.book.translator && <p className="book-translator">訳 {store.book.translator}</p>}
                </header>
              )}
              {chapter.blocks.map((b) => (
                <BlockRenderer key={b.id} block={b} chapterId={chapter.id} />
              ))}
            </div>
          </div>

          {/* マウスの当たり判定は reader-stage 側。ここはキーボード操作と見た目のため。 */}
          <button
            className={`page-zone prev ${edgeHover === 'prev' ? 'hot' : ''}`}
            onClick={() => pageClick(previous)}
            aria-label="前のページ"
          />
          <button
            className={`page-zone next ${edgeHover === 'next' ? 'hot' : ''}`}
            onClick={() => pageClick(next)}
            aria-label="次のページ"
          />
        </main>
      </div>

      {selection && (
        <SelectionMenu
          selection={selection}
          onHighlight={(color) => { void annotations.addHighlight(selection.range, selection.text, color); clearSelection() }}
          onMemo={(text) => { void annotations.saveNote({ range: selection.range, text }); clearSelection(); store.setSidebarTab('notes') }}
          onCopy={() => { void window.aozora.copyText(selection.text); clearSelection() }}
          onDictionary={() => {
            const term = selection.text.trim().slice(0, 80)
            setDictionaryOpen(true)
            setDictionaryLoading(true)
            setDictionaryResult({ term, definitions: [], source: '日本語版Wiktionary' })
            void window.aozora.searchDictionary(term).then(setDictionaryResult)
              .finally(() => setDictionaryLoading(false))
            clearSelection()
          }}
          onClose={clearSelection}
        />
      )}
      {dictionaryOpen && <DictionaryPopover result={dictionaryResult} loading={dictionaryLoading} onClose={() => setDictionaryOpen(false)} />}
      {contextMenu && <ReaderContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        hasSelection={contextMenu.text.length > 0}
        onBookmark={() => {
          if (contextMenu.position) bookmarkAt(contextMenu.position)
          setContextMenu(null)
        }}
        onMemo={() => {
          if (contextMenu.position) {
            setPositionMemo({
              x: contextMenu.x,
              y: contextMenu.y,
              position: contextMenu.position
            })
          }
          setContextMenu(null)
        }}
        onSearch={() => {
          store.openSearch()
          void store.runSearch(contextMenu.text)
          setContextMenu(null)
        }}
        onSettings={() => { store.setSettingsOpen(true); setContextMenu(null) }}
        onClose={() => setContextMenu(null)}
      />}
      {positionMemo && (
        <div className="position-memo" role="dialog" aria-label="現在位置へのメモ"
          style={{ left: positionMemo.x, top: positionMemo.y }}>
          <MemoForm
            placeholder="現在位置へのメモ"
            onSubmit={(text) => {
              void annotations.saveNote({ position: positionMemo.position, text })
              store.setSidebarTab('notes')
              setPositionMemo(null)
            }}
            onCancel={() => setPositionMemo(null)}
          />
        </div>
      )}

      <footer className="status" role="status">
        <span className="status-chapter">{chapter.title}</span>
        <span className="status-progress">{pct}%</span>
        {settings.readingMode === 'pagination' && (
          <span className="muted">
            {metrics.currentPage + 1} / {metrics.pageCount}
          </span>
        )}
        <span className="status-remaining">{formatReadingTime(estimateRemainingMinutes(
          store.book.totalCharacters,
          store.percentage,
          readingStats?.estimatedCharsPerMinute ?? settings.estimatedCharsPerMinute
        ))}</span>
        {readingStats && readingStats.totalDurationMs > 0 && (
          <span className="muted" title={`${readingStats.sessionCount}回の読書セッション`}>
            読書 {Math.max(1, Math.round(readingStats.totalDurationMs / 60_000))}分
          </span>
        )}
      </footer>

    </div>
  )
}
