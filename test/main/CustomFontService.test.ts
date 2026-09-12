import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { CustomFontService } from '../../src/main/services/CustomFontService'

describe('CustomFontService', () => {
  it('フォントを保存し、重複表示名を連番にして、名称変更と削除ができる', () => {
    const root = mkdtempSync(join(tmpdir(), 'aozora-font-'))
    const first = join(root, 'sample.ttf')
    const secondDir = mkdtempSync(join(tmpdir(), 'aozora-font-source-'))
    const second = join(secondDir, 'sample.ttf')
    const fontBytes = Buffer.from([0, 1, 0, 0, 1, 2, 3])
    writeFileSync(first, fontBytes)
    writeFileSync(second, fontBytes)
    const service = new CustomFontService(join(root, 'managed'))

    const imported = service.import([first, second])
    expect(imported.map((font) => font.displayName)).toEqual(['sample', 'sample (2)'])
    expect(service.data(imported[0]!.id)).toEqual(new Uint8Array(fontBytes))
    expect(readFileSync(join(root, 'managed', imported[0]!.fileName))).toEqual(fontBytes)

    expect(service.rename(imported[0]!.id, '本文明朝')[0]!.displayName).toBe('本文明朝')
    expect(service.delete(imported[0]!.id)).toHaveLength(1)
  })

  it('破損ファイルと不正IDを拒否する', () => {
    const root = mkdtempSync(join(tmpdir(), 'aozora-font-'))
    const broken = join(root, 'broken.otf')
    writeFileSync(broken, 'not-a-font')
    const service = new CustomFontService(join(root, 'managed'))
    expect(() => service.import([broken])).toThrow('有効なフォントファイルではありません')
    expect(() => service.data('../secret')).toThrow('不正なフォントID')
  })
})
