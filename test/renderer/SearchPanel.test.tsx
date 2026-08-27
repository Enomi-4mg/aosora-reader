// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { SearchPanel } from '@renderer/panels/SearchPanel'
import { useReaderStore } from '@renderer/state/useReaderStore'

describe('SearchPanel', () => {
  beforeEach(() => {
    useReaderStore.getState().close()
    document.body.innerHTML = ''
  })

  it('検索抜粋を本文と同じ順序で読み上げられる DOM にする', () => {
    const position = {
      bookId: 'book',
      chapterId: 'chapter',
      blockId: 'block',
      offset: 2
    }
    useReaderStore.setState({
      searchQuery: '語',
      searchCursor: 0,
      searchResult: {
        query: '語',
        count: 1,
        truncated: false,
        matches: [
          {
            position,
            range: { start: position, end: { ...position, offset: 3 } },
            context: '前文語後文',
            contextOffset: 2,
            chapterId: 'chapter'
          }
        ]
      }
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<SearchPanel onJump={() => undefined} />))

    expect(container.querySelector('.search-results button')?.textContent).toBe(
      '前文語後文'
    )

    act(() => root.unmount())
  })
})
