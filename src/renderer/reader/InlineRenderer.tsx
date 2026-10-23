/**
 * InlineNode → React 要素。
 *
 * 入れ子の InlineNode を「同一スタイル集合をもつ最大連続スパン(run)」に平坦化し、
 * 各 run に data-run / data-s を付ける(dom/contract.ts の規約)。
 * これにより DOM から plainText オフセットを求める処理が一箇所で完結する。
 */
import { useState, type JSX } from 'react'
import type { GaijiNode, ImageNode, InlineNode } from '@shared/model/document'
import { bookImageUrl } from '@shared/ipc'
import { ATTR_RUN, ATTR_START } from './dom/contract'

/**
 * 行なか画像を描くのに要る、本文の外側の情報。
 *
 * run の構造には関わらないので、Style とは分けて持ち回す。
 */
export interface InlineContext {
  bookId: string
  onImageLoad?: () => void
}

/** run に付く装飾。ネストは CSS クラスの重ね掛けで表現する。 */
interface Style {
  emphasis?: string
  bold?: boolean
  underline?: string
}

function styleClasses(s: Style): string {
  const cs: string[] = []
  if (s.emphasis) cs.push('em', `em-${s.emphasis}`)
  if (s.bold) cs.push('bold')
  if (s.underline) cs.push('ul', `ul-${s.underline}`)
  return cs.join(' ')
}

const runAttrs = (start: number, s: Style) => ({
  [ATTR_RUN]: '',
  [ATTR_START]: String(start),
  className: styleClasses(s) || undefined
})

/**
 * 行なかの画像。数式・楽譜・神代文字など、字形の代わりに置かれた画像。
 *
 * note と同じくゼロ幅なので data-run を持たせない。run を持たせると
 * plainText と DOM の対応が崩れ、ハイライトと読書位置がずれる
 * (dom/contract.ts の規約)。
 */
function InlineFigure({ node, ctx }: { node: ImageNode; ctx: InlineContext }): JSX.Element {
  const sized = node.width !== undefined && node.height !== undefined
  return (
    <img
      className="image-inline"
      src={bookImageUrl(ctx.bookId, node.src)}
      alt={node.alt}
      {...(sized ? { width: node.width, height: node.height } : {})}
      decoding="async"
      draggable={false}
      onLoad={ctx.onImageLoad}
    />
  )
}

/**
 * 画像で与えられた外字。篆書や梵字など、Unicode に無い字形。
 *
 * 外字は本文の1文字を占める(plainText に代替文字が入っている)。ここが
 * 行なか画像との決定的な違いで、文字を DOM から取り除いてはいけない。
 * 取り除くと run の長さが Document Model と食い違い、ハイライトと読書位置が
 * まとめてずれる(dom/contract.ts の規約)。
 *
 * そこで代替文字は必ず DOM に残したまま隠し、画像が読めなかったときだけ見せる。
 * img はテキストノードを持たないので、走査には一切影響しない。
 */
/**
 * 画像外字の代替テキスト。注記からファイル名と面区点を落とす。
 * 注記をそのまま渡すと読み上げが「かっこ fig42345_01 ドット png」まで読む。
 */
function gaijiAlt(description: string): string {
  const head = description.split('（')[0]!.trim()
  return head === '' ? '外字' : head
}

function GaijiGlyph({ node, ctx }: { node: GaijiNode; ctx: InlineContext }): JSX.Element {
  const [failed, setFailed] = useState(false)
  if (node.src === undefined || failed) return <>{node.text}</>
  return (
    <>
      <img
        className="image-gaiji"
        src={bookImageUrl(ctx.bookId, node.src)}
        alt={gaijiAlt(node.description)}
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        onLoad={ctx.onImageLoad}
      />
      <span className="gaiji-standin" aria-hidden="true">
        {node.text}
      </span>
    </>
  )
}

export function renderInline(
  nodes: InlineNode[],
  ctx: InlineContext,
  style: Style = {}
): JSX.Element[] {
  const out: JSX.Element[] = []
  let key = 0

  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        out.push(
          <span key={key++} {...runAttrs(n.start, style)}>
            {n.text}
          </span>
        )
        break

      case 'ruby':
        // 親文字は <ruby> の直接の子テキスト、読みは <rt>。
        // <rt> は plainText に含まれないので走査時に除外される。
        out.push(
          <ruby key={key++} {...runAttrs(n.start, style)}>
            {n.baseText}
            <rt>{n.rubyText}</rt>
          </ruby>
        )
        break

      case 'gaiji':
        out.push(
          <span
            key={key++}
            {...runAttrs(n.start, style)}
            title={n.description}
            data-gaiji={n.resolution}
          >
            {n.resolution === 'image' ? <GaijiGlyph node={n} ctx={ctx} /> : n.text}
          </span>
        )
        break

      case 'tcy':
        out.push(
          <span key={key++} {...runAttrs(n.start, style)} className="tcy">
            {n.text}
          </span>
        )
        break

      case 'note':
        // 未対応注記はゼロ幅。本文の座標を一切消費しない。
        out.push(
          <span key={key++} className="note" data-note={n.raw} aria-hidden="true" />
        )
        break

      case 'image':
        out.push(<InlineFigure key={key++} node={n} ctx={ctx} />)
        break

      case 'emphasis':
        out.push(
          <span key={key++} className="wrap">
            {renderInline(n.children, ctx, { ...style, emphasis: n.mark })}
          </span>
        )
        break

      case 'bold':
        out.push(
          <span key={key++} className="wrap">
            {renderInline(n.children, ctx, { ...style, bold: true })}
          </span>
        )
        break

      case 'underline':
        out.push(
          <span key={key++} className="wrap">
            {renderInline(n.children, ctx, { ...style, underline: n.style })}
          </span>
        )
        break
    }
  }

  return out
}
