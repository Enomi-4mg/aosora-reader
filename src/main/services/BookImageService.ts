/**
 * ZIP 同梱画像(挿絵)の保存。
 *
 * SQLite には入れない。実測で1作品あたり中央値 157KB・最大 34MB、画像1枚でも
 * 最大 4.2MB あり、blocks_json と同じ DB に抱えると本を開くたびに重くなる。
 * CustomFontService と同じく userData 配下のディレクトリに置き、
 * renderer へは aozora-img:// プロトコル経由で渡す。
 *
 * bookId は原本ハッシュ由来なので、同じ本を取り込み直しても保存先は変わらない。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'

export interface ImageEntry {
  name: string
  bytes: Uint8Array
}

/**
 * 保存を許すファイル名。
 *
 * 青空文庫 ZIP のファイル名は Shift_JIS のことがあり、名前は文字化けしうる。
 * 実測した 5,035 枚はすべて `fig<作品ID>_<連番>.png` という ASCII なので、
 * ここを厳しくしても取りこぼさない。化けた名前は保存せず捨てる。
 */
const SAFE_NAME = /^[A-Za-z0-9._-]+\.(?:png|jpe?g|gif)$/i

/** bookIdFromHash が返す形。これ以外は URL のホストとして受け付けない。 */
const SAFE_BOOK_ID = /^[0-9a-f]{16}$/

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif'
}

export class BookImageService {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true })
  }

  /**
   * 1冊分の画像を保存する。保存できた枚数を返す。
   *
   * 画像が1枚も保存できなくても取り込みは止めない(要件 §9)。
   */
  save(bookId: string, entries: ImageEntry[]): number {
    if (!SAFE_BOOK_ID.test(bookId) || entries.length === 0) return 0
    const dir = join(this.directory, bookId)
    mkdirSync(dir, { recursive: true })

    let saved = 0
    for (const entry of entries) {
      // ZIP 内のパスは信用しない。basename へ寄せてから名前を検査する。
      const name = basename(entry.name)
      if (!SAFE_NAME.test(name)) continue
      try {
        writeFileSync(join(dir, name), entry.bytes)
        saved++
      } catch {
        // 1枚書けなくても残りは保存する
      }
    }
    return saved
  }

  /** この本の画像を1枚でも持っているか。取り込み直しの判定に使う。 */
  has(bookId: string): boolean {
    if (!SAFE_BOOK_ID.test(bookId)) return false
    const dir = join(this.directory, bookId)
    try {
      return existsSync(dir) && readdirSync(dir).some((n) => SAFE_NAME.test(n))
    } catch {
      return false
    }
  }

  /**
   * aozora-img:// の解決。読めなければ null。
   *
   * ホスト名とファイル名を検査したうえで、解決後のパスが画像ルート配下に
   * あることも確認する。名前の検査だけに頼ると、将来の仕様変更で
   * ディレクトリ外へ出られる余地を残す。
   */
  read(bookId: string, fileName: string): { bytes: Uint8Array<ArrayBuffer>; mime: string } | null {
    if (!SAFE_BOOK_ID.test(bookId) || !SAFE_NAME.test(fileName)) return null
    const root = resolve(this.directory)
    const file = resolve(join(root, bookId, fileName))
    if (!file.startsWith(root + sep)) return null
    try {
      const bytes = new Uint8Array(readFileSync(file))
      const ext = fileName.split('.').pop()!.toLowerCase()
      return { bytes, mime: MIME[ext] ?? 'application/octet-stream' }
    } catch {
      return null
    }
  }

  /** 本を消すときに画像も消す。本文も同時に消えるので、残しても復元には使えない。 */
  remove(bookId: string): void {
    if (!SAFE_BOOK_ID.test(bookId)) return
    try {
      rmSync(join(this.directory, bookId), { recursive: true, force: true })
    } catch {
      // 消せなくても削除操作そのものは成功させる
    }
  }
}
