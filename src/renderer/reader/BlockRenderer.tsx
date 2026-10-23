/**
 * Block → React 要素。青空文庫固有の概念はここには無く、Document Model だけを見る。
 */
import { memo, useState, type JSX } from 'react'
import type { Block } from '@shared/model/document'
import { bookImageUrl } from '@shared/ipc'
import { ATTR_BLOCK, ATTR_CHAPTER } from './dom/contract'
import { renderInline } from './InlineRenderer'

interface Props {
  block: Block
  chapterId: string
  bookId: string
  /**
   * 挿絵が読み込まれたときに呼ぶ。読み込みで箱の大きさが変わるので、
   * 呼び出し側で測り直す必要がある。
   */
  onImageLoad?: () => void
}

/**
 * 挿絵。
 *
 * 画像が無くても本文閲覧を止めない(要件 §9)。読めなければ既存の代替表示に落とす。
 *
 * width/height 属性は縦横比を伝えるだけで、箱を先に確保はしない
 * (CSS 側で width/height を auto にしないと max-* で潰れて歪むため)。
 * つまり読み込み前の図は幅ゼロで、読み込んだ瞬間に本文の広がりが変わる。
 * だから寸法が判っていても必ず onLoad を上げて測り直させる。
 *
 * loading="lazy" は使わない。ページ送りは transform なので、遅れて読み込むと
 * 読んでいる最中にページ数が変わる。DOM に載るのは1章ぶんだけなので、
 * 章の挿絵はまとめて読み込んでよい。
 */
function Figure({ block, bookId, onImageLoad }: Omit<Props, 'chapterId'>): JSX.Element {
  const [failed, setFailed] = useState(false)
  const image = block.image
  const alt = image?.alt ?? '挿絵'

  if (!image || failed) {
    return (
      <span className="image-placeholder" role="img" aria-label={alt}>
        {alt}
      </span>
    )
  }

  const sized = image.width !== undefined && image.height !== undefined
  return (
    <img
      className="image-figure"
      src={bookImageUrl(bookId, image.src)}
      alt={alt}
      {...(sized ? { width: image.width, height: image.height } : {})}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      onLoad={onImageLoad}
    />
  )
}

function BlockRendererImpl({ block, chapterId, bookId, onImageLoad }: Props): JSX.Element {
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
          <Figure block={block} bookId={bookId} onImageLoad={onImageLoad} />
        </figure>
      )

    /*
     * 図のキャプション。
     *
     * figure の中には入れない。Block を表す要素が data-block-id を持つという
     * DOM 規約(dom/contract.ts)を崩すと、ハイライトと読書位置がまとめて壊れる。
     * 独立したブロックのまま、直前の図に寄せて組む。
     */
    case 'caption':
      return (
        <p {...common} className="blk caption">
          {renderInline(block.children)}
        </p>
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
