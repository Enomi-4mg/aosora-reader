import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  openDatabase,
  migrate,
  SCHEMA_VERSION,
  SchemaTooNewError
} from '../../src/main/db/connection'
import { MIGRATIONS } from '../../src/main/db/migrations'

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'aosora-schema-')), 'library.db')
}

describe('スキーマ版', () => {
  it('SCHEMA_VERSION は MIGRATIONS の最大版', () => {
    expect(SCHEMA_VERSION).toBe(Math.max(...MIGRATIONS.map((m) => m.version)))
  })

  it('新しく作った DB は最新版まで上がる', () => {
    const path = tempDbPath()
    const db = openDatabase(path)
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(row.user_version).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('同じ DB を開き直してもマイグレーションは走り直さない', () => {
    const path = tempDbPath()
    openDatabase(path).close()
    const db = openDatabase(path)
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(row.user_version).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('この版より新しい DB は開かない', () => {
    const path = tempDbPath()
    openDatabase(path).close()

    // 新しい版のアプリが先にマイグレーションを当てた状態を作る。
    const ahead = new DatabaseSync(path)
    ahead.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    ahead.close()

    expect(() => openDatabase(path)).toThrow(SchemaTooNewError)
  })

  it('開けなかった DB はロックを残さない', () => {
    const path = tempDbPath()
    openDatabase(path).close()
    const ahead = new DatabaseSync(path)
    ahead.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 2}`)
    ahead.close()

    expect(() => openDatabase(path)).toThrow(SchemaTooNewError)

    // 接続が閉じていれば、別の接続から書き込める。
    const after = new DatabaseSync(path)
    expect(() => after.exec('CREATE TABLE lock_probe (x INTEGER)')).not.toThrow()
    after.close()
  })

  it('エラーには実際の版と対応可能な版が入る', () => {
    const path = tempDbPath()
    openDatabase(path).close()
    const ahead = new DatabaseSync(path)
    ahead.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`)
    ahead.close()

    try {
      openDatabase(path)
      expect.unreachable('開けてはいけない')
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaTooNewError)
      const err = e as SchemaTooNewError
      expect(err.found).toBe(SCHEMA_VERSION + 5)
      expect(err.supported).toBe(SCHEMA_VERSION)
      expect(err.message).toContain('最新版に更新')
    }
  })

  it('migrate を直接呼んだときも止まる', () => {
    const path = tempDbPath()
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => migrate(db)).toThrow(SchemaTooNewError)
    db.close()
  })
})
