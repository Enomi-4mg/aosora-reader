import { useEffect, useRef, useState, type JSX } from 'react'

export function shareUrls(title: string, author: string | null, url: string): { x: string; line: string } {
  const label = author ? `『${title}』— ${author}` : `『${title}』`
  return {
    x: `https://x.com/intent/post?text=${encodeURIComponent(label)}&url=${encodeURIComponent(url)}`,
    line: `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`
  }
}

export function ShareMenu({ title, author, url, onClose }: {
  title: string
  author: string | null
  url: string
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const links = shareUrls(title, author, url)

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

  const open = (target: string): void => {
    window.open(target, '_blank', 'noopener,noreferrer')
    onClose()
  }

  return (
    <div ref={ref} className="share-menu" role="menu" aria-label="作品を共有">
      <button autoFocus type="button" role="menuitem" onClick={() => open(links.x)}>Xに投稿</button>
      <button type="button" role="menuitem" onClick={() => open(links.line)}>LINEで共有</button>
      <button type="button" role="menuitem" aria-live="polite" onClick={() => {
        void window.aozora.copyText(url).then(() => setCopied(true)).catch(() => undefined)
      }}>
        {copied ? 'コピーしました' : '作品のリンクをコピー'}
      </button>
    </div>
  )
}
