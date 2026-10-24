/**
 * 配布設定のうち、壊れると配布物そのものが壊れる部分を固定する。
 *
 * mac は arm64 と x64 の2つを作る。artifactName から ${arch} が消えると
 * 両方が同じファイル名になり、片方がもう片方を上書きする。
 * 配る側からは1つの dmg しか出てこないので、Intel 版が消えたことに気づきにくい。
 * 利用者から見ても、どちらを落とせばいいのか区別がつかなくなる。
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

  it('mac は arm64 と x64 の両方を作る', () => {
    const mac = config.slice(config.indexOf('mac:'), config.indexOf('win:'))
    expect(mac).toContain('arm64')
    expect(mac).toContain('x64')
  })

  it('配布物の名前は ASCII に収まる', () => {
    // productName は日本語だが、配布物の名前は ${name} から作る。
    // 日本語のままだと、配信の経路や展開ツールによっては文字化けする。
    const line = /^artifactName:.*$/m.exec(config)?.[0] ?? ''
    expect(line).not.toMatch(/[^\x20-\x7e]/)
    expect(line).toContain('${name}')
  })
})
