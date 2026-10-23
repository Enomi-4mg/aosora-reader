/**
 * パーサーを更新したあと、取り込み済みの本の位置情報を新しい本文へ移す。
 *
 * 【なぜ必要か】
 * パーサーの改善は plainText を変える。注記の入れ子を直したときは、本文へ漏れていた
 * 注記の生テキストが消えた。つまり「同じ作品の同じ場所」を指す offset が変わる。
 * blockId も、ブロックの数が変われば後ろ側がまとめてずれる。
 * 作り直してそのまま放置すると、栞も読書位置も静かに別の場所を指す。
 *
 * 【何を手がかりにするか】
 * Block は sourceStart / sourceEnd(元 TXT へのオフセット)を持っている。
 * これはパーサーの解釈に依存しない「原文のどこか」そのものなので、
 * パーサーを変えても動かない。これで旧ブロックと新ブロックを突き合わせる。
 *
 * ブロック内の offset は、旧 plainText と新 plainText の共通接頭辞・共通接尾辞から
 * 移す。パーサーの改善による差分は一箇所に固まっていることがほとんどで、
 * それより前は動かず、それより後ろは一定量ずれる、という形になる。
 * 変化した区間の内側を指していた位置は、その区間の先頭へ寄せる。
 * 勝手に前後へ動かすより、変化した場所の入口で止めるほうが読み手に説明できる。
 *
 * ハイライトと範囲メモはここでは扱わない。AnnotationRepository が
 * selectedText で本文を探し直し、見つからなければ orphan として見せる仕組みを
 * 既に持っているので、二重に動かさない。
 */
import type { TextPosition } from './position'

/** 対応付けに要るぶんだけの Block。 */
export interface BlockShape {
  id: string
  chapterId: string
  plainText: string
  sourceStart: number
  sourceEnd: number
}

export interface RemapResult {
  position: TextPosition
  /** 位置が動いたか。動いていなければ保存し直す必要はない。 */
  moved: boolean
}

/**
 * 旧ブロックから新ブロックへの対応表。
 * 同じ原文の範囲を指すブロックどうしを結ぶ。
 */
export function buildBlockMap(
  oldBlocks: BlockShape[],
  newBlocks: BlockShape[]
): Map<string, BlockShape> {
  const bySource = new Map<number, BlockShape>()
  for (const b of newBlocks) {
    // 同じ sourceStart のブロックが複数あるときは先に現れたものを採る。
    // 1行から複数ブロックが出る形(将来の変更)でも、先頭に寄せておけば
    // 少なくとも同じ行の中に留まる。
    if (!bySource.has(b.sourceStart)) bySource.set(b.sourceStart, b)
  }

  const map = new Map<string, BlockShape>()
  for (const oldBlock of oldBlocks) {
    const hit = bySource.get(oldBlock.sourceStart)
    if (hit) map.set(oldBlock.id, hit)
  }
  return map
}

/**
 * ブロック内の offset を新しい plainText へ移す。
 *
 * 文字が増えた場所がちょうど位置と重なるときは、どちらへ寄せるか決まらない。
 * ここでは**増えたぶんより前**に寄せる。読書位置で考えると、
 * 新しく出るようになった本文を飛び越さずに済むほうが筋が通る。
 *
 * 旧テキストが空なら 0。新テキストが短ければ末尾で止める。
 */
export function remapOffset(oldText: string, newText: string, offset: number): number {
  if (oldText === newText) return Math.min(offset, newText.length)

  const clamped = Math.max(0, Math.min(offset, oldText.length))

  let prefix = 0
  const maxPrefix = Math.min(oldText.length, newText.length)
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++
  if (clamped <= prefix) return clamped

  let suffix = 0
  const maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix)
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++
  }

  // 末尾側の変わっていない部分に居るなら、末尾からの距離を保つ
  if (clamped >= oldText.length - suffix) {
    return newText.length - (oldText.length - clamped)
  }

  // 変化した区間の内側。入口で止める。
  return prefix
}

/**
 * 1つの位置を新しい本文へ移す。対応するブロックが無ければ null。
 */
export function remapPosition(
  position: TextPosition,
  oldBlocks: Map<string, BlockShape>,
  blockMap: Map<string, BlockShape>
): RemapResult | null {
  const oldBlock = oldBlocks.get(position.blockId)
  const newBlock = blockMap.get(position.blockId)
  if (!oldBlock || !newBlock) return null

  const offset = remapOffset(oldBlock.plainText, newBlock.plainText, position.offset)
  const moved =
    newBlock.id !== position.blockId ||
    newBlock.chapterId !== position.chapterId ||
    offset !== position.offset

  return {
    position: {
      bookId: position.bookId,
      chapterId: newBlock.chapterId,
      blockId: newBlock.id,
      offset
    },
    moved
  }
}

/** blockId で引ける形にする。 */
export function indexBlocks(blocks: BlockShape[]): Map<string, BlockShape> {
  return new Map(blocks.map((b) => [b.id, b]))
}
