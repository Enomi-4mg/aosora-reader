/**
 * Renderer と位置マッピングのあいだの DOM 規約。
 *
 * これを守っている限り、DOM ↔ TextPosition の変換は機械的に決まる:
 *
 *   - Block を表す要素は `data-block-id` を持つ
 *   - Block 内のテキストは「run」に分割され、各 run は
 *       `data-run` と `data-s`(= Block.plainText 内の開始オフセット)を持つ
 *   - run 内のテキストノードは、その run の先頭から順に plainText と一致する
 *   - <rt>(ルビの読み)は plainText に含まれないので、走査から必ず除外する
 *
 * この規約を破ると、ハイライト・検索・読書位置がまとめて壊れる。
 */

export const ATTR_BLOCK = 'data-block-id'
export const ATTR_CHAPTER = 'data-chapter-id'
export const ATTR_RUN = 'data-run'
export const ATTR_START = 'data-s'

export const SELECTOR_BLOCK = `[${ATTR_BLOCK}]`
export const SELECTOR_RUN = `[${ATTR_RUN}]`

/** ルビの読み。plainText に含まれないので座標計算から除外する。 */
export function isExcludedFromText(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'RT'
}
