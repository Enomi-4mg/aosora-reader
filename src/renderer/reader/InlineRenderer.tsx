/**
 * InlineNode → React 要素。
 *
 * 入れ子の InlineNode を「同一スタイル集合をもつ最大連続スパン(run)」に平坦化し、
 * 各 run に data-run / data-s を付ける(dom/contract.ts の規約)。
 * これにより DOM から plainText オフセットを求める処理が一箇所で完結する。
 */
import type { JSX } from 'react'
import type { InlineNode } from '@shared/model/document'
import { ATTR_RUN, ATTR_START } from './dom/contract'

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

export function renderInline(nodes: InlineNode[], style: Style = {}): JSX.Element[] {
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
            {n.text}
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

      case 'emphasis':
        out.push(
          <span key={key++} className="wrap">
            {renderInline(n.children, { ...style, emphasis: n.mark })}
          </span>
        )
        break

      case 'bold':
        out.push(
          <span key={key++} className="wrap">
            {renderInline(n.children, { ...style, bold: true })}
          </span>
        )
        break

      case 'underline':
        out.push(
          <span key={key++} className="wrap">
            {renderInline(n.children, { ...style, underline: n.style })}
          </span>
        )
        break
    }
  }

  return out
}
