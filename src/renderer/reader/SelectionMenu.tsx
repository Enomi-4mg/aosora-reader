import { useState, type JSX } from 'react'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@shared/model/settings'
import type { TextRange } from '@shared/model/position'
import { MemoForm } from './MemoForm'

export interface SelectionState {
  range: TextRange
  text: string
  x: number
  y: number
}

interface Props {
  selection: SelectionState
  onHighlight: (color: HighlightColor) => void
  onMemo: (text: string) => void
  onCopy: () => void
  onDictionary: () => void
  onClose: () => void
}

export function SelectionMenu({ selection, onHighlight, onMemo, onCopy, onDictionary, onClose }: Props): JSX.Element {
  const [memoOpen, setMemoOpen] = useState(false)
  return (
    <div className="selection-menu" role="dialog" aria-label="選択した本文の操作"
      style={{ left: selection.x, top: selection.y }}>
      {memoOpen ? (
        <MemoForm onSubmit={onMemo} onCancel={() => setMemoOpen(false)} />
      ) : (
        <>
          <div className="highlight-swatches" aria-label="ハイライト色">
            {HIGHLIGHT_COLORS.map((color) => (
              <button key={color} className={`swatch ${color}`} aria-label={`${color}でハイライト`}
                onClick={() => onHighlight(color)} />
            ))}
          </div>
          <button onClick={() => setMemoOpen(true)}>メモ</button>
          <button onClick={onCopy}>コピー</button>
          <button onClick={onDictionary}>辞書</button>
          <button className="ghost" aria-label="閉じる" onClick={onClose}>×</button>
        </>
      )}
    </div>
  )
}
