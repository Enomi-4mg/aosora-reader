import { create } from 'zustand'
import type { AnnotationBundle, Bookmark, Highlight, Note } from '@shared/model/annotations'
import type { TextPosition, TextRange } from '@shared/model/position'
import type { HighlightColor } from '@shared/model/settings'

const EMPTY: AnnotationBundle = { bookmarks: [], highlights: [], notes: [] }

interface AnnotationState extends AnnotationBundle {
  bookId: string | null
  loading: boolean
  error: string | null
  load: (bookId: string) => Promise<void>
  clear: () => void
  addBookmark: (position: TextPosition, label: string) => Promise<Bookmark | null>
  updateBookmark: (id: string, label: string) => Promise<void>
  deleteBookmark: (id: string) => Promise<void>
  addHighlight: (range: TextRange, selectedText: string, color: HighlightColor) => Promise<Highlight | null>
  deleteHighlight: (id: string) => Promise<void>
  saveNote: (input: { id?: string; highlightId?: string | null; range?: TextRange | null; position?: TextPosition | null; text: string }) => Promise<Note | null>
  deleteNote: (id: string) => Promise<void>
}

export const useAnnotationsStore = create<AnnotationState>((set, get) => ({
  ...EMPTY,
  bookId: null,
  loading: false,
  error: null,

  async load(bookId) {
    set({ bookId, loading: true, error: null, ...EMPTY })
    try {
      const bundle = await window.aozora.listAnnotations(bookId)
      if (get().bookId === bookId) set({ ...bundle, loading: false })
    } catch (error) {
      set({ loading: false, error: message(error) })
    }
  },

  clear: () => set({ bookId: null, error: null, loading: false, ...EMPTY }),

  async addBookmark(position, label) {
    const bookId = get().bookId
    if (!bookId) return null
    try {
      const bookmark = await window.aozora.addBookmark(bookId, position, label)
      set({ bookmarks: [...get().bookmarks, bookmark] })
      return bookmark
    } catch (error) {
      set({ error: message(error) })
      return null
    }
  },

  async updateBookmark(id, label) {
    try {
      await window.aozora.updateBookmark(id, label)
      set({ bookmarks: get().bookmarks.map((b) => b.id === id ? { ...b, label } : b) })
    } catch (error) { set({ error: message(error) }) }
  },

  async deleteBookmark(id) {
    try {
      await window.aozora.deleteBookmark(id)
      set({ bookmarks: get().bookmarks.filter((b) => b.id !== id) })
    } catch (error) { set({ error: message(error) }) }
  },

  async addHighlight(range, selectedText, color) {
    const bookId = get().bookId
    if (!bookId) return null
    try {
      const highlight = await window.aozora.addHighlight(bookId, range, selectedText, color)
      set({ highlights: [...get().highlights, highlight] })
      return highlight
    } catch (error) {
      set({ error: message(error) })
      return null
    }
  },

  async deleteHighlight(id) {
    try {
      await window.aozora.deleteHighlight(id)
      set({ highlights: get().highlights.filter((h) => h.id !== id) })
    } catch (error) { set({ error: message(error) }) }
  },

  async saveNote(input) {
    const bookId = get().bookId
    if (!bookId || !input.text.trim()) return null
    try {
      const note = await window.aozora.saveNote({ ...input, bookId, text: input.text.trim() })
      const notes = get().notes
      set({ notes: input.id ? notes.map((n) => n.id === input.id ? note : n) : [...notes, note] })
      return note
    } catch (error) {
      set({ error: message(error) })
      return null
    }
  },

  async deleteNote(id) {
    try {
      await window.aozora.deleteNote(id)
      set({ notes: get().notes.filter((n) => n.id !== id) })
    } catch (error) { set({ error: message(error) }) }
  }
}))

function message(error: unknown): string {
  return error instanceof Error ? error.message : '注釈を保存できませんでした。'
}
