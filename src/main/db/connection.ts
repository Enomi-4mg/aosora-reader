/**
 * SQLite 接続。Node 組み込みの `node:sqlite` を使う。
 * M0 で Electron 44 の main プロセスでの動作を実測済み(SQLite 3.53.1 / FTS5 trigram 可)。
 * ネイティブモジュールが要らないので electron-rebuild も不要。
 */
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type Db = DatabaseSync

/** この版が扱えるスキーマの最大版。 */
export const SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)

/**
 * ライブラリが、このアプリより新しい版で作られていた。
 *
 * 配布を始めると、新しい版を一度入れたあとで古い版に戻すことが普通に起こる。
 * (インストーラを取り直した、別の端末から古い版をコピーした、など)
 * MIGRATIONS は前方にしか進まないので、古い版はそのスキーマへ移行できない。
 * それでも起動だけはできてしまうのが危ないところで、知らないカラムを無視したまま
 * 書き込みが走ると、新しい版へ戻したときに取り返せない。黙って進むより止める。
 */
export class SchemaTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number
  ) {
    super(
      `この本棚は新しい版の青空Readerで作られています` +
        `(データ版 ${found} / この版が読めるのは ${supported} まで)。` +
        `青空Readerを最新版に更新してから開いてください。`
    )
    this.name = 'SchemaTooNewError'
  }
}

export function openDatabase(filename: string): Db {
  const db = new DatabaseSync(filename)
  try {
    // PRAGMA を当てる前に見る。開けないと分かっているファイルは触らない。
    assertNotNewer(db)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA synchronous = NORMAL')
    migrate(db)
  } catch (e) {
    // 開いたままだと WAL のロックが残る。閉じてから投げ直す。
    db.close()
    throw e
  }
  return db
}

export function migrate(db: Db): void {
  const current = userVersion(db)
  assertNotNewer(db)

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

function userVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row?.user_version ?? 0
}

function assertNotNewer(db: Db): void {
  const current = userVersion(db)
  if (current > SCHEMA_VERSION) throw new SchemaTooNewError(current, SCHEMA_VERSION)
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
