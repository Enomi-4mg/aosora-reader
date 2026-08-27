import { useEffect, useRef } from 'react'
import { positionToCharOffset, type BookIndex, type TextPosition } from '@shared/model/position'

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
    start()
    window.addEventListener('beforeunload', close)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', close)
      document.removeEventListener('visibilitychange', onHide)
      close()
    }
  }, [bookId])
}
