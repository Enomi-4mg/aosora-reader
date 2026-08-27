/** 本棚(要件 §4.13)。 */
import { create } from 'zustand'
import type { BookSummary } from '@shared/model/document'
import type { ImportOutcome } from '@shared/ipc'

export type SortKey = 'recent' | 'title' | 'author' | 'added' | 'progress'
export type ViewMode = 'grid' | 'list'

interface LibraryState {
  books: BookSummary[]
  query: string
  sort: SortKey
  view: ViewMode
  busy: boolean
  notice: string | null

  refresh: () => Promise<void>
  importDialog: () => Promise<void>
  importPaths: (paths: string[]) => Promise<void>
  remove: (bookId: string, keepUserData: boolean) => Promise<void>
  setQuery: (q: string) => void
  setSort: (s: SortKey) => void
  setView: (v: ViewMode) => void
  dismissNotice: () => void
}

function summarize(results: ImportOutcome[]): string | null {
  if (results.length === 0) return null
  const ok = results.filter((r) => r.status === 'imported' || r.status === 'restored').length
  const dup = results.filter((r) => r.status === 'duplicate').length
  const err = results.filter((r) => r.status === 'error')
  const enc = results.filter((r) => r.status === 'needs-encoding')

  const parts: string[] = []
  if (ok > 0) parts.push(`${ok}件を追加しました`)
  if (dup > 0) parts.push(`${dup}件は既に登録済みです`)
  if (enc.length > 0) parts.push(`${enc.length}件は文字コードを判定できませんでした`)
  for (const e of err) {
    if (e.status === 'error') parts.push(e.message)
  }
  return parts.join(' / ')
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  query: '',
  sort: 'recent',
  view: 'grid',
  busy: false,
  notice: null,

  async refresh() {
    set({ books: await window.aozora.listBooks() })
  },

  async importDialog() {
    set({ busy: true })
    try {
      const r = await window.aozora.importDialog()
      set({ notice: summarize(r) })
      await get().refresh()
    } catch (e) {
      set({ notice: e instanceof Error ? e.message : '取り込みに失敗しました。' })
    } finally {
      set({ busy: false })
    }
  },

  async importPaths(paths) {
    set({ busy: true })
    try {
      const r = await window.aozora.importPaths(paths)
      set({ notice: summarize(r) })
      await get().refresh()
    } catch (e) {
      set({ notice: e instanceof Error ? e.message : '取り込みに失敗しました。' })
    } finally {
      set({ busy: false })
    }
  },

  async remove(bookId, keepUserData) {
    await window.aozora.deleteBook(bookId, keepUserData)
    await get().refresh()
  },

  setQuery: (query) => set({ query }),
  setSort: (sort) => set({ sort }),
  setView: (view) => set({ view }),
  dismissNotice: () => set({ notice: null })
}))

/** 検索と並び替えを適用した一覧。 */
export function selectVisibleBooks(s: LibraryState): BookSummary[] {
  const q = s.query.trim().toLowerCase()
  const filtered =
    q === ''
      ? s.books
      : s.books.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            (b.author ?? '').toLowerCase().includes(q)
        )

  const sorted = [...filtered]
  switch (s.sort) {
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'ja'))
      break
    case 'author':
      sorted.sort((a, b) => (a.author ?? '').localeCompare(b.author ?? '', 'ja'))
      break
    case 'added':
      sorted.sort((a, b) => b.importedAt.localeCompare(a.importedAt))
      break
    case 'progress':
      sorted.sort((a, b) => b.percentage - a.percentage)
      break
    default:
      sorted.sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))
  }
  return sorted
}
