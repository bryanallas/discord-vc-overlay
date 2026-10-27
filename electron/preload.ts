import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, ConnectResult, OverlayApi, VoiceSnapshot } from './types'

const api: OverlayApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getStatus: () => ipcRenderer.invoke('discord:status:get'),
  getVoiceSnapshot: () => ipcRenderer.invoke('voice:get'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:save', settings),
  connect: (): Promise<ConnectResult> => ipcRenderer.invoke('discord:connect'),
  disconnect: () => ipcRenderer.invoke('discord:disconnect'),
  onSettingsUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings)
    ipcRenderer.on('settings:update', listener)
    return () => ipcRenderer.removeListener('settings:update', listener)
  },
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
