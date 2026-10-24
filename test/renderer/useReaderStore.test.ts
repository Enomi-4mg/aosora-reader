import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useReaderStore } from '@renderer/state/useReaderStore'
import { buildBook } from '../helpers'
import type { OpenBookResult, SearchResultDto } from '@shared/ipc'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function result(query: string): SearchResultDto {
  return { query, count: 0, truncated: false, matches: [] }
}

describe('useReaderStore の本文検索', () => {
  beforeEach(() => {
    useReaderStore.getState().close()
    useReaderStore.setState({
      book: buildBook([['章', ['本文']]]),
      searchQuery: '',
      searchResult: null,
      searchCursor: 0
    })
  })

  it('遅れて返った古い検索結果で最新結果を上書きしない', async () => {
    const oldRequest = deferred<SearchResultDto>()
    const newRequest = deferred<SearchResultDto>()
    const searchBook = vi
      .fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise)
    vi.stubGlobal('window', { aozora: { searchBook } })

    const oldRun = useReaderStore.getState().runSearch('古い')
    const newRun = useReaderStore.getState().runSearch('新しい')

    newRequest.resolve(result('新しい'))
    await newRun
    oldRequest.resolve(result('古い'))
    await oldRun

    expect(useReaderStore.getState().searchQuery).toBe('新しい')
    expect(useReaderStore.getState().searchResult?.query).toBe('新しい')
  })
})


describe('useReaderStore の作品切り替え', () => {
  beforeEach(() => useReaderStore.getState().close())

  it('後から開いた作品を古い応答で上書きしない', async () => {
    const first = deferred<OpenBookResult | null>()
    const second = deferred<OpenBookResult | null>()
    vi.stubGlobal('window', { aozora: { openBook: vi.fn()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) } })
    const a = useReaderStore.getState().open('a')
    const b = useReaderStore.getState().open('b')
    second.resolve({ book: buildBook([['章', ['B']]], 'b'), progress: null, needsReimport: false, reparsed: null })
    await b
    first.resolve({ book: buildBook([['章', ['A']]], 'a'), progress: null, needsReimport: false, reparsed: null })
    await a
    expect(useReaderStore.getState().book?.id).toBe('b')
  })

  it.each(['success', 'missing', 'failure'])('閉じた後の %s 応答を無視する', async (outcome) => {
    const pending = deferred<OpenBookResult | null>()
    vi.stubGlobal('window', { aozora: { openBook: vi.fn(() => pending.promise.then((value) => {
      if (outcome === 'failure') throw new Error('遅れたエラー')
      return value
    })) } })
    const opening = useReaderStore.getState().open('a')
    useReaderStore.getState().close()
    expect(useReaderStore.getState().loading).toBe(false)
    pending.resolve(outcome === 'success'
      ? { book: buildBook([['章', ['A']]], 'a'), progress: null, needsReimport: false, reparsed: null } : null)
    await opening
    expect(useReaderStore.getState()).toMatchObject({ book: null, loading: false, error: null })
  })

  it('作品切り替え時に前の作品の検索結果を消す', async () => {
    useReaderStore.setState({ searchQuery: '古い', searchResult: result('古い'), searchCursor: 2 })
    vi.stubGlobal('window', { aozora: { openBook: vi.fn().mockResolvedValue({
      book: buildBook([['章', ['B']]], 'b'), progress: null
    }) } })
    await useReaderStore.getState().open('b')
    expect(useReaderStore.getState()).toMatchObject({ searchQuery: '', searchResult: null, searchCursor: 0 })
  })
})

describe('useReaderStore の作り直しの知らせ', () => {
  beforeEach(() => useReaderStore.getState().close())

  const opened = (reparsed: OpenBookResult['reparsed']): OpenBookResult => ({
    book: buildBook([['章', ['本文']]], 'a'),
    progress: null,
    needsReimport: false,
    reparsed
  })

  function stub(result: OpenBookResult, willReparse?: unknown): void {
    vi.stubGlobal('window', {
      aozora: {
        openBook: vi.fn().mockResolvedValue(result),
        ...(willReparse === undefined ? {} : { willReparse })
      }
    })
  }

  it('位置が動いていれば知らせを持つ', async () => {
    stub(opened({ movedPositions: 12, droppedPositions: 0 }))
    await useReaderStore.getState().open('a')
    expect(useReaderStore.getState().reparsed).toEqual({ movedPositions: 12, droppedPositions: 0 })
  })

  it('付け替えられなかったぶんだけでも知らせる', async () => {
    stub(opened({ movedPositions: 0, droppedPositions: 3 }))
    await useReaderStore.getState().open('a')
    expect(useReaderStore.getState().reparsed?.droppedPositions).toBe(3)
  })

  it('作り直しても位置が動いていないなら知らせない', async () => {
    // 読み手に伝えることが無い。本文が変わっただけなら黙っている。
    stub(opened({ movedPositions: 0, droppedPositions: 0 }))
    await useReaderStore.getState().open('a')
    expect(useReaderStore.getState().reparsed).toBeNull()
  })

  it('作り直していなければ知らせない', async () => {
    stub(opened(null))
    await useReaderStore.getState().open('a')
    expect(useReaderStore.getState().reparsed).toBeNull()
  })

  it('閉じられる', async () => {
    stub(opened({ movedPositions: 1, droppedPositions: 0 }))
    await useReaderStore.getState().open('a')
    useReaderStore.getState().dismissReparseReport()
    expect(useReaderStore.getState().reparsed).toBeNull()
  })

  it('別の作品を開けば前の知らせは消える', async () => {
    stub(opened({ movedPositions: 5, droppedPositions: 0 }))
    await useReaderStore.getState().open('a')
    stub(opened(null))
    await useReaderStore.getState().open('b')
    expect(useReaderStore.getState().reparsed).toBeNull()
  })

  it('作り直しが走るなら待っているあいだ理由を出す', async () => {
    const gate = deferred<OpenBookResult | null>()
    vi.stubGlobal('window', {
      aozora: {
        openBook: vi.fn(() => gate.promise),
        willReparse: vi.fn().mockResolvedValue(true)
      }
    })
    const opening = useReaderStore.getState().open('a')
    await Promise.resolve()
    await Promise.resolve()
    expect(useReaderStore.getState().reparsing).toBe(true)

    gate.resolve(opened(null))
    await opening
    expect(useReaderStore.getState().reparsing).toBe(false)
  })

  it('事前判定が無くても開ける', async () => {
    // willReparse が無い/投げる環境でも、開く処理まで巻き込まない。
    stub(opened(null), vi.fn(() => { throw new Error('ない') }))
    await useReaderStore.getState().open('a')
    expect(useReaderStore.getState().book?.id).toBe('a')
    expect(useReaderStore.getState().reparsing).toBe(false)
  })
})
