import { useMemo, useState, type JSX } from 'react'
import { useAnnotationsStore } from '../state/useAnnotationsStore'
import { useReaderStore, type SidebarTab } from '../state/useReaderStore'
import type { TextPosition } from '@shared/model/position'
import { MOD } from '../platform'

interface Props {
  onJump: (position: TextPosition) => void
}

const TABS: Array<[SidebarTab, string]> = [
  ['annotations', '全'], ['bookmarks', '栞'], ['highlights', '線'], ['notes', '記']
]

export function AnnotationsPanel({ onJump }: Props): JSX.Element {
  const reader = useReaderStore()
  const annotations = useAnnotationsStore()
  const [order, setOrder] = useState<'text' | 'created'>('text')
  // window.prompt は Electron で使えないので、名前の変更もこの場で編集する。
  const [editing, setEditing] = useState<{ kind: 'note' | 'bookmark'; id: string } | null>(null)
  const [draft, setDraft] = useState('')
  const index = reader.index

  const compare = useMemo(() => (a: TextPosition, b: TextPosition): number => {
    if (order === 'created' || !index) return 0
    const ae = index.byBlockId.get(a.blockId)
    const be = index.byBlockId.get(b.blockId)
    return (ae?.order ?? Number.MAX_SAFE_INTEGER) - (be?.order ?? Number.MAX_SAFE_INTEGER) || a.offset - b.offset
  }, [index, order])

  const bookmarks = [...annotations.bookmarks].sort((a, b) =>
    order === 'created' ? a.createdAt.localeCompare(b.createdAt) : compare(a.position, b.position))
  const highlights = [...annotations.highlights].sort((a, b) =>
    order === 'created' ? a.createdAt.localeCompare(b.createdAt) : compare(a.range.start, b.range.start))
  const notes = [...annotations.notes].sort((a, b) => {
    if (order === 'created') return a.createdAt.localeCompare(b.createdAt)
    const ap = a.range?.start ?? a.position
    const bp = b.range?.start ?? b.position
    return ap && bp ? compare(ap, bp) : 0
  })
  const all = [
    ...bookmarks.map((item) => ({ id: item.id, kind: '栞', text: item.label, position: item.position, createdAt: item.createdAt })),
    ...highlights.map((item) => ({ id: item.id, kind: '線', text: item.selectedText, position: item.orphaned ? null : item.range.start, createdAt: item.createdAt })),
    ...notes.map((item) => ({ id: item.id, kind: '記', text: item.text, position: item.range?.start ?? item.position, createdAt: item.createdAt }))
  ].sort((a, b) => order === 'created'
    ? a.createdAt.localeCompare(b.createdAt)
    : a.position && b.position ? compare(a.position, b.position) : 0)

  return (
    <div className="panel annotations-panel">
      <div className="annotation-tabs" role="tablist" aria-label="注釈の種類">
        {TABS.map(([tab, label]) => (
          <button key={tab} role="tab" aria-selected={reader.sidebarTab === tab}
            className={reader.sidebarTab === tab ? 'on' : ''}
            onClick={() => reader.setSidebarTab(tab)}>{label}</button>
        ))}
      </div>
      <label className="annotation-order">
        表示順
        <select value={order} onChange={(event) => setOrder(event.target.value as typeof order)}>
          <option value="text">本文順</option>
          <option value="created">作成日時順</option>
        </select>
      </label>
      {annotations.error && <p className="panel-error">{annotations.error}</p>}

      {reader.sidebarTab === 'annotations' && (
        <AnnotationList empty={`注釈はまだありません。本文を選択するか、${MOD}B で栞を追加できます。`}>
          {all.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="annotation-item all-item">
              <span className="annotation-kind">{item.kind}</span>
              <button className="annotation-jump" disabled={!item.position}
                onClick={() => item.position && onJump(item.position)}>{item.text}</button>
            </li>
          ))}
        </AnnotationList>
      )}

      {reader.sidebarTab === 'bookmarks' && (
        <AnnotationList empty={`栞はまだありません。${MOD}B で現在位置に追加できます。`}>
          {bookmarks.map((item) => (
            <li key={item.id} className="annotation-item bookmark-item">
              {editing?.kind === 'bookmark' && editing.id === item.id ? (
                <form onSubmit={(event) => {
                  event.preventDefault()
                  void annotations.updateBookmark(item.id, draft)
                  setEditing(null)
                }}>
                  <input value={draft} aria-label="栞の名前" autoFocus
                    onChange={(event) => setDraft(event.target.value)} />
                  <div className="annotation-actions">
                    <button>保存</button>
                    <button type="button" className="ghost" onClick={() => setEditing(null)}>取消</button>
                  </div>
                </form>
              ) : (
                <>
                  <button className="annotation-jump" onClick={() => onJump(item.position)}>{item.label}</button>
                  <div className="annotation-actions">
                    <button className="ghost" onClick={() => {
                      setDraft(item.label)
                      setEditing({ kind: 'bookmark', id: item.id })
                    }}>名前</button>
                    <button className="ghost" onClick={() => void annotations.deleteBookmark(item.id)}>削除</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </AnnotationList>
      )}

      {reader.sidebarTab === 'highlights' && (
        <AnnotationList empty="本文を選択するとハイライトできます。">
          {highlights.map((item) => (
            <li key={item.id} className={`annotation-item color-${item.color}`}>
              <button className="annotation-jump" disabled={item.orphaned}
                onClick={() => onJump(item.range.start)}>{item.selectedText || '（空の範囲）'}</button>
              {item.orphaned && <span className="orphan">本文位置を復旧できません</span>}
              <button className="ghost annotation-delete" onClick={() => void annotations.deleteHighlight(item.id)}>削除</button>
            </li>
          ))}
        </AnnotationList>
      )}

      {reader.sidebarTab === 'notes' && (
        <AnnotationList empty="本文の選択範囲または現在位置にメモを残せます。">
          {notes.map((item) => {
            const position = item.range?.start ?? item.position
            return (
              <li key={item.id} className="annotation-item note-item">
                {editing?.kind === 'note' && editing.id === item.id ? (
                  <form onSubmit={(event) => {
                    event.preventDefault()
                    void annotations.saveNote({ id: item.id, text: draft }).then(() => setEditing(null))
                  }}>
                    <textarea value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
                    <div className="annotation-actions"><button>保存</button><button type="button" className="ghost" onClick={() => setEditing(null)}>取消</button></div>
                  </form>
                ) : (
                  <>
                    <button className="annotation-jump" disabled={!position} onClick={() => position && onJump(position)}>{item.text}</button>
                    <div className="annotation-actions">
                      <button className="ghost" onClick={() => { setDraft(item.text); setEditing({ kind: 'note', id: item.id }) }}>編集</button>
                      <button className="ghost" onClick={() => void annotations.deleteNote(item.id)}>削除</button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </AnnotationList>
      )}
    </div>
  )
}

function AnnotationList({ children, empty }: { children: React.ReactNode; empty: string }): JSX.Element {
  const count = Array.isArray(children) ? children.length : children ? 1 : 0
  return count === 0
    ? <p className="panel-empty">{empty}</p>
    : <ul className="annotation-list">{children}</ul>
}
