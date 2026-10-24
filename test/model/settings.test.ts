import { describe, expect, it } from 'vitest'
import {
  appSettingsFromRaw,
  appSettingsToRaw,
  DEFAULT_SETTINGS,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
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

describe('アプリ設定の保存と読み戻し', () => {
  it('全項目が往復する', () => {
    // 項目を足したときに読み出し側へ足し忘れると、保存できるのに
    // 読み戻せないという形で静かに壊れる。既定値の全キーで確かめる。
    const settings: AppSettings = {
      theme: 'dark',
      libraryView: 'list',
      librarySort: 'title',
      updateCheck: 'on'
    }
    expect(appSettingsFromRaw(appSettingsToRaw(settings))).toEqual(settings)
  })

  it('既定値と違う値が全キーで読み戻せる', () => {
    // 既定値と一致してしまうと「読めていない」ことに気づけないので、
    // 1項目ずつ既定値からずらして確かめる。
    const alternatives: AppSettings = {
      theme: 'sepia',
      libraryView: 'list',
      librarySort: 'author',
      updateCheck: 'off'
    }
    for (const key of Object.keys(DEFAULT_APP_SETTINGS) as Array<keyof AppSettings>) {
      const changed = { ...DEFAULT_APP_SETTINGS, [key]: alternatives[key] }
      expect(alternatives[key]).not.toBe(DEFAULT_APP_SETTINGS[key])
      expect(appSettingsFromRaw(appSettingsToRaw(changed))[key]).toBe(alternatives[key])
    }
  })

  it('接頭辞の無い古い theme も読む', () => {
    expect(appSettingsFromRaw({ theme: 'dark' }).theme).toBe('dark')
  })

  it('接頭辞つきが古い値より優先される', () => {
    expect(appSettingsFromRaw({ theme: 'light', 'app.theme': 'dark' }).theme).toBe('dark')
  })

  it('空の保存値は既定値になる', () => {
    expect(appSettingsFromRaw({})).toEqual(DEFAULT_APP_SETTINGS)
  })
})
