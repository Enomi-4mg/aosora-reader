import { describe, expect, it, vi } from 'vitest'
import { importablePathsFromFiles } from '@renderer/library/dropImport'

describe('ドラッグ&ドロップ取り込み', () => {
  it('preload のパス解決を使って txt と zip だけを返す', () => {
    const txt = {} as File
    const zip = {} as File
    const image = {} as File
    const getPathForFile = vi
      .fn<(file: File) => string>()
      .mockReturnValueOnce('/books/one.txt')
      .mockReturnValueOnce('/books/two.ZIP')
      .mockReturnValueOnce('/books/cover.png')

    expect(importablePathsFromFiles([txt, zip, image], getPathForFile)).toEqual([
      '/books/one.txt',
      '/books/two.ZIP'
    ])
    expect(getPathForFile).toHaveBeenCalledTimes(3)
  })
})
