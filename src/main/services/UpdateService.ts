/**
 * 更新があるかどうかを調べて覚えておく。
 *
 * ここでやるのは知らせることだけで、落としも入れ替えもしない。
 * 自動更新に進むには署名が要り、署名の無い自動更新は更新のたびに
 * SmartScreen を踏ませることになるので、まず通知だけを置く。
 *
 * 外へ出るのは設定が 'on' のときだけ。既定は 'ask' で、
 * 訊く前に通信しない(要件 §9 の「黙って失敗する」と同じ考え方)。
 */
import type { UpdateStatus } from '@shared/ipc'
import {
  CHECK_INTERVAL_MS,
  RELEASES_URL,
  UPDATE_FEED_URL,
  isNewer,
  versionFromFeed
} from '@shared/update'
import type { SettingsRepository } from '../repositories/SettingsRepository'

const LAST_CHECKED_KEY = 'update.lastCheckedAt'
const LATEST_VERSION_KEY = 'update.latestVersion'

/** latest.yml は 1KB 程度。桁違いに大きいものを読み込まない。 */
export const MAX_FEED_BYTES = 64 * 1024

export type FetchText = (url: string) => Promise<string>

export class UpdateService {
  constructor(
    private readonly currentVersion: string,
    private readonly settings: SettingsRepository,
    private readonly fetchText: FetchText,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * @param enabled 設定が 'on' か。'ask' のまま、または 'off' なら何もしない。
   * @param force 間隔を無視して取り直す(設定画面からの手動確認用)。
   */
  async check(enabled: boolean, force = false): Promise<UpdateStatus> {
    if (!enabled) return { state: 'disabled' }

    const stored = this.settings.getAll()
    const lastChecked = typeof stored[LAST_CHECKED_KEY] === 'number' ? stored[LAST_CHECKED_KEY] : 0
    const remembered =
      typeof stored[LATEST_VERSION_KEY] === 'string' ? stored[LATEST_VERSION_KEY] : null

    // 間が空いていなければ覚えている結果で答える。起動のたびに問い合わせない。
    if (!force && remembered && this.now() - lastChecked < CHECK_INTERVAL_MS) {
      return this.statusFor(remembered)
    }

    let text: string
    try {
      text = await this.fetchText(UPDATE_FEED_URL)
    } catch {
      // 圏外・DNS 不達・GitHub 側の不調。更新確認は本筋ではないので黙って諦める。
      return { state: 'unavailable' }
    }

    const version = versionFromFeed(text)
    if (!version) return { state: 'unavailable' }

    this.settings.setMany({
      [LAST_CHECKED_KEY]: this.now(),
      [LATEST_VERSION_KEY]: version
    })
    return this.statusFor(version)
  }

  private statusFor(version: string): UpdateStatus {
    return isNewer(version, this.currentVersion)
      ? { state: 'available', version, url: RELEASES_URL }
      : { state: 'current', version }
  }
}

/** net.fetch を、大きさと時間で縛ったテキスト取得にする。 */
export function textFetcher(
  fetchImpl: (url: string, init: { signal: AbortSignal }) => Promise<Response>,
  timeoutMs = 10_000
): FetchText {
  return async (url) => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`更新情報を取得できませんでした (${response.status})`)
    const text = await response.text()
    if (text.length > MAX_FEED_BYTES) throw new Error('更新情報が大きすぎます')
    return text
  }
}
