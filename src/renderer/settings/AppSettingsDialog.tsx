import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { DEFAULT_SETTINGS } from '@shared/model/settings'
import { customFontFamily, useAppSettingsStore } from '../state/useAppSettingsStore'
import { useSettingsStore } from '../state/useSettingsStore'
import { THEMES } from './SettingsPanel'

type ResetScope = 'app' | 'reader' | 'all'

export function AppSettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const app = useAppSettingsStore()
  const reader = useSettingsStore()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [dataLocation, setDataLocation] = useState('')
  const [resetScope, setResetScope] = useState<ResetScope>('app')

  useEffect(() => { void window.aozora.getDataLocation().then(setDataLocation) }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    dialogRef.current?.querySelector<HTMLElement>('button, select, input')?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const trapFocus = (event: ReactKeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled)') ?? [])]
    if (!items.length) return
    const first = items[0]!
    const last = items.at(-1)!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const removeFont = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`「${name}」を削除しますか？`)) return
    if (reader.settings.fontFamily === customFontFamily(id)) await reader.patch({ fontFamily: DEFAULT_SETTINGS.fontFamily })
    await app.deleteFont(id)
  }

  const reset = async (): Promise<void> => {
    const label = resetScope === 'all' ? 'すべての設定' : resetScope === 'app' ? 'アプリ設定' : '読書設定'
    if (!window.confirm(`${label}を初期値に戻しますか？\n追加したフォントは削除されません。`)) return
    if (resetScope === 'app' || resetScope === 'all') await app.reset()
    if (resetScope === 'reader' || resetScope === 'all') await reader.reset()
  }

  return (
    <div className="modal-backdrop settings-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div ref={dialogRef} className="modal app-settings-dialog" role="dialog" aria-modal="true" aria-label="アプリ設定" onKeyDown={trapFocus}>
        <div className="app-settings-head">
          <h2>アプリ設定</h2>
          <button className="ghost" onClick={onClose} aria-label="設定を閉じる">×</button>
        </div>
        {(app.error || reader.error) && <p className="panel-error" role="alert">{app.error ?? reader.error}</p>}

        <section>
          <h3>一般</h3>
          <label>テーマ
            <select value={app.settings.theme} onChange={(event) => void app.patch({ theme: event.target.value as typeof app.settings.theme })}>
              {THEMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </section>

        <section>
          <h3>本棚</h3>
          <label>表示形式
            <select value={app.settings.libraryView} onChange={(event) => void app.patch({ libraryView: event.target.value as typeof app.settings.libraryView })}>
              <option value="grid">グリッド</option><option value="list">リスト</option>
            </select>
          </label>
          <label>並び順
            <select value={app.settings.librarySort} onChange={(event) => void app.patch({ librarySort: event.target.value as typeof app.settings.librarySort })}>
              <option value="recent">最近読んだ順</option><option value="title">タイトル</option>
              <option value="author">著者</option><option value="added">追加日</option><option value="progress">進捗</option>
            </select>
          </label>
        </section>

        <section>
          <div className="settings-section-head"><h3>フォント</h3><button onClick={() => void app.importFonts()}>フォントを追加</button></div>
          {app.fonts.length === 0 ? <p className="muted small">追加したフォントはありません。</p> : (
            <ul className="font-list">
              {app.fonts.map((font) => <li key={font.id}>
                <input aria-label={`${font.displayName}の表示名`} defaultValue={font.displayName} onBlur={(event) => {
                  if (event.target.value.trim() !== font.displayName) void app.renameFont(font.id, event.target.value)
                }} />
                <span className={font.error ? 'font-error small' : 'muted small'} title={font.error}>
                  {font.error ?? font.format.toUpperCase()}
                </span>
                <button className="ghost danger-text" onClick={() => void removeFont(font.id, font.displayName)}>削除</button>
              </li>)}
            </ul>
          )}
        </section>

        <section>
          <h3>データ</h3>
          <p className="data-location" title={dataLocation}>{dataLocation}</p>
          <button onClick={() => void window.aozora.revealDataLocation()}>保存場所を開く</button>
        </section>

        <section>
          <h3>初期化</h3>
          <div className="reset-row">
            <select aria-label="初期化する範囲" value={resetScope} onChange={(event) => setResetScope(event.target.value as ResetScope)}>
              <option value="app">アプリ設定</option><option value="reader">読書設定</option><option value="all">すべて</option>
            </select>
            <button className="danger" onClick={() => void reset()}>選択した設定を初期化</button>
          </div>
        </section>
      </div>
    </div>
  )
}
