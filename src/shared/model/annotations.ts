import type { TextPosition, TextRange } from './position'
import type { HighlightColor } from './settings'

export interface Bookmark {
  id: string
  bookId: string
  position: TextPosition
  label: string
  createdAt: string
}

export interface Highlight {
  id: string
  bookId: string
  range: TextRange
  selectedText: string
  color: HighlightColor
  createdAt: string
  updatedAt: string
  /** 本文更新後に保存範囲を復旧できなかった場合だけ true。 */
  orphaned: boolean
}

export interface Note {
  id: string
  bookId: string
  highlightId: string | null
  range: TextRange | null
  position: TextPosition | null
  text: string
  createdAt: string
  updatedAt: string
}

export interface AnnotationBundle {
  bookmarks: Bookmark[]
  highlights: Highlight[]
  notes: Note[]
}

export interface ReadingStats {
  totalDurationMs: number
  sessionCount: number
  estimatedCharsPerMinute: number
}

export interface DictionaryResult {
  term: string
  definitions: string[]
  source: string
  sourceUrl?: string
}
