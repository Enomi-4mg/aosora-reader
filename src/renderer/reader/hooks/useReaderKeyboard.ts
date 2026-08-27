/**
 * キーボードショートカット(要件 §5.13)。
 * 中央管理して、将来ユーザーが変更できるようにする前提の形にしておく。
 */
import { useEffect } from 'react'
import { useReaderStore } from '../../state/useReaderStore'
import { useSettingsStore } from '../../state/useSettingsStore'

interface Args {
  next: () => void
  previous: () => void
  onBackToLibrary: () => void
}

/** 入力中は本文操作のキーを奪わない。 */
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

export function useReaderKeyboard({ next, previous, onBackToLibrary }: Args): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const store = useReaderStore.getState()
      const settings = useSettingsStore.getState()
      const mod = e.metaKey || e.ctrlKey

      if (mod) {
        switch (e.key) {
          case 'f':
            e.preventDefault()
            store.openSearch()
            return
          case 't':
            e.preventDefault()
            store.setSidebarTab('contents')
            return
          case '+':
          case '=':
            e.preventDefault()
            void settings.adjustFontSize(1)
            return
          case '-':
            e.preventDefault()
            void settings.adjustFontSize(-1)
            return
          case '0':
            e.preventDefault()
            void settings.resetFontSize()
            return
        }
        return
      }

      if (e.key === 'Escape') {
        if (store.settingsOpen) store.setSettingsOpen(false)
        else if (store.searchOpen) store.closeSearch()
        else if (store.focusMode) store.setFocusMode(false)
        else if (store.sidebarOpen) store.toggleSidebar()
        else onBackToLibrary()
        return
      }

      if (isTyping(e.target)) return

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          // 縦書きは右から左へ読むため、右矢印は前、左矢印は次。
          if (settings.settings.writingMode === 'vertical') previous()
          else next()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (settings.settings.writingMode === 'vertical') next()
          else previous()
          break
        case 'ArrowDown':
        case 'PageDown':
          e.preventDefault()
          next()
          break
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault()
          previous()
          break
        case ' ':
          e.preventDefault()
          if (e.shiftKey) previous()
          else next()
          break
        case 'F11':
          e.preventDefault()
          store.setFocusMode(!store.focusMode)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, previous, onBackToLibrary])
}
