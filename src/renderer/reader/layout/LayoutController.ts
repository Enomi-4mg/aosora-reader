/**
 * ページ幾何とページ送り。Reader の論理操作 next / previous / goToPosition を
 * ここに集約する(要件 §4.6 / §20-6)。
 *
 * 横書きは multicolumn の列を左→右へ送り、縦書きは本来の block progression
 * (右→左) に伸びた本文を左右へ送る。どちらも画面上の移動は水平に統一する。
 *
 * ページ番号はここでしか存在しない。永続化するのは常に TextPosition(要件 §20-1)。
 */
import type { TextPosition } from '@shared/model/position'
import type { ReaderSettings } from '@shared/model/settings'
import { SELECTOR_BLOCK, SELECTOR_RUN, ATTR_BLOCK, ATTR_CHAPTER, ATTR_START } from '../dom/contract'
import {
  domPointToPosition,
  positionToDomPoint,
  rangeAtRunOffset,
  runTextLength
} from '../dom/positionMapping'

export interface LayoutMetrics {
  pageCount: number
  currentPage: number
}

export interface LayoutContext {
  viewport: HTMLElement
  content: HTMLElement
  settings: ReaderSettings
  bookId: string
}

const COLUMN_GAP_RATIO = 2.2 // fontSize に対する段間の比

export class LayoutController {
  private pageCount = 1
  private currentPage = 0
  private step = 1
  private gap = 40

  constructor(private ctx: LayoutContext) {}

  update(ctx: Partial<LayoutContext>): void {
    this.ctx = { ...this.ctx, ...ctx }
  }

  private get vertical(): boolean {
    return this.ctx.settings.writingMode === 'vertical'
  }

  private get paginated(): boolean {
    return this.ctx.settings.readingMode === 'pagination'
  }

  /** 固定余白を除いた、実際に本文が見える横幅。 */
  private pageWidth(): number {
    const vp = this.ctx.viewport
    const style = getComputedStyle(vp)
    const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
    return Math.max(1, Math.round(vp.clientWidth - padding))
  }

  /**
   * レイアウトを組み直してページ数を測る。
   * フォント変更・writingMode 変更・リサイズのたびに呼ぶ。
   */
  measure(): LayoutMetrics {
    const { content, settings } = this.ctx
    this.gap = Math.round(settings.fontSize * COLUMN_GAP_RATIO)
    const pageWidth = this.pageWidth()

    if (!this.paginated) {
      this.pageCount = 1
      this.currentPage = 0
      this.step = pageWidth
      // 連続スクロールでは transform を使わない。
      // 古い値をインラインスタイルに残すと、幾何計算が実際の表示とずれる。
      content.style.transition = 'none'
      content.style.transform = ''
      return this.metrics()
    }

    // 縦書きは段間を挟まず右→左へ自然に伸ばす。横書きだけ multicolumn の
    // gap を含めた列ピッチで送る。
    this.step = pageWidth + (this.vertical ? 0 : this.gap)
    const extent = content.scrollWidth
    this.pageCount = Math.max(
      1,
      Math.ceil((extent + (this.vertical ? 0 : this.gap)) / this.step)
    )
    this.currentPage = Math.min(this.currentPage, this.pageCount - 1)
    this.applyTransform(false)
    return this.metrics()
  }

  metrics(): LayoutMetrics {
    return { pageCount: this.pageCount, currentPage: this.currentPage }
  }

  /**
   * @param animate ユーザー操作によるページ送りだけアニメーションさせる。
   *
   * プログラム的な移動(再ページング・位置復元)では必ず false にすること。
   * transition が走っている最中の getBoundingClientRect() は途中の座標を返すため、
   * その値でページを導出すると復元位置がずれる。
   */
  private applyTransform(animate: boolean): void {
    const { content, settings } = this.ctx
    const d = this.currentPage * this.step * (this.vertical ? 1 : -1)
    content.style.transition =
      animate && settings.pageTransitionMs > 0
        ? `transform ${settings.pageTransitionMs}ms ease`
        : 'none'
    content.style.transform = `translateX(${d}px)`
  }

  /** 論理的な「次へ」。縦書きでも横書きでも意味は同じ。 */
  next(): boolean {
    if (!this.paginated) return this.scrollByPage(1)
    if (this.currentPage >= this.pageCount - 1) return false
    this.currentPage++
    this.applyTransform(true)
    return true
  }

  /** 論理的な「前へ」。 */
  previous(): boolean {
    if (!this.paginated) return this.scrollByPage(-1)
    if (this.currentPage <= 0) return false
    this.currentPage--
    this.applyTransform(true)
    return true
  }

  goToPage(n: number, animate = false): void {
    this.currentPage = Math.max(0, Math.min(n, this.pageCount - 1))
    this.applyTransform(animate)
  }

  isAtStart(): boolean {
    return this.paginated ? this.currentPage === 0 : this.scrollOffset() <= 1
  }

  isAtEnd(): boolean {
    if (this.paginated) return this.currentPage >= this.pageCount - 1
    const vp = this.ctx.viewport
    const max = this.vertical
      ? vp.scrollWidth - vp.clientWidth
      : vp.scrollHeight - vp.clientHeight
    return this.scrollOffset() >= max - 1
  }

  // --- 連続スクロール ---

  private scrollOffset(): number {
    const vp = this.ctx.viewport
    return Math.abs(this.vertical ? vp.scrollLeft : vp.scrollTop)
  }

  private scrollByPage(dir: number): boolean {
    const vp = this.ctx.viewport
    const before = this.scrollOffset()
    // 縦書きは RTL スクロールで scrollLeft の符号がエンジン依存なので、
    // 絶対値ではなく相対移動(scrollBy)だけを使う。
    const amount = (this.vertical ? vp.clientWidth : vp.clientHeight) * 0.9 * dir
    // 縦書き(vertical-rl)は内容が左へ伸びるので、次ページ = 左方向
    vp.scrollBy(
      this.vertical
        ? { left: -amount, behavior: 'auto' }
        : { top: amount, behavior: 'auto' }
    )
    return Math.abs(this.scrollOffset() - before) > 0.5
  }

  // --- TextPosition ↔ ページ ---

  /**
   * ある要素がインライン軸上でどこにあるか(content 先頭からの距離)。
   * transform 済みの座標から content の矩形を引くことで、変換前の値が得られる。
   */
  private inlineCoordOf(el: Element): number {
    return this.inlineCoordOfRect(el.getBoundingClientRect())
  }

  private inlineCoordOfRect(r: DOMRect): number {
    const c = this.ctx.content.getBoundingClientRect()
    return this.vertical ? c.right - r.right : r.left - c.left
  }

  /**
   * DOM 上の一点(文字単位)が何ページ目にあるか。
   *
   * 要素の矩形ではなく文字の矩形で判定するのが要点。
   * ページ境界をまたぐ長い run では、要素の矩形は「その run が始まったページ」を
   * 指してしまい、復帰のたびに1ページ戻る。
   */
  private pageOfPoint(node: Node, offset: number): number | null {
    const rect = this.rectOfPoint(node, offset)
    return rect
      ? Math.max(0, Math.floor(this.inlineCoordOfRect(rect) / this.step))
      : null
  }

  /** DOM上の文字1字の矩形。長いrun全体ではなく保存offsetそのものを測る。 */
  private rectOfPoint(node: Node, offset: number): DOMRect | null {
    if (node.nodeType !== Node.TEXT_NODE) return null
    const t = node as Text
    const at = Math.min(offset, Math.max(0, t.data.length - 1))
    if (t.data.length === 0) return null
    try {
      const r = document.createRange()
      r.setStart(t, at)
      r.setEnd(t, at + 1)
      const rect = r.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return null
      return rect
    } catch {
      return null
    }
  }

  private pageOfElement(el: Element): number {
    if (!this.paginated) return 0
    return Math.max(0, Math.floor(this.inlineCoordOf(el) / this.step))
  }

  /**
   * 保存された TextPosition へ移動する。
   * ページ番号は保存値からではなく、そのつど幾何から再導出する。
   * これによりフォントサイズ・ウィンドウサイズ・writingMode が変わっても同じ本文位置に戻る。
   */
  goToPosition(p: TextPosition): boolean {
    const point = positionToDomPoint(p, this.ctx.content)
    if (!point) return false

    const el =
      point.node.nodeType === Node.TEXT_NODE
        ? point.node.parentElement
        : (point.node as Element)
    if (!el) return false

    if (this.paginated) {
      // 座標を読む前にアニメーションを止める(途中の矩形を読まないため)
      this.ctx.content.style.transition = 'none'
      const page = this.pageOfPoint(point.node, point.offset) ?? this.pageOfElement(el)
      this.goToPage(page)
      return true
    }

    // スクロールモードは相対移動で寄せる(RTL の符号問題を避ける)
    const vp = this.ctx.viewport
    const r = this.rectOfPoint(point.node, point.offset) ?? el.getBoundingClientRect()
    const v = vp.getBoundingClientRect()
    vp.scrollBy(
      this.vertical
        ? { left: r.right - v.right, behavior: 'auto' }
        : { top: r.top - v.top, behavior: 'auto' }
    )
    return true
  }

  /**
   * いま画面に見えている先頭の本文位置。読書位置の保存に使う。
   * ページ番号ではなく TextPosition を返すのが要点。
   */
  currentPosition(): TextPosition | null {
    const { content, bookId } = this.ctx
    const blocks = Array.from(content.querySelectorAll(SELECTOR_BLOCK))
    if (blocks.length === 0) return null

    const targetCoord = this.paginated
      ? this.currentPage * this.step
      : this.visibleInlineStart()

    // Block のインライン座標は文書順に単調増加するので二分探索できる
    let lo = 0
    let hi = blocks.length - 1
    let found = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.inlineCoordOf(blocks[mid]!) <= targetCoord + 0.5) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }

    // 空行ブロック(改行だけの段落)は寸法を持たないので位置の基準にならない。
    // 本文を持つ最初のブロックまで前進する。
    let block = blocks[found]!
    if (block.querySelector(SELECTOR_RUN) === null) {
      for (let i = found + 1; i < blocks.length; i++) {
        if (blocks[i]!.querySelector(SELECTOR_RUN) !== null) {
          block = blocks[i]!
          break
        }
      }
    }
    const blockId = block.getAttribute(ATTR_BLOCK)
    const chapterId = block.getAttribute(ATTR_CHAPTER)
    if (!blockId || !chapterId) return null

    // ページ境界に掛かっている run を選ぶ
    const runs = Array.from(block.querySelectorAll(SELECTOR_RUN))
    let boundaryRun: Element | null = null
    for (const run of runs) {
      if (this.inlineCoordOf(run) <= targetCoord + 0.5) boundaryRun = run
      else break
    }
    if (!boundaryRun) {
      const pos = domPointToPosition(bookId, block.firstChild ?? block, 0)
      return pos ?? { bookId, chapterId, blockId, offset: 0 }
    }

    // 【重要】run の先頭をそのまま返すと、境界をまたぐ長い run では
    // 「その run が始まったページ」に解決されてしまい、復帰のたびに1ページ戻る。
    // run 内のどの文字でページが変わるかを幾何から二分探索して、正確な位置を出す。
    const runOffset = this.offsetAtBoundary(boundaryRun, targetCoord)
    const start = Number.parseInt(boundaryRun.getAttribute(ATTR_START) ?? '0', 10)
    return {
      bookId,
      chapterId,
      blockId,
      offset: (Number.isFinite(start) ? start : 0) + runOffset
    }
  }

  /** run 内で、インライン座標が targetCoord 以上になる最小のオフセット。 */
  private offsetAtBoundary(run: Element, targetCoord: number): number {
    const len = runTextLength(run)
    if (len <= 1) return 0
    const c = this.ctx.content.getBoundingClientRect()

    const coordAt = (off: number): number | null => {
      const r = rangeAtRunOffset(run, off)
      if (!r) return null
      const rect = r.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return null
      return this.vertical ? c.right - rect.right : rect.left - c.left
    }

    let lo = 0
    let hi = len - 1
    let best = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const coord = coordAt(mid)
      if (coord === null) break
      if (coord < targetCoord - 0.5) {
        lo = mid + 1
      } else {
        best = mid
        hi = mid - 1
      }
    }
    return best
  }

  private visibleInlineStart(): number {
    const vp = this.ctx.viewport
    const v = vp.getBoundingClientRect()
    const c = this.ctx.content.getBoundingClientRect()
    return this.vertical ? c.right - v.right : v.top - c.top
  }

  /** 描画済み範囲のうち、指定 Range が何ページ目にあるか。検索結果へのジャンプに使う。 */
  pageOfRange(range: Range): number | null {
    const byPoint = this.pageOfPoint(range.startContainer, range.startOffset)
    if (byPoint !== null) return byPoint
    const el =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : (range.startContainer as Element)
    return el ? this.pageOfElement(el) : null
  }
}
