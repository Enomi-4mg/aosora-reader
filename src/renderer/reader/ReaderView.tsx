/**
 * Reader 本体(要件 §4.3 / §12)。
 *
 * レンダリング単位は「章」。章の DOM は一度だけ構築し、ページ送りは
 * CSS multicolumn と transform だけで行う(要件 §10「全Documentを毎ページ再レンダリングしない」)。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { currentChapter, useReaderStore } from '../state/useReaderStore'
import { useSettingsStore } from '../state/useSettingsStore'
import { BlockRenderer } from './BlockRenderer'
import { LayoutController, type LayoutMetrics } from './layout/LayoutController'
import { useProgressSaver } from './hooks/useProgressSaver'
import { useReaderKeyboard } from './hooks/useReaderKeyboard'
import { ContentsPanel } from '../panels/ContentsPanel'
import { SearchPanel } from '../panels/SearchPanel'
import { SettingsPanel } from '../settings/SettingsPanel'
import { textRangeToDomRange } from './dom/positionMapping'
import { paintHighlights } from './dom/highlightPainter'
import { chapterEndPosition, chapterStartPosition } from '@shared/model/position'

interface Props {
  onBackToLibrary: () => void
}

export function ReaderView({ onBackToLibrary }: Props): JSX.Element {
  const store = useReaderStore()
  const { settings } = useSettingsStore()
  const chapter = currentChapter(store)

  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<LayoutController | null>(null)
  const [metrics, setMetrics] = useState<LayoutMetrics>({ pageCount: 1, currentPage: 0 })
  const swipe = useRef({ pointerId: -1, startX: 0, startY: 0, moved: false })
  const suppressPageClick = useRef(false)
  const [dragging, setDragging] = useState(false)

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
  useReaderKeyboard({ next, previous, onBackToLibrary })

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
    swipe.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
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

  const finishSwipe = (event: React.PointerEvent<HTMLElement>): void => {
    const gesture = swipe.current
    if (gesture.pointerId !== event.pointerId) return
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
  }

  const pageClick = (action: () => void): void => {
    if (!suppressPageClick.current) action()
  }

  return (
    <div className={`reader ${store.focusMode ? 'focus' : ''}`}>
      <header className="toolbar">
        <button className="ghost" onClick={onBackToLibrary}>← 本棚</button>
        <button className="ghost" onClick={store.toggleSidebar} aria-expanded={store.sidebarOpen}>
          目次
        </button>
        {store.searchOpen ? (
          <SearchPanel onJump={goToPosition} />
        ) : (
          <div className="toolbar-title">
            <strong>{store.book.title}</strong>
            <span className="muted">{store.book.author}</span>
          </div>
        )}
        {!store.searchOpen && (
          <button className="ghost" onClick={store.openSearch} aria-label="本文を検索">検索</button>
        )}
        <button
          className="ghost"
          onClick={() => store.setSettingsOpen(!store.settingsOpen)}
          aria-label="表示設定"
        >
          設定
        </button>
        {store.settingsOpen && <SettingsPanel onClose={() => store.setSettingsOpen(false)} />}
      </header>

      <div className="reader-body">
        {store.sidebarOpen && (
          <aside className="sidebar" aria-label="サイドパネル">
            <ContentsPanel
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
            />
          </aside>
        )}

        <main
          className={`reader-stage ${dragging ? 'dragging' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishSwipe}
          onPointerCancel={finishSwipe}
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

          <button className="page-zone prev" onClick={() => pageClick(previous)} aria-label="前のページ" />
          <button className="page-zone next" onClick={() => pageClick(next)} aria-label="次のページ" />
        </main>
      </div>

      <footer className="status" role="status">
        <span className="status-chapter">{chapter.title}</span>
        <span className="status-progress">{pct}%</span>
        {settings.readingMode === 'pagination' && (
          <span className="muted">
            {metrics.currentPage + 1} / {metrics.pageCount}
          </span>
        )}
      </footer>

    </div>
  )
}
