export interface AppSettings {
  keepOnTop: boolean
  showVcName: boolean
  showAccountNames: boolean
  onlyShowTalking: boolean
  showOverlayMute: boolean
  showOverlayDeafen: boolean
  showOverlayDisconnect: boolean
  opacity: number
  size: number
  alignment: 'left' | 'right'
  hotkeys: HotkeySettings
}

export interface HotkeySettings {
  mute: string
  deafen: string
  disconnect: string
}

export interface Participant {
  id: string
  name: string
  username: string
  avatarUrl: string
  muted: boolean
  deafened: boolean
  talking: boolean
}

export interface VoiceSnapshot {
  connected: boolean
  targetInVoice: boolean
  guildName: string | null
  channelName: string | null
  participants: Participant[]
  message: string
  selfMuted: boolean
  selfDeafened: boolean
}

export type VoiceSetting = 'mute' | 'deaf'

export interface ConnectResult {
  connected: boolean
  message: string
}

export interface OverlayApi {
  getSettings: () => Promise<AppSettings>
  getStatus: () => Promise<string>
  getVoiceSnapshot: () => Promise<VoiceSnapshot>
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  connect: () => Promise<ConnectResult>
  disconnect: () => Promise<void>
  toggleVoiceSetting: (setting: VoiceSetting) => Promise<boolean>
  onSettingsUpdate: (callback: (settings: AppSettings) => void) => () => void
  onVoiceUpdate: (callback: (snapshot: VoiceSnapshot) => void) => () => void
  onStatusUpdate: (callback: (message: string) => void) => () => void
}

declare global {
  interface Window {
    overlayApi: OverlayApi
  }
}
