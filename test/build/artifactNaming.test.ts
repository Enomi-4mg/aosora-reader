/**
 * 配布設定のうち、自動更新の成否に直結する部分を固定する。
 *
 * electron-updater の MacUpdater は findFile(files, "zip", ["pkg", "dmg"]) で
 * 更新ファイルを選ぶ。その中身は(6.8.11 時点で)こうなっている。
 *
 *   filteredFiles.find(it => [it.url.pathname, it.info.url]
 *     .some(n => n.includes(process.arch))) ?? filteredFiles.shift()
 *
 * つまり「ファイル名に arm64 / x64 が入っていること」だけが頼りで、
 * 入っていなければ一致が無く、先頭のファイルへ落ちる。並び順は保証されないので、
 * Apple Silicon 機に Intel 版が降ってくることになる。Rosetta で動いてしまうぶん
 * 気づきにくい。artifactName から ${arch} を外さないこと。
 *
 * YAML パーサーを足さずに本文で確かめている。見ているのは数行で、
 * 構文解析しても分かることは増えない。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const config = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8')

describe('配布設定', () => {
  it('配布物の名前にアーキテクチャが入る', () => {
    const line = /^artifactName:.*$/m.exec(config)?.[0] ?? ''
    expect(line).toContain('${arch}')
  })

  it('mac は dmg と zip の両方を出す', () => {
    // dmg は人が落とすもの。zip が無いと Squirrel.Mac が更新を受け取れない。
    expect(config).toMatch(/- target: dmg/)
    expect(config).toMatch(/- target: zip/)
  })

  it('mac は arm64 と x64 の両方を作る', () => {
    const mac = config.slice(config.indexOf('mac:'), config.indexOf('win:'))
    expect(mac).toContain('arm64')
    expect(mac).toContain('x64')
  })

  it('arm64 と x64 は互いの名前に含まれない', () => {
    // findFile は単純な部分一致なので、取り違えないことを明示しておく。
    expect('arm64'.includes('x64')).toBe(false)
    expect('x64'.includes('arm64')).toBe(false)
  })
})
