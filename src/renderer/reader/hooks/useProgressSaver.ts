/**
 * 読書位置の保存(要件 §4.9)。
 * debounce して書き込み、画面離脱・アプリ終了時には確定保存する。
 * 保存するのは TextPosition と percentage だけで、ページ番号は保存しない。
 */
import { useEffect, useRef } from 'react'
import type { TextPosition } from '@shared/model/position'

const DEBOUNCE_MS = 500

export function useProgressSaver(
  bookId: string | null,
  position: TextPosition | null,
  percentage: number
): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ bookId, position, percentage })
  latest.current = { bookId, position, percentage }

  const flush = (): void => {
    const { bookId: id, position: p, percentage: pct } = latest.current
    if (!id || !p) return
    void window.aozora
      .saveProgress({
        bookId: id,
        position: p,
        percentage: pct,
        lastOpenedAt: new Date().toISOString(),
        completed: pct >= 0.995
      })
      // DB 書き込み失敗でアプリを落とさない(要件 §9)
      .catch((e: unknown) => console.error('[progress] 保存に失敗', e))
  }

  useEffect(() => {
    if (!bookId || !position) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [bookId, position?.blockId, position?.offset, percentage])

  // アプリ終了・Reader 離脱時の確定保存
  useEffect(() => {
    const onHide = (): void => flush()
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [])
}
