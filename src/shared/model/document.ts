/**
 * Document Model — 青空文庫 TXT と表示層のあいだに置く中間表現。
 *
 * 【不変条件 A】各 Block の `plainText` がその Block 内の唯一の座標空間である。
 *  - すべての InlineNode は plainText への [start, end) を持つ。
 *  - ルビの読み(rubyText)は plainText に含めない。含めると検索・ハイライト・
 *    読了率がルビの文字数で汚染される。
 *  - 未対応注記(note)は必ずゼロ幅 (start === end)。座標空間を消費させないことで、
 *    将来パーサーが注記に対応しても既存のハイライト位置がずれない。
 *
 * 【オフセットの単位】UTF-16 コードユニット。
 *  DOM の `Range.startOffset` がテキストノード内の UTF-16 オフセットなので、
 *  同じ単位を使うことで DOM ↔ Model の変換に一切の再計算が要らなくなる。
 *  JIS X 0213 第3・第4水準にはサロゲートペアの外字(例: 𠀋)が含まれるため、
 *  「1文字 = 1オフセット」ではない点に注意すること。
 */

export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'image'
  | 'pageBreak'
  | 'horizontalRule'
  | 'quote'
  | 'unknown'

/** 傍点の種類。青空文庫は複数種を区別するので描画側で出し分けられるよう保持する。 */
export type EmphasisMark =
  | 'sesame'        // 傍点(ゴマ)
  | 'white-sesame'  // 白ゴマ傍点
  | 'dot'           // 丸傍点
  | 'white-dot'     // 白丸傍点
  | 'bullseye'      // 蛇の目傍点
  | 'triangle'      // 三角傍点
  | 'white-triangle'// 白三角傍点
  | 'double-dot'    // 二重丸傍点
  | 'x'             // ×傍点

/** 傍線の種類。 */
export type UnderlineStyle =
  | 'solid'   // 傍線
  | 'double'  // 二重傍線
  | 'dotted'  // 鎖線
  | 'dashed'  // 破線
  | 'wave'    // 波線

/** 外字をどう解決したか。描画側のフォールバック表示に使う。 */
export type GaijiResolution =
  | 'unicode'      // Unicode 文字に変換できた
  | 'substitute'   // 代替文字で表示
  | 'image'        // 画像で表示
  | 'placeholder'  // 解決不能。注記本文をプレースホルダー表示

export interface TextNode {
  kind: 'text'
  start: number
  end: number
  text: string
}

export interface RubyNode {
  kind: 'ruby'
  start: number
  end: number
  /** plainText に現れる親文字。plainText.slice(start, end) と一致する。 */
  baseText: string
  /** 読み。plainText には含まれない。 */
  rubyText: string
}

export interface EmphasisNode {
  kind: 'emphasis'
  start: number
  end: number
  children: InlineNode[]
  mark: EmphasisMark
}

export interface BoldNode {
  kind: 'bold'
  start: number
  end: number
  children: InlineNode[]
}

export interface UnderlineNode {
  kind: 'underline'
  start: number
  end: number
  children: InlineNode[]
  style: UnderlineStyle
}

export interface GaijiNode {
  kind: 'gaiji'
  start: number
  end: number
  /** 実際に plainText に入っている文字列(変換結果 or 代替文字 or プレースホルダー)。 */
  text: string
  resolution: GaijiResolution
  /** 注記の説明部分。ツールチップとフォールバック表示に使う。 */
  description: string
  /** 面区点(例 "1-84-22")。判明した場合のみ。 */
  kuten?: string
  /** resolution === 'image' のときの画像ファイル名。 */
  src?: string
}

export interface TcyNode {
  kind: 'tcy'
  start: number
  end: number
  text: string
}

/** 未対応・不明な注記。必ず start === end のゼロ幅。 */
export interface NoteNode {
  kind: 'note'
  start: number
  end: number
  raw: string
}

export type InlineNode =
  | TextNode
  | RubyNode
  | EmphasisNode
  | BoldNode
  | UnderlineNode
  | GaijiNode
  | TcyNode
  | NoteNode

/** children を持つ(入れ子可能な)ノードか。 */
export function isContainerNode(
  n: InlineNode
): n is EmphasisNode | BoldNode | UnderlineNode {
  return n.kind === 'emphasis' || n.kind === 'bold' || n.kind === 'underline'
}

export interface ImagePayload {
  src: string
  alt: string
  width?: number
  height?: number
}

export interface Block {
  id: string
  type: BlockType
  children: InlineNode[]
  /** この Block の唯一の座標空間。 */
  plainText: string
  /** 字下げ(全角空白換算)。0 = 字下げなし。 */
  indentLevel: number
  /** 見出しレベル。type === 'heading' のときのみ。1=大 2=中 3=小 */
  headingLevel?: 1 | 2 | 3
  image?: ImagePayload
  /** 章先頭からの累積 UTF-16 オフセット。 */
  charStart: number
  /** 元 TXT へのオフセット。診断専用で、位置情報には使わない。 */
  sourceStart: number
  sourceEnd: number
}

export interface Chapter {
  id: string
  title: string
  /** 見出しレベル。前書きなど見出しを持たない先頭章は 0。 */
  level: number
  order: number
  /** 作品先頭からの累積 UTF-16 オフセット。 */
  charStart: number
  /** この章の plainText 合計長。 */
  characterCount: number
  blocks: Block[]
}

export type SourceType = 'txt' | 'zip'

export interface BookMetadata {
  /** 底本情報(そのまま保持)。 */
  bibliography?: string
  /** ファイル先頭の凡例ブロック。 */
  legend?: string
  aozoraUrl?: string
  authorKana?: string
  titleKana?: string
}

/** 本文を含む完全な Book。Reader が開いている1冊だけがこの形でメモリに載る。 */
export interface Book {
  id: string
  title: string
  subtitle: string | null
  author: string | null
  translator: string | null
  sourcePath: string
  sourceType: SourceType
  encoding: string
  /** デコード後テキストの SHA-256。再インポート時の重複判定に使う(要件 §4.1)。 */
  sourceHash: string
  metadata: BookMetadata
  chapters: Chapter[]
  /** 全 plainText の合計長。読了率と読了時間推定の分母。 */
  totalCharacters: number
  importedAt: string
  updatedAt: string
}

/** 本棚一覧用。blocks を含まないので大量に扱っても軽い。 */
export interface BookSummary {
  id: string
  title: string
  subtitle: string | null
  author: string | null
  translator: string | null
  totalCharacters: number
  importedAt: string
  updatedAt: string
  percentage: number
  lastOpenedAt: string | null
  completed: boolean
}
