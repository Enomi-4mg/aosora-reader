import type { AozoraApi } from '@shared/ipc'

declare global {
  interface Window {
    aozora: AozoraApi
  }
}

export {}
