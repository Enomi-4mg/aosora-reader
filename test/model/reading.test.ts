import { describe, expect, it } from 'vitest'
import { estimateRemainingMinutes, formatReadingTime } from '@shared/reading'

describe('読了時間', () => {
  it('文字数と TextPosition 由来の進捗から残り時間を求める', () => {
    expect(estimateRemainingMinutes(60_000, 0.5, 500)).toBe(60)
    expect(formatReadingTime(80)).toBe('残り 約1時間20分')
    expect(formatReadingTime(7)).toBe('残り 約7分')
  })

  it('範囲外の進捗を安全に丸める', () => {
    expect(estimateRemainingMinutes(1000, 2, 500)).toBe(0)
    expect(estimateRemainingMinutes(1000, -1, 500)).toBe(2)
  })
})
