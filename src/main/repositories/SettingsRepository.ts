/**
 * 設定の永続化(要件 §4.7)。
 * key-value にしておくことで、将来の作品別上書きをスキーマ変更なしで足せる。
 */
import { transaction, type Db } from '../db/connection'

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  getAll(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as unknown as Array<{
      key: string
      value_json: string
    }>
    const out: Record<string, unknown> = {}
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value_json)
      } catch {
        // 壊れた設定値は無視してデフォルトに任せる(要件 §9)
      }
    }
    return out
  }

  /**
   * 設定は毎回まとめて書き直される。1件ずつ暗黙のトランザクションで書くと
   * キー数ぶんのコミットになるので、必ず1トランザクションにまとめる。
   */
  setMany(values: Record<string, unknown>): void {
    transaction(this.db, () => {
      const stmt = this.db.prepare(
        `INSERT INTO settings (key, value_json) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
      )
      for (const [k, v] of Object.entries(values)) stmt.run(k, JSON.stringify(v))
    })
  }

  clear(): void {
    this.db.prepare('DELETE FROM settings').run()
  }
}
