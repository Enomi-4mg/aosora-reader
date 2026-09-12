// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShareMenu, shareUrls } from '@renderer/reader/ShareMenu'

describe('ShareMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('XとLINEの共有URLをエンコードする', () => {
    const result = shareUrls('吾輩は猫である & 続', '夏目 漱石', 'https://example.com/card?a=1&b=2')
    expect(result.x).toContain(encodeURIComponent('『吾輩は猫である & 続』— 夏目 漱石'))
    expect(result.x).toContain(encodeURIComponent('https://example.com/card?a=1&b=2'))
    expect(result.line).toBe(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent('https://example.com/card?a=1&b=2')}`)
  })

  it('作品リンクをコピーして完了表示にする', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('aozora', { copyText })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(
      <ShareMenu title="作品" author="著者" url="https://example.com/work" onClose={() => undefined} />
    ))

    const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('リンクをコピー'))!
    await act(async () => button.click())
    expect(copyText).toHaveBeenCalledWith('https://example.com/work')
    expect(button.textContent).toBe('コピーしました')
    act(() => root.unmount())
  })
})
