/**
 * 更新があるかどうかの判断。
 *
 * ここでは取ってこない。版の比較と latest.yml の読み取りだけを持つので、
 * ネットワークにもデータベースにも触れずに試験できる。
 * 実際に取ってくるのは main の UpdateService。
 */

/**
 * 更新情報の置き場。electron-builder が配布物と一緒に書き出す latest.yml を、
 * GitHub の「最新リリース」経由で読む。
 *
 * API(/repos/.../releases/latest)ではなくこの経路を使うのは、未認証だと
 * 1時間 60 回という制限があり、同じ出口 IP のユーザー全員で食い合うため。
 * こちらはただのファイル取得なので制限にかからない。
 *
 * 下書きのリリースは対象外になる。公開して初めて更新として見えるので、
 * 配布前に誤って通知が出ることもない。
 */
export const UPDATE_FEED_URL =
  'https://github.com/Enomi-4mg/aosora-reader/releases/latest/download/latest.yml'

/** 更新が見つかったときに開くページ。 */
export const RELEASES_URL = 'https://github.com/Enomi-4mg/aosora-reader/releases/latest'

/** 確認の間隔。起動のたびに問い合わせない。 */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface SemVer {
  major: number
  minor: number
  patch: number
  /** 0.2.0-beta.1 の "beta.1"。無ければ null。 */
  prerelease: string | null
}

export function parseVersion(raw: string): SemVer | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(raw.trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null
  }
}

/**
 * 配布されている版が、動いている版より新しいか。
 *
 * どちらかが読めないときは false。「読めなかった」を「新しい」に倒すと、
 * 壊れた応答や差し替えられた応答で更新を促し続けることになる。
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false

  if (a.major !== b.major) return a.major > b.major
  if (a.minor !== b.minor) return a.minor > b.minor
  if (a.patch !== b.patch) return a.patch > b.patch

  // 同じ番号なら、先行版より正式版のほうが新しい。
  if (a.prerelease === b.prerelease) return false
  if (a.prerelease === null) return true
  if (b.prerelease === null) return false
  return a.prerelease > b.prerelease
}

/**
 * latest.yml から version だけ取り出す。
 *
 * YAML を一般に解釈する必要はない。electron-builder が機械的に書く決まった形で、
 * version はトップレベルに1行だけ現れる。この1行のために依存を足さない。
 * 字下げされた行は ^ に当たらないので、files 配下の値を拾うこともない。
 */
export function versionFromFeed(text: string): string | null {
  const m = /^version:[ \t]*["']?([0-9][0-9A-Za-z.+-]*)["']?[ \t]*$/m.exec(text)
  const version = m?.[1]
  if (!version) return null
  return parseVersion(version) ? version : null
}
