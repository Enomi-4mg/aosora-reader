import type { JSX } from 'react'

export function ReaderContextMenu({ x, y, hasSelection, onBookmark, onMemo, onSearch, onSettings, onClose }: {
  x: number
  y: number
  hasSelection: boolean
  onBookmark: () => void
  onMemo: () => void
  onSearch: () => void
  onSettings: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <div className="reader-context-menu" role="menu" style={{ left: x, top: y }} onMouseLeave={onClose}>
      <button role="menuitem" onClick={onBookmark}>ここに栞を追加</button>
      <button role="menuitem" onClick={onMemo}>ここにメモを追加</button>
      <button role="menuitem" disabled={!hasSelection} onClick={onSearch}>選択した本文を検索</button>
      <button role="menuitem" onClick={onSettings}>表示設定</button>
    </div>
  )
}
