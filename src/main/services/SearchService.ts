/**
 * 本文検索(要件 §4.12 / §7)。
 *
 * Phase 1 は blocks テーブルへの LIKE 検索。小規模ライブラリなら十分速い。
 * `blocks.plain_text` をそのまま FTS5(tokenize='trigram') に載せ替えれば
 * この層の外側を変えずに全文検索へ移行できる(M0 で trigram 対応を実測済み)。
 * `searchLibrary` を後から足せるようシグネチャを将来形にしてある。
 */
import type { TextPosition, TextRange } from '@shared/model/position'
import type { Db } from '../db/connection'

export interface SearchMatch {
  position: TextPosition
  range: TextRange
  /** 前後の文脈を含む抜粋。 */
  context: string
  /** context 内での一致開始位置。UI の強調表示に使う。 */
  contextOffset: number
  chapterId: string
}

export interface SearchResult {
  query: string
  /** matches の件数。truncated が true のときは実際の一致数より少ない。 */
  count: number
  /** 上限に達して打ち切ったか。 */
  truncated: boolean
  matches: SearchMatch[]
}

const CONTEXT_BEFORE = 20
const CONTEXT_AFTER = 40
const MAX_MATCHES = 5000

export class SearchService {
  constructor(private readonly db: Db) {}

  searchBook(bookId: string, query: string): SearchResult {
    const q = query.trim()
    if (q === '') return { query, count: 0, truncated: false, matches: [] }

    // 英数字は大文字小文字を無視する(要件 §4.12)。
    // SQLite の LIKE は既定で ASCII のみ大文字小文字を無視するので要件と一致する。
    const rows = this.db
      .prepare(
        `SELECT chapter_id, id, plain_text, ord
         FROM blocks
         WHERE book_id = ? AND plain_text LIKE ? ESCAPE '\\'
         ORDER BY ord`
      )
      .all(bookId, `%${escapeLike(q)}%`) as unknown as Array<{
      chapter_id: string
      id: string
      plain_text: string
      ord: number
    }>

    const matches: SearchMatch[] = []
    // 要件は ASCII の大小文字だけを無視すること。
    // String#toLowerCase は一部の Unicode 文字で長さが変わるため、検索結果の
    // UTF-16 オフセットが本文上の位置からずれる。ASCII だけを長さ不変で畳み込む。
    const needle = foldAsciiCase(q)

    for (const row of rows) {
      const hay = foldAsciiCase(row.plain_text)
      let from = 0
      while (matches.length < MAX_MATCHES) {
        const idx = hay.indexOf(needle, from)
        if (idx === -1) break
        const start: TextPosition = {
          bookId,
          chapterId: row.chapter_id,
          blockId: row.id,
          offset: idx
        }
        const end: TextPosition = { ...start, offset: idx + q.length }
        const ctxStart = Math.max(0, idx - CONTEXT_BEFORE)
        matches.push({
          position: start,
          range: { start, end },
          context: row.plain_text.slice(ctxStart, idx + q.length + CONTEXT_AFTER),
          contextOffset: idx - ctxStart,
          chapterId: row.chapter_id
        })
        from = idx + Math.max(1, needle.length)
      }
      if (matches.length >= MAX_MATCHES) break
    }

    return {
      query,
      count: matches.length,
      truncated: matches.length >= MAX_MATCHES,
      matches
    }
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function foldAsciiCase(s: string): string {
  return s.replace(/[A-Z]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + ('a'.charCodeAt(0) - 'A'.charCodeAt(0)))
  )
}
