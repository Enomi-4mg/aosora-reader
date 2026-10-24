/**
 * OS の違いで変わる見た目と文言をここに集める。
 *
 * platform は preload が同期で渡すので、最初の描画から確定している。
 * テスト(jsdom)には window.aozora が無いので、その場合は mac とみなす。
 */
const platform: NodeJS.Platform = globalThis.window?.aozora?.platform ?? 'darwin'

export const isMac = platform === 'darwin'

/**
 * ショートカットの修飾キー表記。
 * mac は記号1文字でキーに続くが、Windows / Linux は "Ctrl+" と綴って繋ぐ。
 * 実際のキー判定は useReaderKeyboard が metaKey / ctrlKey の両方を見ているので、
 * ここで変わるのは表示だけ。
 */
export const MOD = isMac ? '⌘' : 'Ctrl+'

/** data-platform はタイトルバーの余白(theme.css)の出し分けに使う。 */
export function applyPlatformAttribute(): void {
  document.documentElement.dataset.platform = platform
}
