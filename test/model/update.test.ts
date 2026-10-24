import { describe, expect, it } from 'vitest'
import { isNewer, parseVersion, versionFromFeed } from '@shared/update'

/** v0.1.0 のリリースで実際に配られている latest.yml。 */
const REAL_FEED = `version: 0.1.0
files:
  - url: aosora-reader-0.1.0-x64.exe
    sha512: kSe7eS7zbYU/xGcXfJQ4BPx7wSJOd74/VyfEOAmB2Zair075k1VriMvw27DH8+Zjg8y4GH6J2ne4tss3brsmpA==
    size: 111087301
path: aosora-reader-0.1.0-x64.exe
sha512: kSe7eS7zbYU/xGcXfJQ4BPx7wSJOd74/VyfEOAmB2Zair075k1VriMvw27DH8+Zjg8y4GH6J2ne4tss3brsmpA==
releaseDate: '2026-10-24T18:39:32.968Z'
`

describe('parseVersion', () => {
  it('通常の版を読む', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null })
  })

  it('先行版の識別子を保つ', () => {
    expect(parseVersion('0.2.0-beta.1')?.prerelease).toBe('beta.1')
  })

  it('版でないものは null', () => {
    for (const bad of ['', 'v1.2.3', '1.2', '1.2.3.4', 'latest', '../etc', '1.2.x']) {
      expect(parseVersion(bad)).toBeNull()
    }
  })
})

describe('isNewer', () => {
  it('番号を上から順に比べる', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('1.0.0', '0.9.9')).toBe(true)
    expect(isNewer('0.1.1', '0.1.0')).toBe(true)
    expect(isNewer('0.1.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
  })

  it('桁ではなく数として比べる', () => {
    // 文字列比較だと "0.9.0" > "0.10.0" になってしまう。
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('0.9.0', '0.10.0')).toBe(false)
  })

  it('同じ番号なら正式版が先行版より新しい', () => {
    expect(isNewer('0.2.0', '0.2.0-beta.1')).toBe(true)
    expect(isNewer('0.2.0-beta.1', '0.2.0')).toBe(false)
    expect(isNewer('0.2.0-beta.2', '0.2.0-beta.1')).toBe(true)
  })

  it('読めない版で「新しい」とは言わない', () => {
    // 壊れた応答や差し替えられた応答で、更新を促し続けないこと。
    expect(isNewer('latest', '0.1.0')).toBe(false)
    expect(isNewer('', '0.1.0')).toBe(false)
    expect(isNewer('0.2.0', 'unknown')).toBe(false)
  })
})

describe('versionFromFeed', () => {
  it('実際に配られている latest.yml から版を取る', () => {
    expect(versionFromFeed(REAL_FEED)).toBe('0.1.0')
  })

  it('字下げされた行の値は拾わない', () => {
    const feed = 'version: 1.0.0\nfiles:\n  - url: x\n    version: 9.9.9\n'
    expect(versionFromFeed(feed)).toBe('1.0.0')
  })

  it('引用符つきでも読む', () => {
    expect(versionFromFeed("version: '2.0.0'\n")).toBe('2.0.0')
    expect(versionFromFeed('version: "2.0.0"\n')).toBe('2.0.0')
  })

  it('版の行が無ければ null', () => {
    expect(versionFromFeed('files:\n  - url: x\n')).toBeNull()
    expect(versionFromFeed('')).toBeNull()
  })

  it('版の形でない値は通さない', () => {
    // HTML のエラーページや、別物を返されたときに拾わないこと。
    expect(versionFromFeed('version: latest\n')).toBeNull()
    expect(versionFromFeed('<html><body>404</body></html>')).toBeNull()
  })
})
