/** 目次(要件 §4.11)。見出しから自動生成し、現在章を強調する。 */
import { type JSX } from 'react'
import { useReaderStore } from '../state/useReaderStore'

interface Props {
  onJump: (chapterIndex: number) => void
}

export function ContentsPanel({ onJump }: Props): JSX.Element {
  const { book, chapterIndex } = useReaderStore()
  if (!book) return <div className="panel-empty">…</div>

  return (
    <nav className="panel" aria-label="目次">
      <h2 className="panel-title">目次</h2>
      <ol className="toc">
        {book.chapters.map((c, i) => (
          <li key={c.id} className={`toc-item lv-${c.level} ${i === chapterIndex ? 'current' : ''}`}>
            <button
              onClick={() => onJump(i)}
              aria-current={i === chapterIndex ? 'true' : undefined}
            >
              {c.title || '(無題)'}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
