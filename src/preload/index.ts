/**
 * contextBridge。renderer には型付きの関数だけを渡し、Node の API は一切出さない。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AozoraApi } from '@shared/ipc'

const api = Object.fromEntries(
  IPC_CHANNELS.map((ch) => [
    ch,
    (...args: unknown[]) => ipcRenderer.invoke(ch, ...args)
  ])
) as unknown as AozoraApi

contextBridge.exposeInMainWorld('aozora', api)
