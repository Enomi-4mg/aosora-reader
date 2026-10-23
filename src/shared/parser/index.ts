/**
 * 青空文庫 TXT → Document Model。
 *
 * この層より下(Renderer / UI)に青空文庫固有の表記を漏らさない(要件 §20-3, §20-4)。
 * どんな入力でも例外を投げず、問題は ParseIssue として集める(要件 §20-8)。
 */
import type {
  Block,
  BlockType,
  BookMetadata,
  Chapter,
  InlineNode
} from '../model/document'
import type { Decoration } from './annotation'
import { IssueCollector, type ParseIssue } from './errors'
import { parseInline } from './inline'

export interface ParseResult {
  title: string
  subtitle: string | null
  author: string | null
  translator: string | null
  metadata: BookMetadata
  chapters: Chapter[]
  totalCharacters: number
  issues: ParseIssue[]
}

/** 凡例ブロックを囲む罫線(半角ハイフンの並び)。 */
const RULE = /^-{20,}\s*$/

/**
 * 奥付の開始行。区切り記号まで含めて一致させる。
 *
 * 「底本」だけを見ると本文中で底本について論じている行に当たってしまう。
 * また区切り記号を要求することで、奥付の内側にある「底本の親本：」とも区別できる。
 */
const COLOPHON = /^底本[：:]/

export function parseAozora(source: string): ParseResult {
  const issues = new IssueCollector()
  const text = source.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
  const lines = text.split('\n')

  // 元 TXT へのオフセットを行ごとに保持する(診断用)
  const lineOffsets: number[] = []
  {
    let off = 0
    for (const l of lines) {
      lineOffsets.push(off)
      off += l.length + 1
    }
  }

  let ptr = 0

  // --- ヘッダ(タイトル / 副題 / 著者 / 翻訳者) ---
  const headerLines: string[] = []
  while (ptr < lines.length && lines[ptr]!.trim() !== '') {
    headerLines.push(lines[ptr]!.trim())
    ptr++
  }
  const header = parseHeader(headerLines, issues)

  // --- 凡例ブロック ---
  const metadata: BookMetadata = {}
  let scan = ptr
  while (scan < lines.length && lines[scan]!.trim() === '') scan++
  if (scan < lines.length && RULE.test(lines[scan]!)) {
    const close = findIndexFrom(lines, scan + 1, (l) => RULE.test(l))
    if (close !== -1) {
      metadata.legend = lines.slice(scan + 1, close).join('\n').trim()
      ptr = close + 1
    }
  }

  // --- 底本(奥付) ---
  // 奥付はファイル末尾にあるので末尾から探す。先頭から探すと、本文中に
  // 「底本：」で始まる行があったときにそこから後ろの本文をすべて失う。
  let bodyEnd = lines.length
  const colophonAt = findLastIndexFrom(lines, ptr, (l) => COLOPHON.test(l.trim()))
  if (colophonAt !== -1) {
    bodyEnd = colophonAt
    metadata.bibliography = lines.slice(colophonAt).join('\n').trim()
  }

  const chapters = buildChapters(
    lines.slice(ptr, bodyEnd),
    lineOffsets.slice(ptr, bodyEnd),
    header.title,
    issues
  )

  const totalCharacters = chapters.reduce((n, c) => n + c.characterCount, 0)
  issues.report(header.title)

  return {
    ...header,
    metadata,
    chapters,
    totalCharacters,
    issues: issues.issues
  }
}

function findIndexFrom(
  lines: string[],
  from: number,
  pred: (l: string) => boolean
): number {
  for (let i = from; i < lines.length; i++) {
    if (pred(lines[i]!)) return i
  }
  return -1
}

/** from 以降で条件を満たす最後の行。奥付のように末尾側にあるものを探すのに使う。 */
function findLastIndexFrom(
  lines: string[],
  from: number,
  pred: (l: string) => boolean
): number {
  for (let i = lines.length - 1; i >= from; i--) {
    if (pred(lines[i]!)) return i
  }
  return -1
}

interface Header {
  title: string
  subtitle: string | null
  author: string | null
  translator: string | null
}

function parseHeader(lines: string[], issues: IssueCollector): Header {
  // ヘッダにもルビが振られていることがあるので plainText 化して取り出す
  const plain = lines.map((l) => parseInline(l, 0, issues, []).plainText.trim())
  const title = plain[0] ?? '無題'
  const rest = plain.slice(1).filter((l) => l !== '')

  let translator: string | null = null
  if (rest.length >= 2 && /訳$|訳者|翻訳/.test(rest[rest.length - 1]!)) {
    translator = rest.pop()!
  }
  const author = rest.length > 0 ? rest.pop()! : null
  const subtitle = rest.length > 0 ? rest.join(' ') : null

  return { title, subtitle, author, translator }
}

// --- 本文 → 章 / ブロック ---

interface BlockDraft {
  type: BlockType
  children: InlineNode[]
  plainText: string
  indentLevel: number
  headingLevel?: 1 | 2 | 3
  image?: { src: string; alt: string; caption?: string; width?: number; height?: number }
  sourceStart: number
  sourceEnd: number
}

function buildChapters(
  lines: string[],
  offsets: number[],
  bookTitle: string,
  issues: IssueCollector
): Chapter[] {
  const drafts: BlockDraft[] = []

  const indentStack: number[] = []
  let openDecorations: Decoration[] = []
  let headingMode: 1 | 2 | 3 | null = null
  let pendingIndent: number | null = null

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li]!
    const srcOff = offsets[li] ?? 0
    const parsed = parseInline(raw, srcOff, issues, openDecorations)
    const { plainText, children, directives } = parsed
    // ［＃ここから傍点］系は行をまたいで続くので、行末の開閉状態を引き継ぐ
    openDecorations = parsed.openDecorations

    // 行から得たブロック指示を先に処理する
    let pageBreak = false
    let rule = false
    let image: BlockDraft['image']
    let headingForThisLine: 1 | 2 | 3 | null = null
    let headingEnds = false
    let isCaption = false

    for (const d of directives) {
      switch (d.annotation.type) {
        case 'page-break':
          pageBreak = true
          break
        case 'horizontal-rule':
          rule = true
          break
        case 'image':
          image = {
            src: d.annotation.src,
            alt: d.annotation.alt,
            ...(d.annotation.caption !== undefined ? { caption: d.annotation.caption } : {}),
            ...(d.annotation.width !== undefined ? { width: d.annotation.width } : {}),
            ...(d.annotation.height !== undefined ? { height: d.annotation.height } : {})
          }
          break
        case 'caption':
          isCaption = true
          break
        case 'indent':
          pendingIndent = d.annotation.level
          break
        case 'indent-start':
          indentStack.push(d.annotation.level)
          break
        case 'indent-end':
          if (indentStack.length > 0) indentStack.pop()
          else issues.add('unclosed-span', '対応する字下げ開始が無い', srcOff, raw)
          break
        case 'heading-target':
          headingForThisLine = d.annotation.level
          break
        case 'heading-start':
          headingMode = d.annotation.level
          headingForThisLine = d.annotation.level
          break
        case 'heading-end':
          headingEnds = true
          break
        default:
          break
      }
    }

    const indentLevel =
      pendingIndent ?? (indentStack.length > 0 ? indentStack[indentStack.length - 1]! : 0)
    pendingIndent = null

    const sourceEnd = srcOff + raw.length

    if (pageBreak && plainText === '') {
      drafts.push(emptyDraft('pageBreak', srcOff, sourceEnd))
      continue
    }
    if (rule && plainText === '') {
      drafts.push(emptyDraft('horizontalRule', srcOff, sourceEnd))
      continue
    }
    if (image && plainText === '') {
      drafts.push({
        type: 'image',
        children: [],
        plainText: '',
        indentLevel: 0,
        image,
        sourceStart: srcOff,
        sourceEnd
      })
      continue
    }

    const level = headingForThisLine ?? (headingMode !== null && plainText !== '' ? headingMode : null)
    if (headingEnds) headingMode = null

    if (plainText === '' && children.length === 0) {
      // 本当の空行だけを空段落として残す(空行は場面転換の意味を持つ)。
      // 注記だけの行は本文に痕跡を残さない。
      if (raw.trim() === '') drafts.push(emptyDraft('paragraph', srcOff, sourceEnd))
      continue
    }

    // キャプションは本文として plainText に含まれる。型だけを変えて
    // 図に寄せて組む。ここで本文から外すと座標がずれる(不変条件 A)。
    const type = level !== null ? 'heading' : isCaption ? 'caption' : 'paragraph'
    drafts.push({
      type,
      children,
      plainText,
      indentLevel,
      ...(level !== null ? { headingLevel: level } : {}),
      sourceStart: srcOff,
      sourceEnd
    })
  }

  return groupIntoChapters(drafts, bookTitle)
}

function emptyDraft(type: BlockType, s: number, e: number): BlockDraft {
  return {
    type,
    children: [],
    plainText: '',
    indentLevel: 0,
    sourceStart: s,
    sourceEnd: e
  }
}

function groupIntoChapters(drafts: BlockDraft[], bookTitle: string): Chapter[] {
  const chapters: Chapter[] = []
  let current: Chapter | null = null
  let bookChars = 0

  const startChapter = (title: string, level: number): Chapter => {
    const c: Chapter = {
      id: `c${chapters.length}`,
      title,
      level,
      order: chapters.length,
      charStart: bookChars,
      characterCount: 0,
      blocks: []
    }
    chapters.push(c)
    return c
  }

  for (const d of drafts) {
    if (d.type === 'heading') {
      // 直前の章が空(前書きすら無い)なら章を作り直さない
      if (current && current.blocks.every((b) => b.plainText === '')) {
        current.title = d.plainText
        current.level = d.headingLevel ?? 1
      } else {
        current = startChapter(d.plainText, d.headingLevel ?? 1)
      }
    }
    if (!current) current = startChapter(bookTitle, 0)

    const block: Block = {
      id: `${current.id}_b${current.blocks.length}`,
      type: d.type,
      children: d.children,
      plainText: d.plainText,
      indentLevel: d.indentLevel,
      ...(d.headingLevel !== undefined ? { headingLevel: d.headingLevel } : {}),
      ...(d.image !== undefined ? { image: d.image } : {}),
      charStart: current.characterCount,
      sourceStart: d.sourceStart,
      sourceEnd: d.sourceEnd
    }
    current.blocks.push(block)
    current.characterCount += d.plainText.length
    bookChars += d.plainText.length
  }

  // 章が1つも無い(=本文が空)場合でも Reader が壊れないよう最低1章は返す
  if (chapters.length === 0) startChapter(bookTitle, 0)
  return chapters
}

export { type ParseIssue } from './errors'
