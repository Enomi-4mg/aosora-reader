/**
 * 文字コード判定とデコード(要件 §4.1)。
 *
 * 判定順序:
 *   1. BOM 付き UTF-8
 *   2. UTF-8 として妥当か(strict デコードが通るか)
 *   3. CP932 / Shift_JIS
 *   4. 判定できなければ呼び出し側でユーザーに選ばせる
 *
 * 青空文庫の配布ファイルは Shift_JIS(実体は CP932)。
 * Node / Chromium の TextDecoder('shift_jis') は WHATWG 仕様で CP932 をほぼ包含するため、
 * 追加ライブラリなしで扱える(M0 で実測済み)。
 */

export type SupportedEncoding = 'UTF-8' | 'Shift_JIS'

export interface DecodeResult {
  text: string
  encoding: SupportedEncoding
  /** 判定に自信が無い場合 true。呼び出し側はユーザーに確認する。 */
  ambiguous: boolean
  /** 置換文字(U+FFFD)の数。 */
  replacementCount: number
}

const UTF8_BOM = [0xef, 0xbb, 0xbf]

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return UTF8_BOM.every((b, i) => bytes[i] === b)
}

function countReplacements(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xfffd) n++
  return n
}

function tryStrictUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function decodeAozoraText(bytes: Uint8Array): DecodeResult {
  if (hasUtf8Bom(bytes)) {
    const text = new TextDecoder('utf-8').decode(bytes.subarray(UTF8_BOM.length))
    return { text, encoding: 'UTF-8', ambiguous: false, replacementCount: 0 }
  }

  // Shift_JIS の日本語テキストはまず UTF-8 として妥当にならないので、
  // strict デコードが通ること自体が強い証拠になる。
  const utf8 = tryStrictUtf8(bytes)
  if (utf8 !== null) {
    return { text: utf8, encoding: 'UTF-8', ambiguous: false, replacementCount: 0 }
  }

  const sjis = new TextDecoder('shift_jis').decode(bytes)
  const bad = countReplacements(sjis)
  // 化けが多すぎるときだけユーザー確認に回す
  const ambiguous = bad > 0 && bad / Math.max(1, sjis.length) > 0.01
  return { text: sjis, encoding: 'Shift_JIS', ambiguous, replacementCount: bad }
}

/** ユーザーが明示的に選んだ文字コードでデコードし直す。 */
export function decodeWith(
  bytes: Uint8Array,
  encoding: SupportedEncoding
): string {
  if (encoding === 'UTF-8') {
    const body = hasUtf8Bom(bytes) ? bytes.subarray(UTF8_BOM.length) : bytes
    return new TextDecoder('utf-8').decode(body)
  }
  return new TextDecoder('shift_jis').decode(bytes)
}
