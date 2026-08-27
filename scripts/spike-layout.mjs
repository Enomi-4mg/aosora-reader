// M0 spike: 縦書き/横書きにおける multicolumn のオーバーフロー軸を実測する。
// 計画 §1「不変条件 B」の唯一の未検証前提を潰すのが目的。
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))

app.whenReady().then(async () => {
  // (1) Electron main で node:sqlite が使えるか
  let sqliteReport
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(':memory:')
    const v = db.prepare('select sqlite_version() v').get().v
    let fts = 'no'
    try {
      db.exec("CREATE VIRTUAL TABLE t USING fts5(body, tokenize='trigram')")
      fts = 'yes'
    } catch {}
    sqliteReport = { available: true, version: v, fts5Trigram: fts }
  } catch (e) {
    sqliteReport = { available: false, error: e.message }
  }
  console.log('NODE_SQLITE ' + JSON.stringify(sqliteReport))

  const win = new BrowserWindow({ width: 900, height: 700, show: false })
  await win.loadFile(path.join(dir, 'spike-layout.html'))
  const result = await win.webContents.executeJavaScript('window.__runSpike()')
  console.log('SPIKE ' + JSON.stringify(result, null, 2))
  app.quit()
})
