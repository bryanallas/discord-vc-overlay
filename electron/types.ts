export interface AppSettings {
  keepOnTop: boolean
  showVcName: boolean
  showAccountNames: boolean
  onlyShowTalking: boolean
  showOverlayMute: boolean
  showOverlayDeafen: boolean
  showOverlayDisconnect: boolean
  showOverlayOutline: boolean
  opacity: number
  size: number
  appearance: 'light' | 'dark' | 'system'
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
  leaveVoiceChannel: () => Promise<void>
  alignOverlayHorizontally: () => Promise<void>
  getOverlayWindowBounds: () => Promise<{ x: number; y: number }>
  moveOverlayWindow: (x: number, y: number) => Promise<void>
  toggleVoiceSetting: (setting: VoiceSetting) => Promise<boolean>
  platform: NodeJS.Platform
  reportOverlayWidth: (width: number) => void
  onSettingsUpdate: (callback: (settings: AppSettings) => void) => () => void
  onVoiceUpdate: (callback: (snapshot: VoiceSnapshot) => void) => () => void
  onStatusUpdate: (callback: (message: string) => void) => () => void
}

declare global {
  interface Window {
    overlayApi: OverlayApi
  }
}
