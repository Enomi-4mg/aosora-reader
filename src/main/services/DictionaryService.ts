import type { DictionaryResult } from '@shared/model/annotations'

type FetchJson = (url: string) => Promise<unknown>

/** Provider 境界。将来 OS 辞書やローカル辞書へ差し替えられる。 */
export interface DictionaryProvider {
  search(term: string): Promise<DictionaryResult>
}

export class WiktionaryProvider implements DictionaryProvider {
  constructor(private readonly fetchJson: FetchJson) {}

  async search(rawTerm: string): Promise<DictionaryResult> {
    const term = rawTerm.trim().slice(0, 80)
    if (!term) return { term: '', definitions: [], source: 'Wiktionary' }
    const url = `https://ja.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(term)}`
    const data = await this.fetchJson(url) as {
      query?: { pages?: Record<string, { extract?: string }> }
    }
    const extract = Object.values(data.query?.pages ?? {})[0]?.extract ?? ''
    const definitions = extract.split(/\n+/).map((line) => line.trim())
      .filter((line) => line && !/^=+/.test(line)).slice(0, 6)
    return { term, definitions, source: '日本語版Wiktionary', sourceUrl: `https://ja.wiktionary.org/wiki/${encodeURIComponent(term)}` }
  }
}
