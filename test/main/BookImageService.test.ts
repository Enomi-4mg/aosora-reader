import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { BookImageService } from '../../src/main/services/BookImageService'

const BOOK = '0123456789abcdef'

let dir: string
let images: BookImageService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aozora-images-'))
  images = new BookImageService(dir)
})

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('BookImageService', () => {
  it('同梱画像を bookId ごとのディレクトリに保存する', () => {
    const saved = images.save(BOOK, [
      { name: 'fig46817_01.png', bytes: bytes('one') },
      { name: 'fig46817_02.png', bytes: bytes('two') }
    ])
    expect(saved).toBe(2)
    expect(readFileSync(join(dir, BOOK, 'fig46817_01.png'), 'utf8')).toBe('one')
    expect(images.has(BOOK)).toBe(true)
  })

  /** ZIP 内のパスは信用しない。実測で3作品がサブディレクトリに画像を置いている。 */
  it('ZIP 内のサブディレクトリは basename に寄せる', () => {
    expect(images.save(BOOK, [
      { name: '50686_ruby_42715/fig50686_01.png', bytes: bytes('x') }
    ])).toBe(1)
    expect(existsSync(join(dir, BOOK, 'fig50686_01.png'))).toBe(true)
  })

  /**
   * パスの要素は basename で落とすので、../ は「拒否」ではなく「無害化」される。
   * 確かめるべきは本の保存先から出ないこと。
   */
  it('ディレクトリを抜ける名前を本の保存先に閉じ込める', () => {
    images.save(BOOK, [
      { name: '../../escaped.png', bytes: bytes('x') },
      { name: '/tmp/absolute.png', bytes: bytes('x') }
    ])
    expect(existsSync(join(dir, 'escaped.png'))).toBe(false)
    expect(existsSync(join(dir, '..', 'escaped.png'))).toBe(false)
    expect(existsSync(join(dir, BOOK, 'escaped.png'))).toBe(true)
    expect(existsSync(join(dir, BOOK, 'absolute.png'))).toBe(true)
  })

  it('エンコードされた区切りを含む名前を保存しない', () => {
    expect(images.save(BOOK, [
      { name: '..%2Fescaped.png', bytes: bytes('x') },
      { name: 'fig 01.png', bytes: bytes('x') }
    ])).toBe(0)
  })

  /** 青空文庫 ZIP のファイル名は Shift_JIS で化けうる。化けたものは捨てる。 */
  it('画像以外と文字化けした名前を保存しない', () => {
    expect(images.save(BOOK, [
      { name: 'notes.txt', bytes: bytes('x') },
      { name: '\u0095½\u0096¼.png', bytes: bytes('x') },
      { name: 'fig_01.png', bytes: bytes('ok') }
    ])).toBe(1)
    expect(images.has(BOOK)).toBe(true)
  })

  it('bookId の形が違えば何もしない', () => {
    expect(images.save('../etc', [{ name: 'a.png', bytes: bytes('x') }])).toBe(0)
    expect(images.save('ZZZZ', [{ name: 'a.png', bytes: bytes('x') }])).toBe(0)
    expect(images.has('../etc')).toBe(false)
  })

  it('保存した画像を MIME 付きで読み出す', () => {
    images.save(BOOK, [{ name: 'fig_01.png', bytes: bytes('png-bytes') }])
    const found = images.read(BOOK, 'fig_01.png')
    expect(found?.mime).toBe('image/png')
    expect(new TextDecoder().decode(found!.bytes)).toBe('png-bytes')
  })

  it('読み出しでもディレクトリを抜けさせない', () => {
    // 画像ルートの外に実在するファイルを置いて、到達できないことを確かめる
    writeFileSync(join(dir, '..', 'outside.png'), 'secret')
    expect(images.read(BOOK, '../outside.png')).toBeNull()
    expect(images.read(BOOK, '..%2Foutside.png')).toBeNull()
    expect(images.read(BOOK, 'missing.png')).toBeNull()
  })

  it('本を消すと画像も消える', () => {
    images.save(BOOK, [{ name: 'fig_01.png', bytes: bytes('x') }])
    images.remove(BOOK)
    expect(images.has(BOOK)).toBe(false)
    expect(existsSync(join(dir, BOOK))).toBe(false)
  })

  it('画像を持たない本では has が false', () => {
    mkdirSync(join(dir, BOOK), { recursive: true })
    writeFileSync(join(dir, BOOK, 'stray.txt'), 'x')
    expect(images.has(BOOK)).toBe(false)
  })
})
