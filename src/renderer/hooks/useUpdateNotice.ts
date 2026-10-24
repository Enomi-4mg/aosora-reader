import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/ipc'
import { useAppSettingsStore } from '../state/useAppSettingsStore'

/**
 * 本棚に出す更新の知らせ。
 *
 * 設定が 'ask' のあいだは確認そのものをしない。先に許可を訊き、
 * 答えが返ってから初めて外へ出る。'off' なら何も出さず、何も送らない。
 *
 * 取得に失敗しても何も出さない。更新確認は本筋ではないので、
 * 「確認できませんでした」を本棚に出して読書の邪魔をしない。
 */
export type UpdateNotice =
  /** まだ許可を訊いていない。 */
  | { kind: 'consent' }
  /** 新しい版がある。 */
  | { kind: 'available'; version: string; url: string }

export function useUpdateNotice(): {
  notice: UpdateNotice | null
  allow: () => void
  decline: () => void
  dismiss: () => void
} {
  const { settings, loaded, patch } = useAppSettingsStore()
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!loaded || settings.updateCheck !== 'on') return
    let cancelled = false
    void window.aozora
      .checkForUpdate()
      .then((result) => {
        if (!cancelled) setStatus(result)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [loaded, settings.updateCheck])

  let notice: UpdateNotice | null = null
  if (!loaded || dismissed) notice = null
  else if (settings.updateCheck === 'ask') notice = { kind: 'consent' }
  else if (status?.state === 'available') {
    notice = { kind: 'available', version: status.version, url: status.url }
  }

  return {
    notice,
    allow: () => void patch({ updateCheck: 'on' }),
    decline: () => void patch({ updateCheck: 'off' }),
    dismiss: () => setDismissed(true)
  }
}
