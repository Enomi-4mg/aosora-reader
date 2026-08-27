/**
 * SQLite 接続。Node 組み込みの `node:sqlite` を使う。
 * M0 で Electron 44 の main プロセスでの動作を実測済み(SQLite 3.53.1 / FTS5 trigram 可)。
 * ネイティブモジュールが要らないので electron-rebuild も不要。
 */
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type Db = DatabaseSync

export function openDatabase(filename: string): Db {
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA synchronous = NORMAL')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const current = row?.user_version ?? 0

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${m.version}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(
        `マイグレーション ${m.version} (${m.name}) に失敗しました: ${
          e instanceof Error ? e.message : String(e)
        }`
      )
    }
  }
}

/** 複数の書き込みを1トランザクションにまとめる。 */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
