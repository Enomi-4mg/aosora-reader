import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DEFAULT_APP_SETTINGS,
  FONT_SIZE_MAX,
  FONT_STACKS,
  LINE_HEIGHT_MIN,
  normalizeAppSettings,
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
    const bogus = { writingMode: 'diagonal' } as unknown as Partial<typeof DEFAULT_SETTINGS>
    const s = normalizeSettings(bogus)
    expect(s.writingMode).toBe('vertical')
    expect(normalizeAppSettings({ theme: 'neon' as never }).theme).toBe(DEFAULT_APP_SETTINGS.theme)
  })

  it('アプリ設定の本棚表示を正規化する', () => {
    expect(normalizeAppSettings({ libraryView: 'list', librarySort: 'title' })).toMatchObject({
      libraryView: 'list', librarySort: 'title'
    })
  })
})

describe('書体の読み替え', () => {
  it('古い版が保存した明朝体は、どの世代でも今の明朝体になる', () => {
    // 実際に保存されていた2世代ぶん。Yu Mincho を足した版と、その前。
    for (const old of [
      '"Hiragino Mincho ProN", "YuMincho", "Noto Serif JP", serif',
      '"Hiragino Mincho ProN", "YuMincho", "Yu Mincho", "Noto Serif JP", serif'
    ]) {
      expect(normalizeSettings({ fontFamily: old }).fontFamily).toBe(FONT_STACKS.mincho)
    }
  })

  it('ゴシック体と丸ゴシックも読み替える', () => {
    expect(
      normalizeSettings({ fontFamily: '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif' })
        .fontFamily
    ).toBe(FONT_STACKS.gothic)
    expect(
      normalizeSettings({ fontFamily: '"Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif' })
        .fontFamily
    ).toBe(FONT_STACKS.maruGothic)
  })

  it('組み込み書体は Windows にも同系統の書体が残る', () => {
    expect(FONT_STACKS.mincho).toContain('Yu Mincho')
    expect(FONT_STACKS.mincho).toContain('MS PMincho')
    expect(FONT_STACKS.gothic).toContain('Yu Gothic')
  })

  it('追加フォントなど知らない値はそのまま通す', () => {
    const custom = '"Aozora Custom 11111111-2222-3333-4444-555555555555"'
    expect(normalizeSettings({ fontFamily: custom }).fontFamily).toBe(custom)
  })
})
