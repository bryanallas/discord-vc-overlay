import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, ConnectResult, OverlayApi, VoiceSnapshot } from './types'

const api: OverlayApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', settings),
  connect: (botToken: string, userId: string): Promise<ConnectResult> =>
    ipcRenderer.invoke('discord:connect', { botToken, userId }),
  disconnect: () => ipcRenderer.invoke('discord:disconnect'),
  onVoiceUpdate: (callback: (snapshot: VoiceSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: VoiceSnapshot) => callback(snapshot)
    ipcRenderer.on('voice:update', listener)
    return () => ipcRenderer.removeListener('voice:update', listener)
  },
  onStatusUpdate: (callback: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('discord:status', listener)
    return () => ipcRenderer.removeListener('discord:status', listener)
  }
}

contextBridge.exposeInMainWorld('overlayApi', api)
