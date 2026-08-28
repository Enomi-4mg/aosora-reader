/**
 * ツールバーのアイコンボタン。
 *
 * ラベルは常時は出さず hover / focus でツールチップとして見せる。
 * 見た目から文字が消えても支援技術には名前が残るよう、aria-label は必ず付ける。
 */
import type { JSX, ReactNode } from 'react'

export function ToolbarButton({
  label,
  icon,
  onClick,
  pressed,
  expanded,
  disabled,
  tone
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  /** 状態を持つトグル。押下中は色を反転する。 */
  pressed?: boolean
  expanded?: boolean
  disabled?: boolean
  /** 'exit' は読書から抜ける操作。他と役割が違うので色を分ける。 */
  tone?: 'exit'
}): JSX.Element {
  return (
    <button
      type="button"
      className={`tool-button${tone ? ` tone-${tone}` : ''}${pressed ? ' on' : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      disabled={disabled}
      data-tip={label}
      onClick={onClick}
    >
      {icon}
    </button>
  )
}
