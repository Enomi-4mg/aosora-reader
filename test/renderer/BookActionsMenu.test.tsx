// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookActionsMenu } from '@renderer/library/BookActionsMenu'

describe('BookActionsMenu', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('削除操作をメニュー内に置く', () => {
    const onDelete = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<BookActionsMenu title="作品" onDelete={onDelete} onClose={() => undefined} />))

    const button = container.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    expect(button.textContent).toBe('作品を削除')
    act(() => button.click())
    expect(onDelete).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })

  it('Escapeと外側の操作で閉じる', () => {
    const onClose = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<BookActionsMenu title="作品" onDelete={() => undefined} onClose={onClose} />))

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(2)
    act(() => root.unmount())
  })
})
