import { useCallback, useEffect, useState } from 'react'

const RESYNC_DELAY_MS = 120

/**
 * ウィンドウの全画面状態。
 *
 * 緑ボタンや「表示」メニューからも切り替わるので、アプリ内の操作を数えるだけでは
 * 追いきれない。全画面の出入りは必ずリサイズを伴うので、それを合図に main へ
 * 問い合わせ直す。全画面では信号機ボタンが消えるため、ツールバーの左余白の
 * 出し分けもこの値で決まる。
 */
export function useFullscreen(): { fullscreen: boolean; toggle: () => void } {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    const read = (): void => {
      void window.aozora
        .getFullscreen()
        .then((on) => {
          if (!cancelled) setFullscreen(on)
        })
        .catch(() => {})
    }
    // リサイズはドラッグ中も連続して飛ぶので、落ち着いてから1回だけ確認する。
    const onResize = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(read, RESYNC_DELAY_MS)
    }
    read()
    window.addEventListener('resize', onResize)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const toggle = useCallback(() => {
    void window.aozora
      .getFullscreen()
      .then((current) => window.aozora.setFullscreen(!current))
      .then(setFullscreen)
      .catch(() => {})
  }, [])

  return { fullscreen, toggle }
}
