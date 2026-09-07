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


it.each(['bookmark', 'highlight', 'note'])('作品切り替え後に古い %s を混入させない', async (kind) => {
  useAnnotationsStore.getState().clear()
  let resolve!: (value: unknown) => void
  const pending = new Promise((done) => { resolve = done })
  vi.stubGlobal('window', { aozora: {
    listAnnotations: vi.fn().mockResolvedValue({ bookmarks: [], highlights: [], notes: [] }),
    addBookmark: vi.fn().mockReturnValue(pending),
    addHighlight: vi.fn().mockReturnValue(pending),
    saveNote: vi.fn().mockReturnValue(pending)
  } })
  await useAnnotationsStore.getState().load('a')
  const position = { bookId: 'a', chapterId: 'c0', blockId: 'b0', offset: 0 }
  const store = useAnnotationsStore.getState()
  const saving = kind === 'bookmark' ? store.addBookmark(position, '栞')
    : kind === 'highlight' ? store.addHighlight({ start: position, end: position }, '本文', 'yellow')
    : store.saveNote({ position, text: 'メモ' })
  await store.load('b')
  resolve({ id: 'old', bookId: 'a' })
  await saving
  expect(useAnnotationsStore.getState()).toMatchObject({ bookId: 'b', bookmarks: [], highlights: [], notes: [] })
})

it('同じ作品を再度開いても古い一覧で上書きしない', async () => {
  useAnnotationsStore.getState().clear()
  let resolve!: (value: unknown) => void
  const pending = new Promise((done) => { resolve = done })
  vi.stubGlobal('window', { aozora: { listAnnotations: vi.fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce({ bookmarks: [], highlights: [], notes: [] }) } })
  const first = useAnnotationsStore.getState().load('a')
  await useAnnotationsStore.getState().load('a')
  resolve({ bookmarks: [{ id: 'obsolete' }], highlights: [], notes: [] })
  await first
  expect(useAnnotationsStore.getState().bookmarks).toEqual([])
})

it('前の作品の読み込み失敗で現在の読み込みを終了させない', async () => {
  useAnnotationsStore.getState().clear()
  let reject!: (error: Error) => void
  let resolve!: (value: unknown) => void
  vi.stubGlobal('window', { aozora: { listAnnotations: vi.fn()
    .mockReturnValueOnce(new Promise((_, fail) => { reject = fail }))
    .mockReturnValueOnce(new Promise((done) => { resolve = done })) } })
  const first = useAnnotationsStore.getState().load('a')
  const second = useAnnotationsStore.getState().load('b')
  reject(new Error('古いエラー'))
  await first
  expect(useAnnotationsStore.getState()).toMatchObject({ bookId: 'b', loading: true, error: null })
  resolve({ bookmarks: [], highlights: [], notes: [] })
  await second
})
