/**
 * ZIP 同梱の挿絵が取り込みで保存されるところまで、実際の ZIP バイト列で確かめる。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../../src/main/db/connection'
import { BookRepository } from '../../src/main/repositories/BookRepository'
import { BookImageService } from '../../src/main/services/BookImageService'
import { ImportService } from '../../src/main/services/ImportService'

const SOURCE = [
  'あのときの王子くん',
  'サン＝テグジュペリ',
  '大久保ゆう訳',
  '',
  '-------------------------------------------------------',
  '【テキスト中に現れる記号について】',
  '［＃］：入力者注',
  '（例）［＃「〈例〉」のキャプション付きの挿絵（fig1_01.png、横10×縦20）入る］',
  '-------------------------------------------------------',
  '',
  '［＃「〈星から出るのに〉」のキャプション付きの挿絵（fig1_01.png、横1238×縦785）入る］',
  '〈星から出るのに〉［＃「〈星から出るのに〉」はキャプション］',
  '',
  '　ぼくが６つのとき、よんだ本にすばらしい絵があった。',
  '［＃挿絵（fig1_02.png、横479×縦252）入る］',
  '　おとなのひとは、ボアの絵なんてどうでもいいという。',
  '',
  '底本：「あのときの王子くん」'
].join('\n')

/** 本文1つと PNG 2枚を同梱した ZIP。本文は UTF-8 で入れる。 */
function makeZip(): Uint8Array {
  return zipSync({
    'anotokino_ojikun.txt': new TextEncoder().encode(SOURCE),
    'fig1_01.png': new TextEncoder().encode('first-image'),
    'fig1_02.png': new TextEncoder().encode('second-image')
  })
}

let db: Db
let books: BookRepository
let images: BookImageService
let importer: ImportService
let dir: string

beforeEach(() => {
  db = openDatabase(':memory:')
  books = new BookRepository(db)
  dir = mkdtempSync(join(tmpdir(), 'aozora-import-'))
  images = new BookImageService(dir)
  importer = new ImportService(books, images)
})

describe('ImportService と挿絵', () => {
  it('ZIP の挿絵を保存し、本文は画像ブロックとして取り込む', async () => {
    const outcome = await importer.importBytes(makeZip(), '/tmp/work.zip', '無題')
    expect(outcome.status).toBe('imported')
    if (outcome.status !== 'imported') return

    expect(images.has(outcome.bookId)).toBe(true)
    const found = images.read(outcome.bookId, 'fig1_01.png')
    expect(new TextDecoder().decode(found!.bytes)).toBe('first-image')

    const book = books.load(outcome.bookId)!
    const blocks = book.chapters.flatMap((c) => c.blocks)
    const figures = blocks.filter((b) => b.type === 'image')
    // 凡例の（例）を本文の挿絵と数えてはいけない
    expect(figures.map((b) => b.image!.src)).toEqual(['fig1_01.png', 'fig1_02.png'])
    expect(figures[0]!.image).toMatchObject({
      alt: '〈星から出るのに〉',
      caption: '〈星から出るのに〉',
      width: 1238,
      height: 785
    })

    const caption = blocks.find((b) => b.type === 'caption')!
    expect(caption.plainText).toBe('〈星から出るのに〉')
  })

  /**
   * 挿絵対応より前に取り込んだ本を入れ直す経路。
   * 重複と判定されて本文は作り直されないが、画像は揃っていてほしい。
   */
  it('重複と判定される再取り込みでも、画像が無ければ保存する', async () => {
    const zip = makeZip()
    const first = await importer.importBytes(zip, '/tmp/work.zip', '無題')
    expect(first.status).toBe('imported')
    if (first.status !== 'imported') return

    images.remove(first.bookId)
    expect(images.has(first.bookId)).toBe(false)

    const again = await importer.importBytes(zip, '/tmp/work.zip', '無題')
    expect(again.status).toBe('duplicate')
    expect(images.has(first.bookId)).toBe(true)
  })

  it('画像サービスを渡さなくても取り込みは成立する', async () => {
    const plain = new ImportService(books)
    const outcome = await plain.importBytes(makeZip(), '/tmp/work.zip', '無題')
    expect(outcome.status).toBe('imported')
  })
})
