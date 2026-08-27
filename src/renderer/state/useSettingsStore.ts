/** 表示設定(要件 §4.7)。グローバルに1つ持ち、変更は即座に反映して永続化する。 */
import { create } from 'zustand'
import { DEFAULT_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN, FONT_SIZE_STEP, type ReaderSettings } from '@shared/model/settings'

interface SettingsState {
  settings: ReaderSettings
  loaded: boolean
  load: () => Promise<void>
  patch: (p: Partial<ReaderSettings>) => Promise<void>
  adjustFontSize: (delta: number) => Promise<void>
  resetFontSize: () => Promise<void>
  reset: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  async load() {
    const s = await window.aozora.getSettings()
    set({ settings: s, loaded: true })
  },

  async patch(p) {
    // 先にローカルへ反映してリアルタイム感を出し、永続化は後追いにする
    set({ settings: { ...get().settings, ...p } })
    const saved = await window.aozora.saveSettings(p)
    set({ settings: saved })
  },

  async adjustFontSize(delta) {
    const next = Math.max(
      FONT_SIZE_MIN,
      Math.min(FONT_SIZE_MAX, get().settings.fontSize + delta * FONT_SIZE_STEP)
    )
    await get().patch({ fontSize: next })
  },

  async resetFontSize() {
    await get().patch({ fontSize: DEFAULT_SETTINGS.fontSize })
  },

  async reset() {
    const saved = await window.aozora.saveSettings(DEFAULT_SETTINGS)
    set({ settings: saved })
  }
}))
