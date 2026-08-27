import { describe, expect, it } from 'vitest'
import { WiktionaryProvider } from '../../src/main/services/DictionaryService'

describe('WiktionaryProvider', () => {
  it('API 応答を共通 DictionaryResult に変換する', async () => {
    const provider = new WiktionaryProvider(async () => ({
      query: { pages: { '1': { extract: '猫\n哺乳類の一種。\n= 関連語 =\nねこ。' } } }
    }))
    await expect(provider.search(' 猫 ')).resolves.toMatchObject({
      term: '猫', definitions: ['猫', '哺乳類の一種。', 'ねこ。'], source: '日本語版Wiktionary'
    })
  })
})
