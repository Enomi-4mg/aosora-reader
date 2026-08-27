/**
 * JIS X 0213:2004 コード表から 面区点 → Unicode の変換表を生成する。
 *
 * 出典: https://x0213.org/codetable/jisx0213-2004-std.txt
 *   Copyright (C) 2001 earthian@tama.or.jp / I'O
 *   Copyright (C) 2006, 2009 Project X0213
 *   "You can use, modify, distribute this table freely."
 *
 * 生成物 src/shared/data/gaiji-kuten.json はコミットする。
 * 実行時にネットワークへ出ないようにするため(要件 §15 ローカルファースト)。
 *
 * 使い方: node scripts/build-gaiji-table.mjs <入力ファイル>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:url'

const input = process.argv[2]
if (!input) {
  console.error('usage: node scripts/build-gaiji-table.mjs <jisx0213-2004-std.txt>')
  process.exit(1)
}

const text = readFileSync(input, 'utf8')
const table = {}
let skipped = 0

for (const line of text.split('\n')) {
  if (line.startsWith('#') || line.trim() === '') continue
  const [jis, uni] = line.split('\t')
  if (!jis || !uni || !uni.startsWith('U+')) {
    skipped++
    continue
  }

  // 3-XXXX = 1面, 4-XXXX = 2面。XXXX は GL 表現の JIS コード(16進)。
  const m = jis.match(/^([34])-([0-9A-Fa-f]{4})$/)
  if (!m) {
    skipped++
    continue
  }
  const men = m[1] === '3' ? 1 : 2
  const code = parseInt(m[2], 16)
  const ku = (code >> 8) - 0x20
  const ten = (code & 0xff) - 0x20
  if (ku < 1 || ku > 94 || ten < 1 || ten > 94) {
    skipped++
    continue
  }

  // 合成文字は U+xxxx+xxxx の形で書かれている
  const chars = uni
    .trim()
    .split('+')
    .filter((s) => s !== 'U')
    .map((h) => String.fromCodePoint(parseInt(h, 16)))
    .join('')

  table[`${men}-${ku}-${ten}`] = chars
}

const keys = Object.keys(table).sort((a, b) => {
  const pa = a.split('-').map(Number)
  const pb = b.split('-').map(Number)
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]
})
const sorted = {}
for (const k of keys) sorted[k] = table[k]

const out = new URL('../src/shared/data/gaiji-kuten.json', import.meta.url)
writeFileSync(out, JSON.stringify(sorted, null, 0) + '\n', 'utf8')
console.log(`wrote ${keys.length} entries (skipped ${skipped}) -> ${out.pathname}`)
