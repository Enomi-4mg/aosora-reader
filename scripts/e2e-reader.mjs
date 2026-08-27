/**
 * Reader の実機検証。要件 §17(Phase 1 完了条件)のうち、
 * jsdom では検証できない「ページ幾何が絡む項目」を実際の Electron 上で確認する。
 *
 *   npm run build
 *   npx electron scripts/e2e-reader.mjs <青空文庫ファイルを置いたディレクトリ>
 *
 * 実データは配布物に含めない。手元の .zip / .txt を指して使うこと。
 */
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SAMPLES = process.argv[process.argv.length - 1]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '  — ' + detail : ''}`)
  ok ? pass++ : fail++
}

setTimeout(() => { console.log('!! watchdog timeout'); app.exit(2) }, 180000).unref?.()
process.on('unhandledRejection', (e) => { console.log('!! ', String(e).slice(0, 300)); app.exit(3) })

app.whenReady().then(async () => {
  await import(path.join(ROOT, 'out/main/index.js'))
  let win = null
  for (let i = 0; i < 40 && !win; i++) { await sleep(250); win = BrowserWindow.getAllWindows()[0] ?? null }
  if (!win) { console.log('no window'); app.exit(1); return }
  const js = (c) => win.webContents.executeJavaScript(c)
  /** reload はフレーム破棄と競合するので、読み込み完了を待ってから触る。 */
  const reload = async () => {
    const done = new Promise((r) => win.webContents.once('did-finish-load', r))
    win.webContents.reload()
    await done
    await sleep(900)
  }
  await sleep(1500)

  const files = fs.readdirSync(SAMPLES).filter((f) => /\.(zip|txt)$/i.test(f))
  const zip = files.find((f) => f.endsWith('.zip'))
  const txt = files.find((f) => f.endsWith('.txt'))

  console.log('\n== インポート ==')
  if (zip) {
    const r = await js(`window.aozora.importPaths(${JSON.stringify([path.join(SAMPLES, zip)])})`)
    check('ZIPをインポートできる', ['imported', 'restored', 'duplicate'].includes(r[0]?.status), r[0]?.status)
  }
  if (txt) {
    const r = await js(`window.aozora.importPaths(${JSON.stringify([path.join(SAMPLES, txt)])})`)
    check('TXTをインポートできる', ['imported', 'restored', 'duplicate'].includes(r[0]?.status), r[0]?.status)
  }
  const broken = path.join(SAMPLES, '.broken-test.zip')
  fs.writeFileSync(broken, Buffer.from('PK\x03\x04garbage'))
  const br = await js(`window.aozora.importPaths(${JSON.stringify([broken])})`)
  fs.unlinkSync(broken)
  check('壊れたZIPでクラッシュしない', br[0]?.status === 'error' && (await js(`!!document.querySelector('.library')`)))

  await reload()
  const books = await js('window.aozora.listBooks()')
  check('本棚に作品が並ぶ', books.length > 0, `${books.length}冊`)
  // 位置保持の検証は「本文の途中」でこそ意味があるので、いちばん長い作品を使う
  const target = [...books].sort((a, b) => b.totalCharacters - a.totalCharacters)[0]
  console.log(`  (検証対象: ${target.title} / ${target.totalCharacters}字)`)

  console.log('\n== 本文表示 ==')
  await js(`window.aozora.saveSettings({writingMode:'vertical',readingMode:'pagination',columns:1,fontSize:18,theme:'light'})`)
  await reload()
  const openTarget = async () => {
    await js(`(()=>{const b=[...document.querySelectorAll('.card-main')].find(x=>x.textContent.includes(${JSON.stringify(target.title)}));if(!b)throw new Error('card not found');b.click()})()`)
    await sleep(2600)
  }
  await openTarget()

  const st = () => js(`(()=>{const vp=document.querySelector('.viewport'),c=document.querySelector('.content');
    return {wm:getComputedStyle(vp).writingMode, extent:[c.scrollWidth,c.scrollHeight],
      pages:document.querySelector('.status .muted')?.textContent,
      pct:document.querySelector('.status-progress').textContent,
      tf:c.style.transform||'none', rubies:c.querySelectorAll('ruby').length,
      runs:c.querySelectorAll('[data-run]').length}})()`)
  const savedPos = () => js(`(async()=>{const r=await window.aozora.openBook(${JSON.stringify(target.id)});return r.progress?.position})()`)

  let s = await st()
  check('縦書きで表示される', s.wm === 'vertical-rl')
  check('ルビが描画される', s.rubies > 0, `${s.rubies}個`)
  check('本文が run に分割される', s.runs > 0, `${s.runs}個`)

  console.log('\n== ページ送りと位置 ==')
  const pagesNow = async () => {
    const t = await js(`document.querySelector('.status .muted')?.textContent ?? '1 / 1'`)
    const [a, b] = t.split('/').map((x) => Number(x.trim()))
    return { cur: a, total: b }
  }

  // ページ数の多い章を目次から探す。章末で検証すると位置がずれても気づけない。
  await js(`document.querySelector('.toolbar button:nth-child(2)').click()`); await sleep(500)
  const tocN = await js(`document.querySelectorAll('.toc-item button').length`)
  let found = false
  for (let i = 0; i < Math.min(tocN, 30) && !found; i++) {
    await js(`document.querySelectorAll('.toc-item button')[${i}].click()`)
    await sleep(900)
    const { total } = await pagesNow()
    // 3ページあれば「両端でない内側のページ」が必ず存在する
    if (total >= 3) found = true
  }
  const before0 = await pagesNow()
  check('内側のページを持つ章を見つけられた', found, `${before0.total}ページ`)

  // 章の中ほどまで進める
  const want = Math.floor(before0.total / 2)
  for (let i = 0; i < want; i++) { await js(`document.querySelector('.page-zone.next').click()`); await sleep(280) }
  await sleep(1000)

  const moved = await st()
  const { cur, total } = await pagesNow()
  check('ページ送りできる', moved.tf !== 'none' && moved.tf !== 'translateY(0px)', moved.pages)
  check('検証位置が章の途中である(両端ではない)', cur > 1 && cur < total, `${cur} / ${total}`)
  const p1 = await savedPos()
  check('読書位置がTextPositionで保存される', !!p1 && typeof p1.offset === 'number', JSON.stringify(p1))

  // フォント変更・組み方変更・リサイズで同じ位置に留まるか
  for (const [label, patch] of [
    ['文字サイズ変更後も同じ位置', { fontSize: 26 }],
    ['行間変更後も同じ位置', { lineHeight: 2.4 }],
    ['横書き切替後も同じ位置', { writingMode: 'horizontal' }],
    ['2段組でも同じ位置', { columns: 2 }],
    ['縦書きに戻しても同じ位置', { writingMode: 'vertical', columns: 1 }]
  ]) {
    const before = await savedPos()
    await js(`window.aozora.saveSettings(${JSON.stringify(patch)})`)
    await js(`(async()=>{const m=await import('/dev/null').catch(()=>null);})()`).catch(() => {})
    // 設定は store 経由で反映させる
    await js(`(()=>{const ev=new CustomEvent('__noop');window.dispatchEvent(ev)})()`)
    await sleep(200)
    await reload()
    await openTarget()
    const after = await savedPos()
    const same = before && after && before.blockId === after.blockId && Math.abs(before.offset - after.offset) <= 2
    check(label, !!same, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  }

  console.log('\n== 表示モード ==')
  await js(`window.aozora.saveSettings({readingMode:'scroll'})`)
  await reload()
  await openTarget()
  const vis = await js(`(async()=>{
    const r=await window.aozora.openBook(${JSON.stringify(target.id)});const p=r.progress.position;
    const blk=document.querySelector('[data-block-id="'+p.blockId+'"]');
    if(!blk) return {visible:false,reason:'not rendered'};
    const el=blk.querySelector('[data-run]')||blk;
    const vp=document.querySelector('.viewport');
    const v=vp.getBoundingClientRect(), b=el.getBoundingClientRect();
    return {visible: b.bottom>v.top&&b.top<v.bottom&&b.right>v.left&&b.left<v.right,
            scroll:[Math.round(vp.scrollLeft),Math.round(vp.scrollTop)]}})()`)
  check('スクロール表示で保存位置が見えている', vis.visible, JSON.stringify(vis.scroll))

  console.log('\n== 目次・検索・テーマ ==')
  await js(`window.aozora.saveSettings({readingMode:'pagination'})`); await reload()
  await openTarget()
  await js(`document.querySelector('.toolbar button:nth-child(2)').click()`); await sleep(500)
  const tocCount = await js(`document.querySelectorAll('.toc-item').length`)
  check('目次が見出しから生成される', tocCount > 0, `${tocCount}項目`)
  if (tocCount > 1) {
    const chBefore = await js(`document.querySelector('.status-chapter').textContent`)
    await js(`document.querySelectorAll('.toc-item button')[Math.min(3,${tocCount}-1)].click()`); await sleep(1500)
    const chAfter = await js(`document.querySelector('.status-chapter').textContent`)
    check('目次から移動できる', chBefore !== chAfter, `${chBefore} -> ${chAfter}`)
  }

  const sr = await js(`window.aozora.searchBook(${JSON.stringify(target.id)},'先生')`)
  check('本文検索できる', sr.count > 0 && !sr.truncated, `${sr.count}件`)
  const srNone = await js(`window.aozora.searchBook(${JSON.stringify(target.id)},'該当しない語句zzz')`)
  check('該当なしを正しく返す', srNone.count === 0)

  const themes = {}
  await js(`document.querySelector('.toolbar button:last-child').click()`); await sleep(400)
  for (const name of ['ダーク', 'セピア', 'ライト']) {
    await js(`(()=>{[...document.querySelectorAll('.settings-overlay button')].find(x=>x.textContent==='${name}')?.click()})()`)
    await sleep(400)
    themes[name] = await js(`getComputedStyle(document.body).backgroundColor`)
  }
  const distinct = new Set(Object.values(themes)).size
  check('テーマを切り替えられる', distinct === 3, JSON.stringify(themes))

  console.log(`\n結果: ${pass} passed, ${fail} failed\n`)
  app.exit(fail === 0 ? 0 : 1)
})
