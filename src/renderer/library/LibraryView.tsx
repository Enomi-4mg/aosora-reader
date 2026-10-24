/** 本棚(要件 §4.13 / §4.14 / §12)。 */
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import { Cog6ToothIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/outline'
import { useLibraryStore, selectVisibleBooks, type SortKey } from '../state/useLibraryStore'
import type { BookSummary } from '@shared/model/document'
import type { AozoraCatalogWork } from '@shared/ipc'
import { BookActionsMenu } from './BookActionsMenu'
import { useAppSettingsStore } from '../state/useAppSettingsStore'
import { AppSettingsDialog } from '../settings/AppSettingsDialog'
import { useUpdateNotice } from '../hooks/useUpdateNotice'

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
  const app = useAppSettingsStore()
  const update = useUpdateNotice()
  const books = selectVisibleBooks(s)
  const [pendingDelete, setPendingDelete] = useState<BookSummary | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void s.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    s.setView(app.settings.libraryView)
    s.setSort(app.settings.librarySort)
  }, [app.settings.libraryView, app.settings.librarySort])

  const closeSettings = (): void => {
    setSettingsOpen(false)
    requestAnimationFrame(() => settingsButtonRef.current?.focus())
  }

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
          onChange={(e) => {
            const sort = e.target.value as SortKey
            s.setSort(sort)
            void app.patch({ librarySort: sort })
          }}
        >
          {SORT_LABELS.map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <div className="seg" role="group" aria-label="表示形式">
          <button
            className={s.view === 'grid' ? 'on' : ''}
            aria-pressed={s.view === 'grid'}
            onClick={() => { s.setView('grid'); void app.patch({ libraryView: 'grid' }) }}
          >
            グリッド
          </button>
          <button
            className={s.view === 'list' ? 'on' : ''}
            aria-pressed={s.view === 'list'}
            onClick={() => { s.setView('list'); void app.patch({ libraryView: 'list' }) }}
          >
            リスト
          </button>
        </div>
        <button ref={settingsButtonRef} className="library-settings-button" aria-label="アプリ設定" onClick={() => setSettingsOpen(true)}>
          <Cog6ToothIcon aria-hidden="true" />
        </button>
        <button disabled={s.busy} onClick={() => void s.importDialog()}>
          ファイルから追加
        </button>
        <button className="primary" disabled={s.busy} onClick={() => setCatalogOpen(true)}>
          青空文庫から追加
        </button>
      </header>

      {s.notice && (
        <div className="notice" role="status">
          <span>{s.notice}</span>
          <button className="ghost" onClick={s.dismissNotice} aria-label="通知を閉じる">×</button>
        </div>
      )}

      {update.notice?.kind === 'consent' && (
        <div className="notice" role="status">
          <span>
            新しい版が出たときにお知らせしますか？
            <span className="muted small">
              {' '}確認のたびに GitHub へ接続します。あとから設定で変えられます。
            </span>
          </span>
          <span className="notice-actions">
            <button onClick={update.allow}>知らせる</button>
            <button className="ghost" onClick={update.decline}>しない</button>
          </span>
        </div>
      )}

      {update.notice?.kind === 'available' && (
        <div className="notice" role="status">
          <span>青空Reader {update.notice.version} が公開されています。</span>
          <span className="notice-actions">
            <a href={update.notice.url} target="_blank" rel="noreferrer">ダウンロード</a>
            <button className="ghost" onClick={update.dismiss} aria-label="通知を閉じる">×</button>
          </span>
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
              <BookCard
                book={b}
                menuOpen={openMenuId === b.id}
                onToggleMenu={() => setOpenMenuId((id) => id === b.id ? null : b.id)}
                onOpen={onOpen}
                onDelete={() => setPendingDelete(b)}
              />
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
      {catalogOpen && (
        <AozoraCatalogDialog
          busy={s.busy}
          onClose={() => setCatalogOpen(false)}
          onDownload={async (workId) => {
            const ok = await s.downloadWork(workId)
            if (ok) setCatalogOpen(false)
          }}
        />
      )}
      {settingsOpen && <AppSettingsDialog onClose={closeSettings} />}
    </div>
  )
}

function AozoraCatalogDialog({
  busy,
  onClose,
  onDownload
}: {
  busy: boolean
  onClose: () => void
  onDownload: (workId: string) => Promise<void>
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AozoraCatalogWork[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (query.trim().length < 2) {
      setError('タイトルまたは著者名を2文字以上入力してください。')
      return
    }
    setSearching(true)
    setError(null)
    try {
      const found = await window.aozora.searchAozoraCatalog(query)
      setResults(found)
    } catch (e) {
      setError(e instanceof Error ? e.message : '公式カタログを検索できませんでした。')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal catalog-modal"
        role="dialog"
        aria-modal="true"
        aria-label="青空文庫から作品を追加"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="catalog-head">
          <div>
            <h2>青空文庫から追加</h2>
            <p className="muted small">公式の公開作品をタイトル・著者名で検索します。</p>
          </div>
          <button className="ghost" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <form className="catalog-search" onSubmit={(e) => void search(e)}>
          <input
            autoFocus
            type="search"
            value={query}
            placeholder="例：こころ、夏目漱石"
            aria-label="青空文庫を検索"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="primary" disabled={searching || busy}>
            {searching ? '検索中…' : '検索'}
          </button>
        </form>
        {error && <p className="catalog-error" role="alert">{error}</p>}
        <div className="catalog-results" aria-live="polite">
          {!searching && !error && results.length === 0 && query.trim().length >= 2 && (
            <p className="muted">検索結果はありません。</p>
          )}
          {results.map((work) => (
            <article className="catalog-work" key={work.id}>
              <div>
                <strong>{work.title}</strong>
                <span>{work.author}</span>
                <span className="small muted">公開日 {work.publishedAt}</span>
              </div>
              <button disabled={busy} onClick={() => void onDownload(work.id)}>
                {busy ? '追加中…' : '追加'}
              </button>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

export function BookCard({
  book,
  menuOpen,
  onToggleMenu,
  onOpen,
  onDelete
}: {
  book: BookSummary
  menuOpen: boolean
  onToggleMenu: () => void
  onOpen: (id: string) => void
  onDelete: () => void
}): JSX.Element {
  const pct = Math.round(book.percentage * 100)
  return (
    <article className={`card${menuOpen ? ' menu-open' : ''}`}>
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
      <button
        type="button"
        className="ghost card-menu-trigger"
        aria-label={`${book.title} の操作メニュー`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onToggleMenu()
        }}
      >
        <EllipsisHorizontalIcon aria-hidden="true" />
      </button>
      {menuOpen && <BookActionsMenu
        title={book.title}
        onClose={onToggleMenu}
        onDelete={() => { onToggleMenu(); onDelete() }}
      />}
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
