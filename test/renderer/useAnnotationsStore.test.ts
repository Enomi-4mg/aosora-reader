import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnnotationsStore } from '@renderer/state/useAnnotationsStore'

describe('useAnnotationsStore', () => {
  beforeEach(() => useAnnotationsStore.getState().clear())

  it('永続化 API の結果を現在作品の一覧へ反映する', async () => {
    const position = { bookId: 'book', chapterId: 'c0', blockId: 'b0', offset: 2 }
    const bookmark = { id: 'bookmark', bookId: 'book', position, label: '章 ― 本文', createdAt: '2026-08-27' }
    const listAnnotations = vi.fn().mockResolvedValue({ bookmarks: [], highlights: [], notes: [] })
    const addBookmark = vi.fn().mockResolvedValue(bookmark)
    vi.stubGlobal('window', { aozora: { listAnnotations, addBookmark } })

    await useAnnotationsStore.getState().load('book')
    await useAnnotationsStore.getState().addBookmark(position, bookmark.label)

    expect(listAnnotations).toHaveBeenCalledWith('book')
    expect(useAnnotationsStore.getState().bookmarks).toEqual([bookmark])
  })
})
