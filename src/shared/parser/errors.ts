/**
 * パース中に見つかった問題。**例外を投げる代わりにこれを収集する**(要件 §9 / §20-8)。
 * 未対応の注記や壊れた外字があっても本文閲覧を継続できることを保証する。
 */
export type ParseIssueKind =
  | 'unknown-annotation'   // 未対応の注記
  | 'unresolved-gaiji'     // 外字を Unicode に変換できなかった
  | 'unmatched-target'     // 「〜」に傍点 の対象文字列が直前に見つからない
  | 'unclosed-span'        // ［＃傍点］に対応する終わりが無い
  | 'crossing-span'        // 装飾範囲が交差している
  | 'ruby-without-base'    // ルビの親文字を特定できない
  | 'gaiji-in-ruby'        // ルビ親文字に外字が含まれ、外字メタ情報だけを失った(本文は正しい)
  | 'malformed-annotation' // 注記の構文が壊れている

export interface ParseIssue {
  kind: ParseIssueKind
  message: string
  /** 元 TXT 内のオフセット。 */
  sourceOffset: number
  /** 該当箇所の生テキスト。 */
  raw: string
}

export class IssueCollector {
  readonly issues: ParseIssue[] = []

  add(kind: ParseIssueKind, message: string, sourceOffset: number, raw: string): void {
    this.issues.push({ kind, message, sourceOffset, raw })
  }

  /** 開発モードでのみ警告を出す。ユーザー向けメッセージとは分離する(要件 §9)。 */
  report(label: string): void {
    if (this.issues.length === 0) return
    if (process.env.NODE_ENV === 'production') return
    const byKind = new Map<ParseIssueKind, number>()
    for (const i of this.issues) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1)
    const summary = [...byKind].map(([k, n]) => `${k}=${n}`).join(' ')
    console.warn(`[aozora-parser] ${label}: ${this.issues.length} issue(s) — ${summary}`)
  }
}
