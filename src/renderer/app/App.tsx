import { useEffect, useState, type JSX } from 'react'
import { LibraryView } from '../library/LibraryView'
import { ReaderView } from '../reader/ReaderView'
import { useReaderStore } from '../state/useReaderStore'
import { useSettingsStore } from '../state/useSettingsStore'
import { customFontFamily, customFontId, useAppSettingsStore } from '../state/useAppSettingsStore'
import { DEFAULT_SETTINGS } from '@shared/model/settings'
import { useLibraryStore } from '../state/useLibraryStore'
import { importablePathsFromFiles } from '../library/dropImport'
import { useFullscreen } from '../hooks/useFullscreen'
import { applyPlatformAttribute } from '../platform'

export function App(): JSX.Element {
  const readerSettings = useSettingsStore()
  const appSettings = useAppSettingsStore()
  const reader = useReaderStore()
  const library = useLibraryStore()
  const [view, setView] = useState<'library' | 'reader'>('library')
  const { fullscreen } = useFullscreen()

  useEffect(() => {
    void Promise.all([readerSettings.load(), appSettings.load()])
  }, [])

  // ウィンドウ操作ボタンの位置が OS で変わる。余白の出し分けは CSS 側に任せる。
  useEffect(applyPlatformAttribute, [])

  // テーマは data-theme で切り替える。system は CSS 側で prefers-color-scheme に追従。
  useEffect(() => {
    document.documentElement.dataset.theme = appSettings.settings.theme
  }, [appSettings.settings.theme])

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled(appSettings.fonts.map(async (font) => {
      const data = await window.aozora.getFontData(font.id)
      const face = new FontFace(customFontFamily(font.id).replaceAll('"', ''), new Uint8Array(data).buffer)
      await face.load()
      if (!cancelled) document.fonts.add(face)
      return font.id
    })).then((results) => {
      if (cancelled) return
      const selected = customFontId(readerSettings.settings.fontFamily)
      if (!selected) return
      const selectedIndex = appSettings.fonts.findIndex((font) => font.id === selected)
      if (selectedIndex < 0 || results[selectedIndex]?.status === 'rejected') {
        void readerSettings.patch({ fontFamily: DEFAULT_SETTINGS.fontFamily })
      }
    })
    return () => { cancelled = true }
  }, [appSettings.fonts, readerSettings.settings.fontFamily])

  // 全画面では信号機ボタンが消えるので、ツールバー左の余白も外す。
  useEffect(() => {
    document.documentElement.dataset.fullscreen = String(fullscreen)
  }, [fullscreen])

  // 本棚へのドラッグ&ドロップで取り込む
  useEffect(() => {
    const prevent = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    const onDrop = (e: DragEvent): void => {
      prevent(e)
      if (view !== 'library') return
      const paths = importablePathsFromFiles(
        e.dataTransfer?.files ?? [],
        window.aozora.getPathForFile
      )
      if (paths.length > 0) void library.importPaths(paths)
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', onDrop)
    }
  }, [view])

  if (!readerSettings.loaded || !appSettings.loaded) return <div className="boot">起動中…</div>

  if (view === 'reader') {
    return (
      <ReaderView
        onBackToLibrary={() => {
          reader.close()
          setView('library')
          void library.refresh()
        }}
        onOpenBook={(bookId) => { void reader.open(bookId) }}
      />
    )
  }

  return (
    <LibraryView
      onOpen={async (bookId) => {
        setView('reader')
        await reader.open(bookId)
      }}
    />
  )
}
