import { useEffect, useState, type JSX } from 'react'
import type { Book, BookSummary } from '@shared/model/document'

export function AuthorPopover({ book, onOpenBook, onClose }: {
  book: Book
  onOpenBook?: (bookId: string) => void
  onClose: () => void
}): JSX.Element {
  const [sameAuthor, setSameAuthor] = useState<BookSummary[]>([])
  useEffect(() => {
    void window.aozora.listBooks().then((items) => setSameAuthor(
      items.filter((item) => item.author === book.author && item.id !== book.id)
    ))
  }, [book.id, book.author])
  return (
    <aside className="author-popover" role="dialog" aria-label="著者情報">
      <div className="dictionary-head"><strong>{book.author ?? '著者不明'}</strong><button className="ghost" onClick={onClose}>×</button></div>
      {book.metadata.authorKana && <p className="muted">{book.metadata.authorKana}</p>}
      {book.metadata.aozoraUrl && <a href={book.metadata.aozoraUrl} target="_blank" rel="noreferrer">青空文庫の図書カード</a>}
      <h3>本棚にある同じ著者の作品</h3>
      {sameAuthor.length === 0 ? <p className="muted">ほかの作品はありません。</p> : (
        <ul>{sameAuthor.map((item) => <li key={item.id}><button className="ghost" onClick={() => onOpenBook?.(item.id)}>{item.title}</button></li>)}</ul>
      )}
    </aside>
  )
}
