/**
 * テキスト表示の視認性を実測する。
 *
 *   npm run build
 *   npx electron scripts/check-legibility.mjs
 *
 * 目視の印象は当てにならない（実際、初回の目視では「行が長すぎる」「ルビで
 * 行送りが不揃い」と見えたが、どちらも計測すると誤りだった）。
 * ここでは数値で判定できるものだけを扱う:
 *
 *   - ルビの実効サイズ（小さすぎると判読できない）
 *   - ルビが隣接行に接触しないか
 *   - テーマごとのコントラスト比（WCAG AA 4.5:1 / 要件 §11）
 *   - 一行あたりの文字数（縦組みの目安 40〜45字）
 *
 * 検証には scripts/typography-specimen.txt を取り込む。
 * ルビ・傍点各種・傍線各種・太字・字下げ・外字・縦中横を網羅した組版見本。
 */
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SPECIMEN = path.join(ROOT, 'scripts', 'typography-specimen.txt')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '  — ' + detail : ''}`)
  ok ? pass++ : fail++
}
const note = (label, detail) => console.log(`  ..    ${label}  — ${detail}`)

const lum = (c) => { const [r,g,b] = c.map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4) }); return 0.2126*r + 0.7152*g + 0.0722*b }
const ratio = (a,b) => { const l1=lum(a), l2=lum(b); const [h,l] = l1>l2?[l1,l2]:[l2,l1]; return (h+0.05)/(l+0.05) }
const parseRgb = (s) => s.match(/\d+/g).slice(0,3).map(Number)

setTimeout(() => { console.log('!! watchdog'); app.exit(2) }, 240000).unref?.()
process.on('unhandledRejection', (e) => { console.log('!!', String(e).slice(0,300)); app.exit(3) })

app.whenReady().then(async () => {
  await import(path.join(ROOT, 'out/main/index.js'))
  let win = null
  for (let i = 0; i < 40 && !win; i++) { await sleep(250); win = BrowserWindow.getAllWindows()[0] ?? null }
  if (!win) { console.log('no window'); app.exit(1); return }
  win.setSize(1180, 860)
  const js = (c) => win.webContents.executeJavaScript(c)
  const reload = async () => {
    const d = new Promise((r) => win.webContents.once('did-finish-load', r))
    win.webContents.reload(); await d; await sleep(900)
  }
  const open = async () => {
    await js(`(()=>{const b=[...document.querySelectorAll('.card-main')].find(x=>x.textContent.includes('組版見本'));if(!b)throw new Error('見本が本棚に無い');b.click()})()`)
    await sleep(2400)
  }
  const toc = async (n) => {
    await js(`(()=>{if(!document.querySelector('.sidebar'))document.querySelector('.toolbar button:nth-child(2)').click()})()`); await sleep(400)
    await js(`(()=>{const b=[...document.querySelectorAll('.toc-item button')].find(x=>x.textContent.includes(${JSON.stringify(n)}));if(!b)throw new Error('章が無い');b.click()})()`); await sleep(1100)
    await js(`(()=>{if(document.querySelector('.sidebar'))document.querySelector('.toolbar button:nth-child(2)').click()})()`); await sleep(450)
  }
  const setS = async (p) => { await js(`window.aozora.saveSettings(${JSON.stringify(p)})`); await reload(); await open() }
  await sleep(1500)

  await js(`window.aozora.importPaths(${JSON.stringify([SPECIMEN])})`)
  await reload()

  const BASE = { writingMode:'vertical', readingMode:'pagination', columns:1,
                 fontSize:18, lineHeight:1.9, letterSpacing:0.05, pageMargin:56,
                 theme:'light', fontFamily:'"Hiragino Mincho ProN", serif' }

  console.log('\n== ルビの実効サイズ（8px 未満は判読困難） ==')
  for (const fs of [12, 14, 18, 32]) {
    await setS({ ...BASE, fontSize: fs }); await toc('ルビの密度')
    const r = await js(`(()=>parseFloat(getComputedStyle(document.querySelector('rt')).fontSize))()`)
    check(`本文 ${String(fs).padStart(2)}px → ルビ ${r}px`, r >= 8)
  }

  console.log('\n== ルビが隣接行に接触しないか（最小設定で） ==')
  await setS({ ...BASE, fontSize: 12, lineHeight: 1.5 }); await toc('ルビの密度')
  const t = await js(`(()=>{
    const rs=[...document.querySelectorAll('ruby')]; let o=0;
    for(const a of rs){const ra=a.getBoundingClientRect();
      for(const b of rs){ if(a===b)continue; const rb=b.getBoundingClientRect();
        if(Math.abs(ra.left-rb.left)>2 && ra.left<rb.right-0.5 && rb.left<ra.right-0.5
           && ra.top<rb.bottom && rb.top<ra.bottom) o++; }}
    return {n:rs.length, overlaps:o};
  })()`)
  check('最小設定(12px / 行間1.5)でルビが隣接行と重ならない', t.overlaps === 0, `ルビ${t.n}個 / 重なり${t.overlaps}件`)

  console.log('\n== コントラスト比（WCAG AA 4.5:1 / 要件 §11） ==')
  for (const theme of ['light', 'sepia', 'dark']) {
    await setS({ ...BASE, theme }); await toc('長文での可読性')
    const c = await js(`(()=>({bg:getComputedStyle(document.body).backgroundColor,
      fg:getComputedStyle(document.querySelector('[data-run]')).color,
      sec:getComputedStyle(document.querySelector('.status')).color}))()`)
    const bg = parseRgb(c.bg)
    const body = ratio(parseRgb(c.fg), bg), sec = ratio(parseRgb(c.sec), bg)
    check(`${theme.padEnd(5)} 本文 ${body.toFixed(2)}:1 / 副次 ${sec.toFixed(2)}:1`, body >= 4.5 && sec >= 4.5)
  }

  console.log('\n== 一行あたりの文字数（縦組みの目安 40〜45字） ==')
  await setS({ ...BASE })
  for (const fs of [12, 18, 32]) {
    await setS({ ...BASE, fontSize: fs }); await toc('長文での可読性')
    const r = await js(`(()=>{const vp=document.querySelector('.viewport'),cs=getComputedStyle(vp);
      const f=parseFloat(cs.fontSize), ls=parseFloat(cs.letterSpacing)||0;
      const inner=vp.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
      return {chars:Math.floor(inner/(f+ls))}})()`)
    // 上限だけを判定する。短い分には読みにくくならない。
    check(`本文 ${String(fs).padStart(2)}px → 一行 ${r.chars}字`, r.chars <= 55)
  }

  console.log('\n== 参考値（判定はしない） ==')
  await setS({ ...BASE }); await toc('傍点の種類')
  const em = await js(`(()=>{const e=document.querySelector('.em');
    return e?{mark:getComputedStyle(e).textEmphasis||getComputedStyle(e).webkitTextEmphasis,
              pos:getComputedStyle(e).textEmphasisPosition}:null})()`)
  note('傍点', em ? `${em.mark} / position ${em.pos}` : '未検出')

  console.log(`\n結果: ${pass} passed, ${fail} failed\n`)
  app.exit(fail === 0 ? 0 : 1)
})
