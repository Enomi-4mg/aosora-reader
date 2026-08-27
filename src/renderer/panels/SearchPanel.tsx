/** 本文検索(要件 §4.12)。 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { useReaderStore } from '../state/useReaderStore'
import type { TextPosition } from '@shared/model/position'

interface Props {
  onJump: (chapterIndex: number, position: TextPosition) => void
}

export function SearchPanel({ onJump }: Props): JSX.Element {
  const store = useReaderStore()
  const [text, setText] = useState(store.searchQuery)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // 入力を debounce して検索する(UI をフリーズさせない / 要件 §10)
  useEffect(() => {
    const t = setTimeout(() => void store.runSearch(text), 220)
    return () => clearTimeout(t)
  }, [text])

  const result = store.searchResult
  const chapterIndexOf = (chapterId: string): number =>
    store.book?.chapters.findIndex((c) => c.id === chapterId) ?? 0

  return (
    <div className="toolbar-search" role="search" aria-label="本文検索">
      <div className="search-head">
        <input
          ref={inputRef}
          type="search"
          value={text}
          placeholder="本文を検索"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              store.moveSearchCursor(e.shiftKey ? -1 : 1)
            }
          }}
        />
        <span className="count" aria-live="polite">
          {result === null
            ? ''
            : result.count === 0
              ? '該当なし'
              : `${store.searchCursor + 1} / ${result.count}`}
        </span>
        <button className="ghost" onClick={() => store.moveSearchCursor(-1)} aria-label="前の一致">前へ</button>
        <button className="ghost" onClick={() => store.moveSearchCursor(1)} aria-label="次の一致">次へ</button>
        <button className="ghost" onClick={store.closeSearch} aria-label="検索を閉じる">×</button>
      </div>

      {result && (
        <div className="search-popover">
          {result.count === 0 ? (
            <p className="panel-empty">該当する箇所はありません。</p>
          ) : (
            <ul className="search-results">
              {result.matches.map((m, i) => (
                <li key={`${m.position.blockId}:${m.position.offset}`}>
                  <button
                    className={i === store.searchCursor ? 'current' : ''}
                    onClick={() => onJump(chapterIndexOf(m.chapterId), m.position)}
                  >
                    <span className="ctx-before">{m.context.slice(0, m.contextOffset)}</span>
                    <mark>{m.context.slice(m.contextOffset, m.contextOffset + result.query.length)}</mark>
                    <span className="ctx-after">
                      {m.context.slice(m.contextOffset + result.query.length)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
