/**
 * contextBridge。renderer には型付きの関数だけを渡し、Node の API は一切出さない。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS, type AozoraApi, type AozoraIpcApi } from '@shared/ipc'

const ipcApi = Object.fromEntries(
  IPC_CHANNELS.map((ch) => [
    ch,
    (...args: unknown[]) => ipcRenderer.invoke(ch, ...args)
  ])
) as unknown as AozoraIpcApi

const api: AozoraApi = {
  ...ipcApi,
  getPathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform
}

contextBridge.exposeInMainWorld('aozora', api)
