import { create } from 'zustand'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@shared/model/settings'
import type { CustomFontDto } from '@shared/ipc'

interface AppSettingsState {
  settings: AppSettings
  fonts: CustomFontDto[]
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  patch: (patch: Partial<AppSettings>) => Promise<void>
  reset: () => Promise<void>
  importFonts: () => Promise<void>
  renameFont: (id: string, name: string) => Promise<void>
  deleteFont: (id: string) => Promise<void>
}

const message = (error: unknown, fallback: string): string => error instanceof Error ? error.message : fallback

export const useAppSettingsStore = create<AppSettingsState>((set, get) => ({
  settings: DEFAULT_APP_SETTINGS,
  fonts: [],
  loaded: false,
  error: null,
  async load() {
    try {
      const [settings, fonts] = await Promise.all([window.aozora.getAppSettings(), window.aozora.listFonts()])
      set({ settings, fonts, loaded: true, error: null })
    } catch (error) {
      set({ loaded: true, error: message(error, 'アプリ設定を読み込めませんでした。') })
    }
  },
  async patch(patch) {
    const previous = get().settings
    set({ settings: { ...previous, ...patch }, error: null })
    try {
      set({ settings: await window.aozora.saveAppSettings(patch) })
    } catch (error) {
      set({ settings: previous, error: message(error, 'アプリ設定を保存できませんでした。') })
    }
  },
  async reset() {
    try { set({ settings: await window.aozora.resetAppSettings(), error: null }) }
    catch (error) { set({ error: message(error, 'アプリ設定を初期化できませんでした。') }) }
  },
  async importFonts() {
    try { set({ fonts: await window.aozora.importFonts(), error: null }) }
    catch (error) { set({ error: message(error, 'フォントを追加できませんでした。') }) }
  },
  async renameFont(id, name) {
    try { set({ fonts: await window.aozora.renameFont(id, name), error: null }) }
    catch (error) { set({ error: message(error, 'フォント名を変更できませんでした。') }) }
  },
  async deleteFont(id) {
    try { set({ fonts: await window.aozora.deleteFont(id), error: null }) }
    catch (error) { set({ error: message(error, 'フォントを削除できませんでした。') }) }
  }
}))

export const customFontFamily = (id: string): string => `"Aozora Custom ${id}"`
export const customFontId = (family: string): string | null => {
  const match = family.match(/^"Aozora Custom ([0-9a-f-]{36})"$/i)
  return match?.[1] ?? null
}
