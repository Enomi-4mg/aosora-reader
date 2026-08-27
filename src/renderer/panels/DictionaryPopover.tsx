import type { DictionaryResult } from '@shared/model/annotations'
import type { JSX } from 'react'

export function DictionaryPopover({ result, loading, onClose }: {
  result: DictionaryResult | null
  loading: boolean
  onClose: () => void
}): JSX.Element {
  return (
    <aside className="dictionary-popover" role="dialog" aria-label="辞書">
      <div className="dictionary-head"><strong>{result?.term || '辞書を検索中'}</strong><button className="ghost" onClick={onClose}>×</button></div>
      {loading ? <p className="muted">意味を調べています…</p> : result?.definitions.length ? (
        <ol>{result.definitions.map((definition, index) => <li key={index}>{definition}</li>)}</ol>
      ) : <p className="muted">語義が見つかりませんでした。ネットワーク接続を確認してください。</p>}
      {result?.sourceUrl && <a href={result.sourceUrl} target="_blank" rel="noreferrer">{result.source}で開く</a>}
    </aside>
  )
}
