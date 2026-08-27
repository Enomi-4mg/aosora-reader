import { useEffect, useRef } from 'react'
import { positionToCharOffset, type BookIndex, type TextPosition } from '@shared/model/position'

/**
 * 読書位置がこれだけ動かなければ「読んでいない」とみなしてセッションを閉じる。
 *
 * これが無いと、ウィンドウを開いたまま放置した時間がまるごと読書時間になり、
 * ReadingSessionRepository.stats の「文字数 ÷ 分」が潰れて読了時間推定が壊れる。
 */
const IDLE_MS = 5 * 60_000
const IDLE_CHECK_MS = 30_000

function positionKey(p: TextPosition | null): string {
  return p ? `${p.blockId}:${p.offset}` : ''
}

export function useReadingSession(
  bookId: string | null,
  index: BookIndex | null,
  position: TextPosition | null,
  percentage: number
): void {
  const latest = useRef({ position, percentage })
  latest.current = { position, percentage }

  useEffect(() => {
    if (!bookId || !index || !position) return
    let active: { id: Promise<string>; startOffset: number } | null = null

    const start = (): void => {
      const current = latest.current.position
      if (active || !current) return
      active = {
        id: window.aozora.startReadingSession(bookId, current, latest.current.percentage),
        startOffset: positionToCharOffset(index, current)
      }
    }

    const close = (): void => {
      const session = active
      active = null
      if (!session) return
      const current = latest.current.position
      if (!current) return
      const read = Math.max(0, positionToCharOffset(index, current) - session.startOffset)
      void session.id.then((id) => window.aozora.closeReadingSession(
        id, current, latest.current.percentage, read
      )).catch((error: unknown) => console.error('[session] 保存に失敗', error))
    }

    const onHide = (): void => {
      if (document.visibilityState === 'hidden') close()
      else start()
    }

    // 位置が動いたら「読んでいる」。動かないまま IDLE_MS 過ぎたら閉じる。
    // 検知は IDLE_CHECK_MS ごとなので、放置ぶんが最大 IDLE_MS + IDLE_CHECK_MS
    // だけ計上される。無制限に積み上がるよりは桁違いにましという割り切り。
    let lastKey = positionKey(latest.current.position)
    let lastMovedAt = Date.now()
    const checkIdle = (): void => {
      const key = positionKey(latest.current.position)
      if (key !== lastKey) {
        lastKey = key
        lastMovedAt = Date.now()
        start() // 放置で閉じたあと読み再開したら、新しいセッションを開く
        return
      }
      if (active && Date.now() - lastMovedAt >= IDLE_MS) close()
    }

    start()
    const idleTimer = setInterval(checkIdle, IDLE_CHECK_MS)
    window.addEventListener('beforeunload', close)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      clearInterval(idleTimer)
      window.removeEventListener('beforeunload', close)
      document.removeEventListener('visibilitychange', onHide)
      close()
    }
  }, [bookId])
}
