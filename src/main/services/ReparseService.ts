/**
 * パーサーを更新したあと、取り込み済みの本を作り直す。
 *
 * パースは取り込み時の1回だけ、という原則(要件 §5.3)は変えていない。
 * 変えたのは「1回目をいつやり直すか」で、開くたびに解析するわけではない。
 * 本に記録したパーサー版が今の版と食い違うときだけ、一度だけ作り直す。
 *
 * 作り直すと plainText も blockId も変わりうるので、位置情報は必ず付け替える。
 * 付け替えずに本文だけ入れ替えると、栞も読書位置も静かに別の場所を指す。
 *
 * ハイライトも必ず通すこと。AnnotationRepository は selectedText で本文を
 * 探し直す仕組みを持っているが、それが走るのは blockId ごと消えたときだけで、
 * blockId が残ったまま offset だけずれた場合は素通りしてしまう。
 */
import type { Book } from '@shared/model/document'
import type { TextPosition } from '@shared/model/position'
import { PARSER_VERSION, parseAozora } from '@shared/parser'
import {
  buildBlockMap,
  indexBlocks,
  remapPosition,
  type BlockShape
} from '@shared/model/reparse'
import type { BookRepository } from '../repositories/BookRepository'
import type { AnnotationRepository } from '../repositories/AnnotationRepository'
import type { ProgressRepository } from '../repositories/ProgressRepository'

export type ReparseOutcome =
  /** 最新の版で取り込まれている。何もしていない。 */
  | { status: 'current' }
  /** 作り直した。 */
  | { status: 'updated'; movedPositions: number; droppedPositions: number }
  /** 作り直したいが原文が無い。取り込み直しが要る。 */
  | { status: 'unavailable' }

export class ReparseService {
  constructor(
    private readonly books: BookRepository,
    private readonly annotations: AnnotationRepository,
    private readonly progress: ProgressRepository
  ) {}

  /** この本が古い版で取り込まれていて、かつ作り直せないか。 */
  needsReimport(bookId: string): boolean {
    const state = this.books.parseState(bookId)
    return state !== null && state.version < PARSER_VERSION && state.sourceText === null
  }

  /**
   * 必要なら作り直す。呼び出しても安全(最新なら何もしない)。
   */
  run(bookId: string): ReparseOutcome {
    const state = this.books.parseState(bookId)
    if (!state || state.version >= PARSER_VERSION) return { status: 'current' }
    if (state.sourceText === null) return { status: 'unavailable' }

    const before = this.books.load(bookId)
    if (!before) return { status: 'current' }

    const parsed = parseAozora(state.sourceText)
    const after: Book = {
      ...before,
      title: parsed.title || before.title,
      subtitle: parsed.subtitle,
      author: parsed.author,
      translator: parsed.translator,
      // 取り込み元由来の metadata(図書カード URL や読み仮名)は本文から読めないので残す
      metadata: { ...parsed.metadata, ...pickSourceMetadata(before) },
      chapters: parsed.chapters,
      totalCharacters: parsed.totalCharacters,
      updatedAt: new Date().toISOString()
    }

    const oldBlocks = shapesOf(before)
    const newBlocks = shapesOf(after)
    const blockMap = buildBlockMap(oldBlocks, newBlocks)
    const oldIndex = indexBlocks(oldBlocks)

    // 本文を入れ替えてから位置を付け替える。付け替えられなかった位置は
    // そのまま残し、既存の orphan 表示に任せる。
    this.books.replaceContent(bookId, after)

    const remap = (p: TextPosition): TextPosition | null =>
      remapPosition(p, oldIndex, blockMap)?.position ?? null

    // 栞・メモ・ハイライトの位置をまとめて付け替える。
    const { moved, kept } = this.annotations.remapPositions(bookId, remap)

    // 読書位置も同じ付け替えに通す。放っておくと前に読んでいた場所から
    // ずれた所が開く。
    let dropped = kept
    let movedAll = moved
    const saved = this.progress.get(bookId)
    if (saved) {
      const to = remap(saved.position)
      if (!to) dropped++
      else if (
        to.blockId !== saved.position.blockId ||
        to.chapterId !== saved.position.chapterId ||
        to.offset !== saved.position.offset
      ) {
        this.progress.save({ ...saved, position: to })
        movedAll++
      }
    }

    return { status: 'updated', movedPositions: movedAll, droppedPositions: dropped }
  }
}

function shapesOf(book: Book): BlockShape[] {
  return book.chapters.flatMap((c) =>
    c.blocks.map((b) => ({
      id: b.id,
      chapterId: c.id,
      plainText: b.plainText,
      sourceStart: b.sourceStart,
      sourceEnd: b.sourceEnd
    }))
  )
}

/** 本文からは読み取れない、取り込み元由来の metadata だけを拾う。 */
function pickSourceMetadata(book: Book): Partial<Book['metadata']> {
  const { aozoraUrl, titleKana, authorKana } = book.metadata
  return {
    ...(aozoraUrl ? { aozoraUrl } : {}),
    ...(titleKana ? { titleKana } : {}),
    ...(authorKana ? { authorKana } : {})
  }
}
