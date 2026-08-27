import { useEffect, useState, type JSX } from 'react'
import { LibraryView } from '../library/LibraryView'
import { ReaderView } from '../reader/ReaderView'
import { useReaderStore } from '../state/useReaderStore'
import { useSettingsStore } from '../state/useSettingsStore'
import { useLibraryStore } from '../state/useLibraryStore'

export function App(): JSX.Element {
  const { settings, loaded, load } = useSettingsStore()
  const reader = useReaderStore()
  const library = useLibraryStore()
  const [view, setView] = useState<'library' | 'reader'>('library')

  useEffect(() => {
    void load()
  }, [])

  // テーマは data-theme で切り替える。system は CSS 側で prefers-color-scheme に追従。
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  // 本棚へのドラッグ&ドロップで取り込む
  useEffect(() => {
    const prevent = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    const onDrop = (e: DragEvent): void => {
      prevent(e)
      if (view !== 'library') return
      const paths = Array.from(e.dataTransfer?.files ?? [])
        .map((f) => (f as File & { path?: string }).path)
        .filter((p): p is string => typeof p === 'string' && /\.(txt|zip)$/i.test(p))
      if (paths.length > 0) void library.importPaths(paths)
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', onDrop)
    }
  }, [view])

  if (!loaded) return <div className="boot">起動中…</div>

  if (view === 'reader') {
    return (
      <ReaderView
        onBackToLibrary={() => {
          reader.close()
          setView('library')
          void library.refresh()
        }}
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
