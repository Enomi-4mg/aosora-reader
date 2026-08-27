import { unzipSync } from 'fflate'
import type { AozoraCatalogWork } from '@shared/ipc'
import type { ImportService, ImportOutcome } from './ImportService'

const CATALOG_URL =
  'https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip'
const MAX_RESULTS = 80
const ALLOWED_HOSTS = new Set(['www.aozora.gr.jp', 'aozora.gr.jp'])

type FetchBytes = (url: string) => Promise<Uint8Array>

interface CatalogEntry extends AozoraCatalogWork {
  textUrl: string
  searchText: string
}

/** 青空文庫の公式公開カタログを検索し、作品 ZIP を既存の ImportService へ渡す。 */
export class AozoraCatalogService {
  private catalogPromise: Promise<CatalogEntry[]> | null = null

  constructor(
    private readonly importer: ImportService,
    private readonly fetchBytes: FetchBytes
  ) {}

  async search(query: string): Promise<AozoraCatalogWork[]> {
    const needle = normalize(query)
    if (needle.length < 2) return []

    const entries = await this.catalog()
    return entries
      .filter((entry) => entry.searchText.includes(needle))
      .sort((a, b) => score(a, needle) - score(b, needle) || a.title.localeCompare(b.title, 'ja'))
      .slice(0, MAX_RESULTS)
      .map(({ textUrl: _textUrl, searchText: _searchText, ...work }) => work)
  }

  async download(workId: string): Promise<ImportOutcome> {
    const entry = (await this.catalog()).find((work) => work.id === workId)
    if (!entry) {
      return { status: 'error', path: workId, message: '作品が公式カタログに見つかりません。' }
    }

    assertOfficialUrl(entry.textUrl)
    const bytes = await this.fetchBytes(entry.textUrl)
    return this.importer.importBytes(bytes, entry.textUrl, entry.title)
  }

  private catalog(): Promise<CatalogEntry[]> {
    if (!this.catalogPromise) {
      this.catalogPromise = this.loadCatalog().catch((error) => {
        this.catalogPromise = null
        throw error
      })
    }
    return this.catalogPromise
  }

  private async loadCatalog(): Promise<CatalogEntry[]> {
    const archive = await this.fetchBytes(CATALOG_URL)
    const files = unzipSync(archive)
    const csvName = Object.keys(files).find((name) => name.toLowerCase().endsWith('.csv'))
    if (!csvName || !files[csvName]) throw new Error('青空文庫の作品カタログを読み取れません。')
    return parseAozoraCatalog(new TextDecoder('utf-8').decode(files[csvName]))
  }
}

/** 公式CSVは著者・翻訳者ごとに同じ作品が複数行になるため、作品IDで集約する。 */
export function parseAozoraCatalog(csv: string): CatalogEntry[] {
  const rows = parseCsv(csv.replace(/^\uFEFF/, ''))
  const header = rows.shift()
  if (!header) return []
  const col = new Map(header.map((name, index) => [name, index]))
  const value = (row: string[], name: string): string => row[col.get(name) ?? -1] ?? ''
  const grouped = new Map<string, CatalogEntry & { authors: Set<string>; translators: Set<string> }>()

  for (const row of rows) {
    const id = value(row, '作品ID')
    const title = value(row, '作品名')
    const textUrl = value(row, 'テキストファイルURL')
    if (!id || !title || !textUrl) continue
    try {
      assertOfficialUrl(textUrl)
    } catch {
      continue
    }

    const name = [value(row, '姓'), value(row, '名')].filter(Boolean).join(' ')
    const role = value(row, '役割フラグ')
    let entry = grouped.get(id)
    if (!entry) {
      entry = {
        id,
        title,
        titleKana: value(row, '作品名読み'),
        author: '',
        publishedAt: value(row, '公開日'),
        cardUrl: value(row, '図書カードURL'),
        textUrl,
        searchText: '',
        authors: new Set(),
        translators: new Set()
      }
      grouped.set(id, entry)
    }
    if (name && role === '著者') entry.authors.add(name)
    if (name && role === '翻訳者') entry.translators.add(name)
  }

  return Array.from(grouped.values(), (entry) => {
    const authorParts = [...entry.authors]
    if (entry.translators.size > 0) authorParts.push(`${[...entry.translators].join('・')} 訳`)
    entry.author = authorParts.join(' / ') || '著者不明'
    entry.searchText = normalize([entry.title, entry.titleKana, entry.author, entry.id].join(' '))
    const { authors: _authors, translators: _translators, ...plain } = entry
    return plain
  })
}

function assertOfficialUrl(raw: string): void {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error('青空文庫以外のURLはダウンロードできません。')
  }
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[\s・]+/g, '')
}

function score(entry: CatalogEntry, needle: string): number {
  const title = normalize(entry.title)
  const author = normalize(entry.author)
  if (title === needle) return 0
  if (title.startsWith(needle)) return 1
  if (author.startsWith(needle)) return 2
  return 3
}

/** RFC 4180相当。底本情報にカンマや改行が入っても列を崩さない。 */
function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows
}
