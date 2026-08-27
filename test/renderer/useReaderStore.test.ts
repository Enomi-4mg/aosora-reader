import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useReaderStore } from '@renderer/state/useReaderStore'
import { buildBook } from '../helpers'
import type { SearchResultDto } from '@shared/ipc'

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
