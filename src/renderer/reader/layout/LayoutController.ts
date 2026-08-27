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

const EDGE_EPSILON = 1

export class LayoutController {
  private pageCount = 1
  private currentPage = 0
  private step = 1
  private gap = 40
  /** 縦書き本文の字形が占める、右端からの論理座標区間。 */
  private verticalInk: Array<[start: number, end: number]> = []

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

  /**
   * 段間(px)。CSS の column-gap を唯一の正とする。
   *
   * ここで係数を持って計算し直すと CSS と二重管理になり、丸め方の違いが
   * ページごとに累積して境界が一列ずれる。縦書きは段組を使わないので 0。
   */
  private columnGap(): number {
    const gap = Number.parseFloat(getComputedStyle(this.ctx.content).columnGap)
    return Number.isFinite(gap) ? gap : 0
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
    const { content } = this.ctx
    this.gap = this.vertical ? 0 : this.columnGap()
    const pageWidth = this.pageWidth()

    if (!this.paginated) {
      this.verticalInk = []
      this.clearEdgeMasks()
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
    this.verticalInk = this.vertical ? this.measureVerticalInk() : []
    if (!this.vertical) this.clearEdgeMasks()
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
    if (this.vertical) this.applyEdgeMasks()
    content.style.transition =
      animate && settings.pageTransitionMs > 0
        ? `transform ${settings.pageTransitionMs}ms ease`
        : 'none'
    content.style.transform = `translateX(${d}px)`
  }

  /**
   * 各文字の描画矩形を、縦書き本文の右端からの距離へ変換して統合する。
   * 要素全体の矩形では長い run が複数列を一つに包んでしまうため、
   * Text node ごとの ClientRect（実際の一列）を使う。
   */
  private measureVerticalInk(): Array<[number, number]> {
    const { content } = this.ctx
    const contentRect = content.getBoundingClientRect()
    const intervals: Array<[number, number]> = []
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)

    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (node.data.length === 0) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue
        intervals.push([
          contentRect.right - rect.right,
          contentRect.right - rect.left
        ])
      }
    }

    intervals.sort((a, b) => a[0] - b[0])
    const merged: Array<[number, number]> = []
    for (const interval of intervals) {
      const last = merged[merged.length - 1]
      if (last && interval[0] <= last[1] + EDGE_EPSILON) {
        last[1] = Math.max(last[1], interval[1])
      } else {
        merged.push([...interval])
      }
    }
    return merged
  }

  /** ページ境界を横切る字形区間。区間外なら境界は行間にある。 */
  private inkAt(coord: number): [number, number] | null {
    let lo = 0
    let hi = this.verticalInk.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const interval = this.verticalInk[mid]!
      if (coord < interval[0]) hi = mid - 1
      else if (coord > interval[1]) lo = mid + 1
      else return interval
    }
    return null
  }

  /**
   * ページ間の余白は重なっているため、境界をまたぐ一列は前ページへ割り当てる。
   * 左側ではその列を全部見せ、次ページの右側では全部覆うことで、
   * 文字の欠落・重複なしに「半文字だけ見える」状態を防ぐ。
   */
  private applyEdgeMasks(): void {
    const { viewport } = this.ctx
    const host = viewport.parentElement ?? viewport
    const style = getComputedStyle(viewport)
    const leftPadding = Number.parseFloat(style.paddingLeft)
    const rightPadding = Number.parseFloat(style.paddingRight)
    const pageStart = this.currentPage * this.step
    const pageEnd = pageStart + this.step

    const atEnd = this.inkAt(pageEnd)
    const leftMask = atEnd
      ? Math.max(0, leftPadding - (atEnd[1] - pageEnd) - EDGE_EPSILON)
      : leftPadding

    const atStart = pageStart > 0 ? this.inkAt(pageStart) : null
    const rightMask = atStart
      ? rightPadding + (atStart[1] - pageStart) + EDGE_EPSILON
      : rightPadding

    // viewport の style 属性は React の style prop が管理しているため、
    // 再描画で消されない親要素に置き、継承させる。
    host.style.setProperty('--edge-mask-left', `${leftMask}px`)
    host.style.setProperty('--edge-mask-right', `${rightMask}px`)
  }

  private clearEdgeMasks(): void {
    const host = this.ctx.viewport.parentElement ?? this.ctx.viewport
    host.style.removeProperty('--edge-mask-left')
    host.style.removeProperty('--edge-mask-right')
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
   * ページ送り軸(列送り軸)上の座標。content 先頭からの距離。
   * transform 済みの座標から content の矩形を引くことで、変換前の値が得られる。
   *
   * 縦書き: 本文は右→左へ伸びるので右端からの距離。
   * 横書き: multicolumn の列が左→右へ並ぶので左端からの距離。
   */
  private pageCoordOfRect(r: DOMRect): number {
    const c = this.ctx.content.getBoundingClientRect()
    return this.vertical ? c.right - r.right : r.left - c.left
  }

  /**
   * 本文が進む軸(block progression 軸)上の座標。
   *
   * **ページ送り軸と同じとは限らない。** vertical-rl は列送りもブロック進行も
   * 右→左なので一致するが、horizontal-tb の連続スクロールでは本文は上→下へ進む。
   * ここを取り違えると、横書きスクロールで全ブロックの座標が同値になり、
   * currentPosition() が常に最後のブロックを返してしまう。
   */
  private progressCoordOfRect(r: DOMRect): number {
    if (this.vertical || this.paginated) return this.pageCoordOfRect(r)
    const c = this.ctx.content.getBoundingClientRect()
    return r.top - c.top
  }

  private progressCoordOf(el: Element): number {
    return this.progressCoordOfRect(el.getBoundingClientRect())
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
      ? Math.max(0, Math.floor(this.pageCoordOfRect(rect) / this.step))
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
    return Math.max(0, Math.floor(this.pageCoordOfRect(el.getBoundingClientRect()) / this.step))
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
      : this.visibleProgressStart()

    // Block のインライン座標は文書順に単調増加するので二分探索できる
    let lo = 0
    let hi = blocks.length - 1
    let found = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.progressCoordOf(blocks[mid]!) <= targetCoord + 0.5) {
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
      if (this.progressCoordOf(run) <= targetCoord + 0.5) boundaryRun = run
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

  /** run 内で、本文進行軸の座標が targetCoord 以上になる最小のオフセット。 */
  private offsetAtBoundary(run: Element, targetCoord: number): number {
    const len = runTextLength(run)
    if (len <= 1) return 0

    const coordAt = (off: number): number | null => {
      const r = rangeAtRunOffset(run, off)
      if (!r) return null
      const rect = r.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return null
      return this.progressCoordOfRect(rect)
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

  /** 連続スクロールで、いま画面上端(縦書きなら右端)に来ている本文進行軸の座標。 */
  private visibleProgressStart(): number {
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
