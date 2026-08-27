/**
 * Block → React 要素。青空文庫固有の概念はここには無く、Document Model だけを見る。
 */
import { memo, type JSX } from 'react'
import type { Block } from '@shared/model/document'
import { ATTR_BLOCK, ATTR_CHAPTER } from './dom/contract'
import { renderInline } from './InlineRenderer'

interface Props {
  block: Block
  chapterId: string
}

function BlockRendererImpl({ block, chapterId }: Props): JSX.Element {
  const common = {
    [ATTR_BLOCK]: block.id,
    [ATTR_CHAPTER]: chapterId,
    style:
      block.indentLevel > 0
        ? { marginBlockStart: `${block.indentLevel}em` }
        : undefined
  }

  switch (block.type) {
    case 'heading': {
      const Tag = (['h2', 'h3', 'h4'] as const)[(block.headingLevel ?? 1) - 1] ?? 'h3'
      return (
        <Tag {...common} className={`blk head head-${block.headingLevel ?? 1}`}>
          {renderInline(block.children)}
        </Tag>
      )
    }

    case 'pageBreak':
      return <div {...common} className="blk page-break" aria-hidden="true" />

    case 'horizontalRule':
      return <hr {...common} className="blk rule" />

    case 'image':
      return (
        <figure {...common} className="blk image">
          {/* 画像が欠けていても本文閲覧を止めない(要件 §9) */}
          <span className="image-placeholder" role="img" aria-label={block.image?.alt ?? '挿絵'}>
            {block.image?.alt ?? '挿絵'}
          </span>
        </figure>
      )

    case 'quote':
      return (
        <blockquote {...common} className="blk quote">
          {renderInline(block.children)}
        </blockquote>
      )

    default:
      if (block.plainText === '' && block.children.length === 0) {
        return <p {...common} className="blk empty" />
      }
      return (
        <p {...common} className="blk para">
          {renderInline(block.children)}
        </p>
      )
  }
}

export const BlockRenderer = memo(BlockRendererImpl)
