/** 表示設定(要件 §4.7)。グローバルに1つ持ち、変更は即座に反映して永続化する。 */
import { create } from 'zustand'
import { DEFAULT_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN, FONT_SIZE_STEP, type ReaderSettings } from '@shared/model/settings'

interface SettingsState {
  settings: ReaderSettings
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  patch: (p: Partial<ReaderSettings>) => Promise<void>
  adjustFontSize: (delta: number) => Promise<void>
  resetFontSize: () => Promise<void>
  reset: () => Promise<void>
}

/** 保存要求の順序。応答が前後しても古い結果で上書きさせない。 */
let latestSave = 0

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  error: null,

  async load() {
    try {
      set({ settings: await window.aozora.getReaderSettings(), loaded: true, error: null })
    } catch (error) {
      // 設定を読めなくても既定値で起動する(要件 §9)。
      // ここで loaded を false のままにすると「起動中…」から先へ進めなくなる。
      set({
        settings: DEFAULT_SETTINGS,
        loaded: true,
        error: message(error, '設定を読み込めませんでした。既定値で起動しています。')
      })
    }
  },

  async patch(p) {
    // 先にローカルへ反映してリアルタイム感を出し、永続化は後追いにする
    const previous = get().settings
    set({ settings: { ...previous, ...p }, error: null })
    const request = ++latestSave
    try {
      const saved = await window.aozora.saveReaderSettings(p)
      // 連打で応答が前後しても、最後に投げた要求の結果だけを採用する
      if (request === latestSave) set({ settings: saved })
    } catch (error) {
      if (request === latestSave) {
        set({ settings: previous, error: message(error, '設定を保存できませんでした。') })
      }
    }
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
    try {
      set({ settings: await window.aozora.resetReaderSettings(), error: null })
    } catch (error) {
      set({ error: message(error, '読書設定を初期化できませんでした。') })
    }
  }
}))
