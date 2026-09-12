import { useEffect, useRef, type JSX } from 'react'

export function BookActionsMenu({ title, onDelete, onClose }: {
  title: string
  onDelete: () => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div ref={ref} className="card-actions-menu" role="menu" aria-label={`${title} の操作`}>
      <button autoFocus type="button" role="menuitem" className="danger-text" onClick={onDelete}>
        作品を削除
      </button>
    </div>
  )
}
