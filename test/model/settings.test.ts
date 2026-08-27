import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  normalizeSettings
} from '@shared/model/settings'

describe('normalizeSettings', () => {
  it('null や空オブジェクトは既定値になる', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('数値を範囲へ丸める', () => {
    const s = normalizeSettings({ fontSize: 999, lineHeight: 0.5, ttsRate: -3 })
    expect(s.fontSize).toBe(FONT_SIZE_MAX)
    expect(s.lineHeight).toBe(LINE_HEIGHT_MIN)
    expect(s.ttsRate).toBe(0.5)
  })

  it('壊れた fontFamily を既定値へ戻す', () => {
    const broken = { fontFamily: 42 } as unknown as Partial<typeof DEFAULT_SETTINGS>
    expect(normalizeSettings(broken).fontFamily).toBe(DEFAULT_SETTINGS.fontFamily)
    expect(normalizeSettings({ fontFamily: '   ' }).fontFamily).toBe(DEFAULT_SETTINGS.fontFamily)
  })

  it('妥当な fontFamily はそのまま通す', () => {
    expect(normalizeSettings({ fontFamily: 'serif' }).fontFamily).toBe('serif')
  })

  it('列挙値は既知の値だけを受ける', () => {
    const bogus = { theme: 'neon', writingMode: 'diagonal' } as unknown as Partial<typeof DEFAULT_SETTINGS>
    const s = normalizeSettings(bogus)
    expect(s.theme).toBe('system')
    expect(s.writingMode).toBe('vertical')
  })
})
