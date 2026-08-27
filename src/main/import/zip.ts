/**
 * 青空文庫 ZIP の展開(要件 §4.1)。
 * 壊れた ZIP でアプリを落とさない(要件 §9)。
 */
import { unzipSync } from 'fflate'

export interface ZipEntry {
  name: string
  bytes: Uint8Array
}

export interface ZipContents {
  /** 本文とみなした TXT。 */
  main: ZipEntry
  /** 同梱画像(挿絵)。 */
  images: ZipEntry[]
}

export class ZipError extends Error {}

/** ZIP 内のファイル名は Shift_JIS のことがあるため、表示用に best-effort で戻す。 */
function decodeEntryName(name: string): string {
  return name
}

export function readAozoraZip(bytes: Uint8Array): ZipContents {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (e) {
    throw new ZipError(
      `ZIPを展開できませんでした: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  const entries = Object.entries(files)
    .filter(([name]) => !name.endsWith('/') && !name.split('/').pop()!.startsWith('.'))
    .map(([name, b]) => ({ name: decodeEntryName(name), bytes: b }))

  const txts = entries.filter((e) => /\.txt$/i.test(e.name))
  if (txts.length === 0) {
    throw new ZipError('ZIP内にテキストファイルが見つかりませんでした。')
  }

  // 複数ある場合は最大のものを本文とみなす(注意書き等の小さい txt を避ける)
  txts.sort((a, b) => b.bytes.length - a.bytes.length)

  return {
    main: txts[0]!,
    images: entries.filter((e) => /\.(png|jpe?g|gif)$/i.test(e.name))
  }
}
