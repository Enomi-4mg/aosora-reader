import { describe, expect, it } from 'vitest'
import { sentenceRanges } from '@renderer/reader/hooks/useTtsController'
import { buildBook } from '../helpers'

describe('TTS sentence ranges', () => {
  it('文ごとに読み上げ文字列と TextRange を作る', () => {
    const book = buildBook([['章', ['最初の文です。次の文！']]])
    const ranges = sentenceRanges(book)
    expect(ranges.map((item) => item.text)).toEqual(['最初の文です。', '次の文！'])
    expect(ranges[0]!.range.start.offset).toBe(0)
    expect(ranges[0]!.range.end.offset).toBe('最初の文です。'.length)
    expect(ranges[1]!.range.start.blockId).toBe(ranges[0]!.range.start.blockId)
  })
})
