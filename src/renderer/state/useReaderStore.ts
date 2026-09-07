/**
 * Reader の状態(要件 §8)。
 *
 * **ページ番号・DOM 参照といったレイアウト状態はここに置かない。**
 * それらは LayoutController の内部に閉じる。ストアが持つ位置情報は
 * TextPosition だけで、永続化されるのもそれだけ(要件 §20-1)。
 */
import { create } from 'zustand'
import type { Book, Chapter } from '@shared/model/document'
import {
  buildBookIndex,
  positionToPercentage,
  startPosition,
  type BookIndex,
  type TextPosition
} from '@shared/model/position'
import type { SearchResultDto } from '@shared/ipc'

export type SidebarTab = 'contents' | 'annotations' | 'bookmarks' | 'highlights' | 'notes'

interface ReaderState {
  book: Book | null
  index: BookIndex | null
  chapterIndex: number
  /** 現在の本文位置。読書位置の保存対象。 */
  position: TextPosition | null
  percentage: number
  loading: boolean
  error: string | null

  sidebarOpen: boolean
  sidebarTab: SidebarTab
  settingsOpen: boolean
  focusMode: boolean

  searchOpen: boolean
  searchQuery: string
  searchResult: SearchResultDto | null
  searchCursor: number
  /** 検索だけの失敗。本文表示は続けるので error とは分けて持つ。 */
  searchError: string | null

  open: (bookId: string) => Promise<void>
  close: () => void
  setChapter: (i: number) => void
  setPosition: (p: TextPosition) => void
  toggleSidebar: () => void
  setSidebarTab: (t: SidebarTab) => void
  setSettingsOpen: (v: boolean) => void
  setFocusMode: (v: boolean) => void
  openSearch: () => void
  closeSearch: () => void
  runSearch: (q: string) => Promise<void>
  moveSearchCursor: (d: number) => void
}

/** 入力中に古い検索応答が戻ってきても、最新結果を上書きさせない。 */
let latestSearchRequest = 0
/** 作品切り替え・離脱後に届いた読み込み応答は反映しない。 */
let latestOpenRequest = 0

export const useReaderStore = create<ReaderState>((set, get) => ({
  book: null,
  index: null,
  chapterIndex: 0,
  position: null,
  percentage: 0,
  loading: false,
  error: null,

  sidebarOpen: false,
  sidebarTab: 'contents',
  settingsOpen: false,
  focusMode: false,

  searchOpen: false,
  searchQuery: '',
  searchResult: null,
  searchCursor: 0,
  searchError: null,

  async open(bookId) {
    const request = ++latestOpenRequest
    latestSearchRequest++
    set({ loading: true, error: null, searchQuery: '', searchResult: null, searchCursor: 0, searchError: null })
    try {
      const r = await window.aozora.openBook(bookId)
      if (request !== latestOpenRequest) return
      if (!r) {
        set({ loading: false, error: '作品を開けませんでした。' })
        return
      }
      const index = buildBookIndex(r.book)
      // 保存された TextPosition から復帰する。ページ番号は使わない(要件 §4.9)
      const position = r.progress?.position ?? startPosition(index)
      const chapterIndex = position
        ? Math.max(0, r.book.chapters.findIndex((c) => c.id === position.chapterId))
        : 0

      set({
        book: r.book,
        index,
        position,
        chapterIndex,
        percentage: position ? positionToPercentage(index, position) : 0,
        loading: false
      })
    } catch (e) {
      if (request !== latestOpenRequest) return
      set({
        loading: false,
        error: e instanceof Error ? e.message : '作品を開けませんでした。'
      })
    }
  },

  close() {
    latestOpenRequest++
    latestSearchRequest++
    set({
      book: null,
      loading: false,
      error: null,
      index: null,
      position: null,
      chapterIndex: 0,
      percentage: 0,
      searchOpen: false,
      searchResult: null,
      searchQuery: '',
      searchError: null,
      focusMode: false
    })
  },

  setChapter(i) {
    const { book } = get()
    if (!book) return
    set({ chapterIndex: Math.max(0, Math.min(i, book.chapters.length - 1)) })
  },

  setPosition(p) {
    const { index } = get()
    set({
      position: p,
      percentage: index ? positionToPercentage(index, p) : 0
    })
  },

  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab, sidebarOpen: true }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen, searchOpen: settingsOpen ? false : get().searchOpen }),
  setFocusMode: (focusMode) => set({ focusMode }),

  openSearch: () => set({ searchOpen: true, settingsOpen: false }),
  closeSearch: () => set({ searchOpen: false }),

  async runSearch(q) {
    const request = ++latestSearchRequest
    const { book } = get()
    set({ searchQuery: q, searchError: null })
    if (!book || q.trim() === '') {
      set({ searchResult: null, searchCursor: 0 })
      return
    }
    let r: SearchResultDto
    try {
      r = await window.aozora.searchBook(book.id, q)
    } catch (e) {
      // 検索が失敗しても本文閲覧は続けられるようにする(要件 §9)
      if (request === latestSearchRequest) {
        set({
          searchResult: null,
          searchCursor: 0,
          searchError: e instanceof Error ? e.message : '検索できませんでした。'
        })
      }
      return
    }
    if (
      request !== latestSearchRequest ||
      get().book?.id !== book.id ||
      get().searchQuery !== q
    ) {
      return
    }
    set({ searchResult: r, searchCursor: 0 })
  },

  moveSearchCursor(d) {
    const r = get().searchResult
    if (!r || r.count === 0) return
    set({ searchCursor: (get().searchCursor + d + r.count) % r.count })
  }
}))

/** 現在の章。 */
export function currentChapter(s: ReaderState): Chapter | null {
  return s.book?.chapters[s.chapterIndex] ?? null
}
