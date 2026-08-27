/** 本棚(要件 §4.13 / §4.14 / §12)。 */
import { useEffect, useState, type JSX } from 'react'
import { useLibraryStore, selectVisibleBooks, type SortKey } from '../state/useLibraryStore'
import type { BookSummary } from '@shared/model/document'

const SORT_LABELS: Array<[SortKey, string]> = [
  ['recent', '最近読んだ順'],
  ['title', 'タイトル'],
  ['author', '著者'],
  ['added', '追加日'],
  ['progress', '進捗']
]

interface Props {
  onOpen: (bookId: string) => void
}

export function LibraryView({ onOpen }: Props): JSX.Element {
  const s = useLibraryStore()
  const books = selectVisibleBooks(s)
  const [pendingDelete, setPendingDelete] = useState<BookSummary | null>(null)

  useEffect(() => {
    void s.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="library">
      <header className="library-bar">
        <h1 className="brand">青空Reader</h1>
        <input
          className="search-input"
          type="search"
          value={s.query}
          placeholder="タイトル・著者で絞り込む"
          aria-label="本棚を検索"
          onChange={(e) => s.setQuery(e.target.value)}
        />
        <label className="sr-only" htmlFor="sortby">並び替え</label>
        <select
          id="sortby"
          className="select"
          value={s.sort}
          onChange={(e) => s.setSort(e.target.value as SortKey)}
        >
          {SORT_LABELS.map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="表示形式">
          <button
            className={s.view === 'grid' ? 'on' : ''}
            aria-pressed={s.view === 'grid'}
            onClick={() => s.setView('grid')}
          >
            グリッド
          </button>
          <button
            className={s.view === 'list' ? 'on' : ''}
            aria-pressed={s.view === 'list'}
            onClick={() => s.setView('list')}
          >
            リスト
          </button>
        </div>
        <button className="primary" disabled={s.busy} onClick={() => void s.importDialog()}>
          {s.busy ? '取り込み中…' : '作品を追加'}
        </button>
      </header>

      {s.notice && (
        <div className="notice" role="status">
          <span>{s.notice}</span>
          <button className="ghost" onClick={s.dismissNotice} aria-label="通知を閉じる">×</button>
        </div>
      )}

      {books.length === 0 ? (
        <div className="empty-state">
          <p>本棚は空です。</p>
          <p className="muted">
            青空文庫の .txt / .zip を「作品を追加」から取り込むか、ここにドラッグしてください。
          </p>
        </div>
      ) : (
        <ul className={`shelf ${s.view}`}>
          {books.map((b) => (
            <li key={b.id}>
              <BookCard book={b} onOpen={onOpen} onDelete={() => setPendingDelete(b)} />
            </li>
          ))}
        </ul>
      )}

      {pendingDelete && (
        <DeleteDialog
          book={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async (keep) => {
            await s.remove(pendingDelete.id, keep)
            setPendingDelete(null)
          }}
        />
      )}
    </div>
  )
}

function BookCard({
  book,
  onOpen,
  onDelete
}: {
  book: BookSummary
  onOpen: (id: string) => void
  onDelete: () => void
}): JSX.Element {
  const pct = Math.round(book.percentage * 100)
  return (
    <article className="card">
      <button className="card-main" onClick={() => onOpen(book.id)}>
        <span className="card-title">{book.title}</span>
        <span className="card-author">{book.author ?? '著者不明'}</span>
        <span className="card-meta">
          {book.completed ? '読了' : pct > 0 ? `${pct}%` : '未読'}
          {book.lastOpenedAt && ` · ${formatDate(book.lastOpenedAt)}`}
        </span>
        <span className="progress-track" aria-hidden="true">
          <span className="progress-fill" style={{ inlineSize: `${pct}%` }} />
        </span>
      </button>
      <button className="ghost card-del" onClick={onDelete} aria-label={`${book.title} を削除`}>
        削除
      </button>
    </article>
  )
}

function DeleteDialog({
  book,
  onCancel,
  onConfirm
}: {
  book: BookSummary
  onCancel: () => void
  onConfirm: (keepUserData: boolean) => void | Promise<void>
}): JSX.Element {
  const [keep, setKeep] = useState(true)
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="作品の削除"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>「{book.title}」を削除しますか？</h2>
        <label className="check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          ハイライト・メモ・ブックマークは残す
        </label>
        <p className="muted small">
          残した場合、同じ作品を取り込み直すと元の位置に復元されます。
        </p>
        <div className="modal-actions">
          <button onClick={onCancel}>キャンセル</button>
          <button className="danger" onClick={() => void onConfirm(keep)}>削除</button>
        </div>
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
