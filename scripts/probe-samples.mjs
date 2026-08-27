/**
 * 実ファイル検査ツール。青空文庫の ZIP を集めたディレクトリを渡すと、
 * パース結果の統計と「不変条件 A(オフセット整合性)」の検証結果を出力する。
 *
 * 使い方: npx vite-node scripts/probe-samples.mjs <zipを置いたディレクトリ>
 *
 * 実データは配布物に含めない。手元の青空文庫ファイルを指して使うこと。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { parseAozora } from '../src/shared/parser/index.ts'

const dir = process.argv[2]
for (const f of readdirSync(dir).filter((x) => x.endsWith('.zip'))) {
  const files = unzipSync(new Uint8Array(readFileSync(`${dir}/${f}`)))
  const [name, bytes] = Object.entries(files).find(([n]) => /\.txt$/i.test(n))
  const text = new TextDecoder('shift_jis').decode(bytes)
  const t0 = performance.now()
  const r = parseAozora(text)
  const ms = (performance.now() - t0).toFixed(0)

  const blocks = r.chapters.flatMap((c) => c.blocks)
  const kinds = {}
  const walk = (ns) => ns.forEach((n) => {
    kinds[n.kind] = (kinds[n.kind] ?? 0) + 1
    if (n.children) walk(n.children)
  })
  blocks.forEach((b) => walk(b.children))

  const issueKinds = {}
  for (const i of r.issues) issueKinds[i.kind] = (issueKinds[i.kind] ?? 0) + 1

  // 不変条件 A の検証: 全 InlineNode の [start,end) が plainText と整合するか
  let bad = 0
  for (const b of blocks) {
    const check = (ns, lo, hi) => ns.forEach((n) => {
      if (n.start < lo || n.end > hi || n.end < n.start) bad++
      if (n.kind === 'text' && b.plainText.slice(n.start, n.end) !== n.text) bad++
      if (n.kind === 'ruby' && b.plainText.slice(n.start, n.end) !== n.baseText) bad++
      if (n.kind === 'note' && n.start !== n.end) bad++
      if (n.children) check(n.children, n.start, n.end)
    })
    check(b.children, 0, b.plainText.length)
  }
  const sumChars = r.chapters.reduce((a, c) => a + c.characterCount, 0)

  console.log(`\n=== ${name} (${(text.length/1000).toFixed(0)}k chars, parse ${ms}ms) ===`)
  console.log(`  題名: ${r.title} / 著者: ${r.author}${r.translator ? ' / 訳: '+r.translator : ''}`)
  console.log(`  章: ${r.chapters.length}  ブロック: ${blocks.length}  総文字数: ${r.totalCharacters}`)
  console.log(`  目次: ${r.chapters.slice(0,6).map(c=>c.title).join(' | ')}${r.chapters.length>6?' | …':''}`)
  console.log(`  InlineNode: ${JSON.stringify(kinds)}`)
  console.log(`  issues(${r.issues.length}): ${JSON.stringify(issueKinds)}`)
  console.log(`  オフセット不整合: ${bad}   章文字数合計一致: ${sumChars === r.totalCharacters}`)
  console.log(`  本文冒頭: ${blocks.map(b=>b.plainText).filter(Boolean)[1]?.slice(0,50)}`)
  if (r.issues.length) {
    const uniq = [...new Map(r.issues.map(i=>[i.message,i])).values()].slice(0,5)
    uniq.forEach(i => console.log(`    · [${i.kind}] ${i.message.slice(0,80)}`))
  }
}
