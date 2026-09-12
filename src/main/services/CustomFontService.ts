import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { CustomFontDto } from '@shared/ipc'

const FORMATS = new Set(['ttf', 'otf', 'woff', 'woff2'])

export class CustomFontService {
  private readonly manifestPath: string

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true })
    this.manifestPath = join(directory, 'fonts.json')
  }

  list(): CustomFontDto[] {
    if (!existsSync(this.manifestPath)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.manifestPath, 'utf8')) as CustomFontDto[]
      return parsed.filter((font) => this.validId(font.id) && FORMATS.has(font.format)).map((font) => {
        const path = this.path(font)
        if (!existsSync(path)) return { ...font, error: 'ファイルが見つかりません' }
        try {
          return hasFontSignature(readFileSync(path), font.format)
            ? { ...font, error: undefined }
            : { ...font, error: 'フォントファイルが壊れています' }
        } catch {
          return { ...font, error: 'フォントファイルを読み込めません' }
        }
      })
    } catch {
      return []
    }
  }

  import(paths: string[]): CustomFontDto[] {
    const fonts = this.list()
    for (const source of paths) {
      const format = extname(source).slice(1).toLowerCase()
      if (!FORMATS.has(format)) continue
      if (!hasFontSignature(readFileSync(source), format as CustomFontDto['format'])) {
        throw new Error(`${basename(source)} は有効なフォントファイルではありません。`)
      }
      const id = randomUUID()
      const fileName = `${id}.${format}`
      const baseName = basename(source, extname(source)) || '追加フォント'
      const displayName = uniqueName(baseName, fonts)
      const font = { id, displayName, fileName, format: format as CustomFontDto['format'] }
      copyFileSync(source, this.path(font))
      fonts.push(font)
    }
    this.save(fonts)
    return fonts
  }

  rename(id: string, rawName: string): CustomFontDto[] {
    this.assertId(id)
    const fonts = this.list()
    const font = fonts.find((item) => item.id === id)
    if (!font) throw new Error('フォントが見つかりませんでした。')
    const name = rawName.trim()
    if (!name) throw new Error('フォント名を入力してください。')
    font.displayName = uniqueName(name, fonts.filter((item) => item.id !== id))
    this.save(fonts)
    return fonts
  }

  delete(id: string): CustomFontDto[] {
    this.assertId(id)
    const fonts = this.list()
    const font = fonts.find((item) => item.id === id)
    if (!font) throw new Error('フォントが見つかりませんでした。')
    if (existsSync(this.path(font))) unlinkSync(this.path(font))
    const remaining = fonts.filter((item) => item.id !== id)
    this.save(remaining)
    return remaining
  }

  data(id: string): Uint8Array {
    this.assertId(id)
    const font = this.list().find((item) => item.id === id)
    if (!font) throw new Error('フォントが見つかりませんでした。')
    if (font.error) throw new Error(font.error)
    return new Uint8Array(readFileSync(this.path(font)))
  }

  private path(font: Pick<CustomFontDto, 'fileName'>): string {
    return join(this.directory, basename(font.fileName))
  }

  private validId(id: string): boolean {
    return /^[0-9a-f-]{36}$/i.test(id)
  }

  private assertId(id: string): void {
    if (!this.validId(id)) throw new Error('不正なフォントIDです。')
  }

  private save(fonts: CustomFontDto[]): void {
    const stored = fonts.map(({ error: _error, ...font }) => font)
    writeFileSync(this.manifestPath, JSON.stringify(stored, null, 2), 'utf8')
  }
}

function uniqueName(base: string, fonts: CustomFontDto[]): string {
  const names = new Set(fonts.map((font) => font.displayName))
  if (!names.has(base)) return base
  let suffix = 2
  while (names.has(`${base} (${suffix})`)) suffix += 1
  return `${base} (${suffix})`
}

function hasFontSignature(bytes: Uint8Array, format: CustomFontDto['format']): boolean {
  if (bytes.length < 4) return false
  const signature = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  if (format === 'woff') return signature === 'wOFF'
  if (format === 'woff2') return signature === 'wOF2'
  if (format === 'otf') return signature === 'OTTO'
  return signature === '\u0000\u0001\u0000\u0000' || signature === 'true' || signature === 'typ1'
}
