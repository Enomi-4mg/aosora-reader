/**
 * メモ入力。選択範囲へのメモと現在位置へのメモで共有する。
 *
 * window.prompt は Electron が実装していないので、入力は必ず自前の UI で受ける。
 */
import { useState, type JSX } from 'react'

export function MemoForm({
  initial = '',
  placeholder = 'この箇所へのメモ',
  submitLabel = '保存',
  onSubmit,
  onCancel
}: {
  initial?: string
  placeholder?: string
  submitLabel?: string
  onSubmit: (text: string) => void
  onCancel: () => void
}): JSX.Element {
  const [text, setText] = useState(initial)
  return (
    <form
      className="memo-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim()) onSubmit(text)
      }}
    >
      <textarea
        value={text}
        placeholder={placeholder}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="annotation-actions">
        <button disabled={text.trim() === ''}>{submitLabel}</button>
        <button type="button" className="ghost" onClick={onCancel}>取消</button>
      </div>
    </form>
  )
}
