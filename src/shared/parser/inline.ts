/**
 * 行内テキストのパース。ルビ・外字・注記を解釈して plainText と InlineNode[] を作る。
 *
 * 【不変条件 A】plainText には「読者が本文として目にする文字」だけを入れる。
 *  - ルビの読みは入れない
 *  - 注記そのもの(［＃...］)は入れない
 *  - 未対応注記はゼロ幅の note ノードとして残す
 */
import type {
  EmphasisNode,
  InlineNode,
  BoldNode,
  NoteNode,
  UnderlineNode,
  TcyNode
} from '../model/document'
import { classifyAnnotation, type Annotation, type Decoration } from './annotation'
import { makeGaijiNode, resolveGaiji } from './gaiji'
import type { IssueCollector } from './errors'

const ANNO_OPEN = '［＃'
const ANNO_CLOSE = '］'

interface Span {
  start: number
  end: number
  decoration: Decoration
}

/** 行の外側(ブロック組み立て側)が処理すべき注記。 */
export interface Directive {
  annotation: Annotation
  /** この注記が現れた時点の plainText オフセット。 */
  offset: number
}

export interface InlineParseResult {
  plainText: string
  children: InlineNode[]
  directives: Directive[]
  /** 行末時点で開いたままの装飾。呼び出し側が次の行にそのまま渡す。 */
  openDecorations: Decoration[]
}

// --- 文字クラス判定(ルビの親文字を遡って決めるのに使う) ---

const RE_KANJI = /[々〆〇ヶ一-鿿㐀-䶿豈-﫿]|[\u{20000}-\u{2ffff}]/u
const RE_HIRAGANA = /[ぁ-ゟ]/
const RE_KATAKANA = /[ァ-ヺー-ヾｦ-ﾝ]/
const RE_LATIN = /[A-Za-z0-9Ａ-Ｚａ-ｚ０-９]/

type CharClass = 'kanji' | 'hiragana' | 'katakana' | 'latin' | 'other'

function charClass(ch: string): CharClass {
  if (RE_KANJI.test(ch)) return 'kanji'
  if (RE_HIRAGANA.test(ch)) return 'hiragana'
  if (RE_KATAKANA.test(ch)) return 'katakana'
  if (RE_LATIN.test(ch)) return 'latin'
  return 'other'
}

/**
 * ルビの親文字の開始位置を、plainText を末尾から同一文字種で遡って決める。
 * 青空文庫の慣習に従う: 漢字は漢字だけ、カタカナはカタカナだけ、で切る。
 */
function scanBackForRubyBase(plainText: string): number {
  if (plainText.length === 0) return 0
  const chars = [...plainText]
  const lastCh = chars[chars.length - 1]!
  const cls = charClass(lastCh)
  if (cls === 'other') {
    // 記号にはルビを振れない。直前1文字だけを親文字にする。
    return plainText.length - lastCh.length
  }
  let start = plainText.length
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i]!
    if (charClass(c) !== cls) break
    start -= c.length
  }
  return start
}

export function parseInline(
  line: string,
  sourceOffset: number,
  issues: IssueCollector,
  openDecorations: Decoration[]
): InlineParseResult {
  let plain = ''
  const leaves: InlineNode[] = []
  const notes: NoteNode[] = []
  const spans: Span[] = []
  const directives: Directive[] = []

  /** ［＃ここから傍点］系で開いたままの装飾。行を越えて維持される。 */
  const openStack: Array<{ decoration: Decoration; start: number }> =
    openDecorations.map((d) => ({ decoration: d, start: 0 }))

  /** ｜ で明示指定されたルビ親文字の開始位置。 */
  let explicitRubyBase: number | null = null

  const pushText = (s: string): void => {
    if (!s) return
    const last = leaves[leaves.length - 1]
    if (last && last.kind === 'text' && last.end === plain.length) {
      last.text += s
      last.end += s.length
    } else {
      leaves.push({ kind: 'text', start: plain.length, end: plain.length + s.length, text: s })
    }
    plain += s
  }

  let i = 0
  while (i < line.length) {
    const ch = line[i]!

    // --- エスケープ / 外字 ---
    if (ch === '※') {
      if (line.startsWith(ANNO_OPEN, i + 1)) {
        const close = line.indexOf(ANNO_CLOSE, i + 1)
        if (close === -1) {
          issues.add('malformed-annotation', '外字注記が閉じていない', sourceOffset + i, line.slice(i))
          pushText(ch)
          i++
          continue
        }
        const body = line.slice(i + 1 + ANNO_OPEN.length, close)
        const resolved = resolveGaiji(body)
        if (resolved.resolution === 'placeholder') {
          issues.add('unresolved-gaiji', `外字を解決できない: ${body}`, sourceOffset + i, line.slice(i, close + 1))
        }
        const node = makeGaijiNode(plain.length, body, resolved)
        leaves.push(node)
        plain += resolved.text
        i = close + ANNO_CLOSE.length
        continue
      }
      // ※《 ※》 ※｜ は次の記号をそのまま本文として出す(エスケープ)
      const next = line[i + 1]
      if (next === '《' || next === '》' || next === '｜' || next === '［') {
        pushText(next)
        i += 2
        continue
      }
      pushText(ch)
      i++
      continue
    }

    // --- 注記 ---
    if (line.startsWith(ANNO_OPEN, i)) {
      const close = line.indexOf(ANNO_CLOSE, i)
      if (close === -1) {
        issues.add('malformed-annotation', '注記が閉じていない', sourceOffset + i, line.slice(i))
        pushText(ch)
        i++
        continue
      }
      const body = line.slice(i + ANNO_OPEN.length, close)
      const anno = classifyAnnotation(body)
      applyAnnotation(anno, body, sourceOffset + i)
      i = close + ANNO_CLOSE.length
      continue
    }

    // --- ルビ親文字の明示指定 ---
    if (ch === '｜') {
      explicitRubyBase = plain.length
      i++
      continue
    }

    // --- ルビ ---
    if (ch === '《') {
      const close = line.indexOf('》', i)
      if (close === -1) {
        pushText(ch)
        i++
        continue
      }
      const rubyText = line.slice(i + 1, close)
      const baseStart = explicitRubyBase ?? scanBackForRubyBase(plain)
      explicitRubyBase = null
      if (baseStart >= plain.length) {
        issues.add('ruby-without-base', `ルビの親文字が無い: 《${rubyText}》`, sourceOffset + i, line.slice(i, close + 1))
        i = close + 1
        continue
      }
      absorbIntoRuby(baseStart, rubyText)
      i = close + 1
      continue
    }

    pushText(ch)
    i++
  }

  // 行末で閉じていない装飾は行末までとする(次行では openDecorations 経由で再開)
  for (const open of openStack) {
    if (open.start < plain.length) {
      spans.push({ start: open.start, end: plain.length, decoration: open.decoration })
    }
  }

  const children = assemble(plain, leaves, notes, spans, issues, sourceOffset)
  return {
    plainText: plain,
    children,
    directives,
    openDecorations: openStack.map((o) => o.decoration)
  }

  // ---- 内部ヘルパー ----

  /** ルビ範囲に既存 leaf を吸収して RubyNode を作る。 */
  function absorbIntoRuby(rawStart: number, rubyText: string): void {
    // 原子的な leaf(ルビ/外字)の途中で切れないよう境界を外側に広げる
    let start = rawStart
    for (const leaf of leaves) {
      if (leaf.kind === 'text') continue
      if (leaf.start < start && start < leaf.end) start = leaf.start
    }
    const baseText = plain.slice(start)
    // start 以降の leaf を取り除いて RubyNode に置き換える
    for (let k = leaves.length - 1; k >= 0; k--) {
      const leaf = leaves[k]!
      if (leaf.end <= start) break
      if (leaf.kind === 'text' && leaf.start < start) {
        const keep = leaf.text.slice(0, start - leaf.start)
        leaf.text = keep
        leaf.end = start
        break
      }
      if (leaf.kind === 'gaiji') {
        // 本文の文字自体は plainText に正しく入っている。
        // 失われるのは注記の説明や面区点といったメタ情報だけ。
        issues.add(
          'gaiji-in-ruby',
          `ルビ親文字の外字メタ情報を失った(本文は正しい): ${baseText}`,
          sourceOffset,
          baseText
        )
      }
      leaves.splice(k, 1)
    }
    leaves.push({ kind: 'ruby', start, end: plain.length, baseText, rubyText })
  }

  function applyAnnotation(anno: Annotation, body: string, srcOff: number): void {
    switch (anno.type) {
      case 'decoration-start':
        openStack.push({ decoration: anno.decoration, start: plain.length })
        return
      case 'decoration-end': {
        // 同種の装飾を後ろから探して閉じる
        for (let k = openStack.length - 1; k >= 0; k--) {
          if (openStack[k]!.decoration.kind === anno.decoration.kind) {
            const [open] = openStack.splice(k, 1)
            if (open!.start < plain.length) {
              spans.push({ start: open!.start, end: plain.length, decoration: open!.decoration })
            }
            return
          }
        }
        issues.add('unclosed-span', `対応する開始注記が無い: ${body}`, srcOff, body)
        return
      }
      case 'decoration-target': {
        const idx = plain.lastIndexOf(anno.target)
        if (idx === -1) {
          issues.add('unmatched-target', `対象文字列が直前に見つからない: ${anno.target}`, srcOff, body)
          return
        }
        spans.push({ start: idx, end: idx + anno.target.length, decoration: anno.decoration })
        return
      }
      case 'unknown':
        issues.add('unknown-annotation', `未対応の注記: ${body}`, srcOff, body)
        notes.push({ kind: 'note', start: plain.length, end: plain.length, raw: body })
        return
      default:
        // ブロック側で処理する注記
        directives.push({ annotation: anno, offset: plain.length })
    }
  }
}

// --- 装飾スパンから木を組み立てる ---

function assemble(
  plain: string,
  leaves: InlineNode[],
  notes: NoteNode[],
  rawSpans: Span[],
  issues: IssueCollector,
  sourceOffset: number
): InlineNode[] {
  let sorted = [...leaves].sort((a, b) => a.start - b.start || a.end - b.end)
  const spans = clampSpans(rawSpans, sorted).sort(
    (a, b) => a.start - b.start || b.end - a.end
  )

  // 縦中横は範囲をまるごと1つの TcyNode に置き換える(入れ子にしない)。
  // pushText が隣接テキストを1つの leaf にまとめているため、
  // 範囲に掛かるテキスト leaf は「削除」ではなく「分割」しなければならない。
  const tcySpans = spans.filter((s) => s.decoration.kind === 'tcy')
  const styleSpans = spans.filter((s) => s.decoration.kind !== 'tcy')
  for (const t of tcySpans) {
    const node: TcyNode = {
      kind: 'tcy',
      start: t.start,
      end: t.end,
      text: plain.slice(t.start, t.end)
    }
    const kept: InlineNode[] = []
    for (const leaf of sorted) {
      if (leaf.end <= t.start || leaf.start >= t.end) {
        kept.push(leaf)
        continue
      }
      if (leaf.kind === 'text') {
        if (leaf.start < t.start) {
          kept.push({
            kind: 'text',
            start: leaf.start,
            end: t.start,
            text: leaf.text.slice(0, t.start - leaf.start)
          })
        }
        if (leaf.end > t.end) {
          kept.push({
            kind: 'text',
            start: t.end,
            end: leaf.end,
            text: leaf.text.slice(t.end - leaf.start)
          })
        }
      }
      // ルビ/外字など原子的な leaf は縦中横に吸収される
    }
    kept.push(node)
    sorted = kept
  }
  sorted.sort((a, b) => a.start - b.start || a.end - b.end)

  detectCrossings(styleSpans, issues, sourceOffset)

  const tree = build(styleSpans, 0, plain.length)
  return mergeNotes(tree, notes)

  function build(pool: Span[], from: number, to: number): InlineNode[] {
    const out: InlineNode[] = []
    let cursor = from
    const here = pool.filter((s) => s.start >= from && s.end <= to)
    for (let k = 0; k < here.length; k++) {
      const s = here[k]!
      if (s.start < cursor) continue // 既に内側で消費済み、または交差により破棄
      out.push(...sliceLeaves(cursor, s.start))
      const inner = here.slice(k + 1).filter((x) => x.start >= s.start && x.end <= s.end)
      out.push(container(s, build(inner, s.start, s.end)))
      cursor = s.end
    }
    out.push(...sliceLeaves(cursor, to))
    return out
  }

  function sliceLeaves(from: number, to: number): InlineNode[] {
    if (to <= from) return []
    const out: InlineNode[] = []
    for (const leaf of sorted) {
      if (leaf.end <= from || leaf.start >= to) continue
      if (leaf.kind === 'text') {
        const s = Math.max(leaf.start, from)
        const e = Math.min(leaf.end, to)
        if (e <= s) continue
        out.push({
          kind: 'text',
          start: s,
          end: e,
          text: leaf.text.slice(s - leaf.start, e - leaf.start)
        })
      } else {
        out.push(leaf)
      }
    }
    return out
  }
}

function container(s: Span, children: InlineNode[]): InlineNode {
  const base = { start: s.start, end: s.end, children }
  switch (s.decoration.kind) {
    case 'emphasis':
      return { kind: 'emphasis', ...base, mark: s.decoration.mark ?? 'sesame' } as EmphasisNode
    case 'bold':
      return { kind: 'bold', ...base } as BoldNode
    default:
      return { kind: 'underline', ...base, style: s.decoration.style ?? 'solid' } as UnderlineNode
  }
}

/** 装飾範囲が原子的 leaf(ルビ/外字/縦中横)の途中で切れないよう境界を丸める。 */
function clampSpans(spans: Span[], leaves: InlineNode[]): Span[] {
  return spans.map((s) => {
    let { start, end } = s
    for (const leaf of leaves) {
      if (leaf.kind === 'text') continue
      if (leaf.start < start && start < leaf.end) start = leaf.start
      if (leaf.start < end && end < leaf.end) end = leaf.end
    }
    return { ...s, start, end }
  })
}

function detectCrossings(spans: Span[], issues: IssueCollector, sourceOffset: number): void {
  for (let a = 0; a < spans.length; a++) {
    for (let b = a + 1; b < spans.length; b++) {
      const x = spans[a]!
      const y = spans[b]!
      if (x.start < y.start && y.start < x.end && x.end < y.end) {
        issues.add(
          'crossing-span',
          `装飾範囲が交差している(外側を優先し内側を破棄): ${x.decoration.kind} / ${y.decoration.kind}`,
          sourceOffset,
          ''
        )
      }
    }
  }
}

/** ゼロ幅の note をオフセット順にトップレベルへ差し込む。 */
function mergeNotes(tree: InlineNode[], notes: NoteNode[]): InlineNode[] {
  if (notes.length === 0) return tree
  const out: InlineNode[] = []
  const queue = [...notes].sort((a, b) => a.start - b.start)
  for (const node of tree) {
    while (queue.length > 0 && queue[0]!.start <= node.start) out.push(queue.shift()!)
    out.push(node)
  }
  out.push(...queue)
  return out
}
