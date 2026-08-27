import { createHash } from 'node:crypto'

/** デコード後テキストの SHA-256。重複インポート判定の主キー(要件 §4.1)。 */
export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 決定的な book id。同じ原本なら再インポートしても同じ id になる。 */
export function bookIdFromHash(hash: string): string {
  return hash.slice(0, 16)
}
