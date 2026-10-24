import { describe, expect, it, vi } from 'vitest'
import { UpdateService, textFetcher, MAX_FEED_BYTES } from '../../src/main/services/UpdateService'
import { CHECK_INTERVAL_MS } from '@shared/update'
import type { SettingsRepository } from '../../src/main/repositories/SettingsRepository'

/** SettingsRepository のうち UpdateService が使う分だけ。 */
function fakeSettings(initial: Record<string, unknown> = {}): SettingsRepository {
  const store = { ...initial }
  return {
    getAll: () => ({ ...store }),
    setMany: (values: Record<string, unknown>) => Object.assign(store, values),
    clear: () => {}
  } as unknown as SettingsRepository
}

const feed = (version: string): string => `version: ${version}\nfiles:\n  - url: x\n`

describe('UpdateService', () => {
  it('設定が off なら外に出ない', async () => {
    const fetchText = vi.fn()
    const service = new UpdateService('0.1.0', fakeSettings(), fetchText)

    expect(await service.check(false)).toEqual({ state: 'disabled' })
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('新しい版があれば知らせる', async () => {
    const service = new UpdateService('0.1.0', fakeSettings(), async () => feed('0.2.0'))
    const status = await service.check(true)

    expect(status.state).toBe('available')
    if (status.state === 'available') {
      expect(status.version).toBe('0.2.0')
      expect(status.url).toContain('releases')
    }
  })

  it('同じ版なら current', async () => {
    const service = new UpdateService('0.2.0', fakeSettings(), async () => feed('0.2.0'))
    expect(await service.check(true)).toEqual({ state: 'current', version: '0.2.0' })
  })

  it('配布側が古くても「新しい」とは言わない', async () => {
    const service = new UpdateService('0.3.0', fakeSettings(), async () => feed('0.2.0'))
    expect((await service.check(true)).state).toBe('current')
  })

  it('24時間以内は取りに行かず、覚えている結果で答える', async () => {
    const settings = fakeSettings()
    const fetchText = vi.fn(async () => feed('0.2.0'))
    let now = 1_000_000
    const service = new UpdateService('0.1.0', settings, fetchText, () => now)

    expect((await service.check(true)).state).toBe('available')
    expect(fetchText).toHaveBeenCalledTimes(1)

    now += CHECK_INTERVAL_MS - 1
    expect((await service.check(true)).state).toBe('available')
    expect(fetchText).toHaveBeenCalledTimes(1)
  })

  it('24時間を越えたら取り直す', async () => {
    const settings = fakeSettings()
    const fetchText = vi.fn(async () => feed('0.2.0'))
    let now = 1_000_000
    const service = new UpdateService('0.1.0', settings, fetchText, () => now)

    await service.check(true)
    now += CHECK_INTERVAL_MS + 1
    await service.check(true)
    expect(fetchText).toHaveBeenCalledTimes(2)
  })

  it('force なら間隔を無視する', async () => {
    const fetchText = vi.fn(async () => feed('0.2.0'))
    const service = new UpdateService('0.1.0', fakeSettings(), fetchText, () => 1_000_000)

    await service.check(true)
    await service.check(true, true)
    expect(fetchText).toHaveBeenCalledTimes(2)
  })

  it('圏外でも黙って諦める', async () => {
    const service = new UpdateService('0.1.0', fakeSettings(), async () => {
      throw new Error('getaddrinfo ENOTFOUND github.com')
    })
    expect(await service.check(true)).toEqual({ state: 'unavailable' })
  })

  it('取れなかったときは前回の結果を上書きしない', async () => {
    const settings = fakeSettings()
    let now = 1_000_000
    let body = feed('0.2.0')
    const service = new UpdateService('0.1.0', settings, async () => body, () => now)

    await service.check(true)
    expect(settings.getAll()['update.latestVersion']).toBe('0.2.0')

    now += CHECK_INTERVAL_MS + 1
    body = '<html>503</html>'
    expect((await service.check(true)).state).toBe('unavailable')
    expect(settings.getAll()['update.latestVersion']).toBe('0.2.0')
  })

  it('リリースがまだ無くても落ちない', async () => {
    // 下書きしか無いうちは 404 が返る。
    const service = new UpdateService('0.1.0', fakeSettings(), async () => {
      throw new Error('更新情報を取得できませんでした (404)')
    })
    expect(await service.check(true)).toEqual({ state: 'unavailable' })
  })
})

describe('textFetcher', () => {
  it('ok でない応答は投げる', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }))
    await expect(textFetcher(fetchImpl)('https://example.test/latest.yml')).rejects.toThrow('404')
  })

  it('大きすぎる本文は読まない', async () => {
    const huge = 'x'.repeat(MAX_FEED_BYTES + 1)
    const fetchImpl = vi.fn(async () => new Response(huge, { status: 200 }))
    await expect(textFetcher(fetchImpl)('https://example.test/latest.yml')).rejects.toThrow(
      '大きすぎます'
    )
  })

  it('中断できるよう signal を渡す', async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init: { signal: AbortSignal }) =>
        new Response(feed('0.2.0'), { status: 200 })
    )
    await textFetcher(fetchImpl)('https://example.test/latest.yml')
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
