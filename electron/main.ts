import { app, BrowserWindow, globalShortcut, ipcMain, safeStorage, screen } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DiscordRpcMonitor } from './rpc'
import type { AppSettings, VoiceSnapshot } from './types'

const clientId = __DISCORD_CLIENT_ID__
const tokenExchangeUrl = __DISCORD_TOKEN_EXCHANGE_URL__
const SIZE_RESET_VERSION = 2
const defaultSettings: AppSettings = {
  keepOnTop: true,
  showVcName: true,
  showAccountNames: true,
  onlyShowTalking: false,
  showOverlayMute: true,
  showOverlayDeafen: true,
  showOverlayDisconnect: true,
  opacity: 0.92,
  size: 1,
  alignment: 'left',
  hotkeys: {
    mute: 'CommandOrControl+Alt+Shift+M',
    deafen: 'CommandOrControl+Alt+Shift+D',
    disconnect: 'CommandOrControl+Alt+Shift+X'
  }
}

let settings = { ...defaultSettings }
let settingsWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let statusMessage = 'Not connected'
let latestSnapshot: VoiceSnapshot = {
  connected: false,
  targetInVoice: false,
  guildName: null,
  channelName: null,
  participants: [],
  message: 'Disconnected',
  selfMuted: false,
  selfDeafened: false
}
const monitor = new DiscordRpcMonitor()
let registeredHotkeys: string[] = []

function sendToWindows(channel: string, value: unknown): void {
  for (const window of [settingsWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, value)
  }
}

function broadcastStatus(message: string): void {
  statusMessage = message
  sendToWindows('discord:status', message)
}

function loadRenderer(window: BrowserWindow, overlay = false): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${overlay ? '?overlay=1' : ''}`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), {
      query: overlay ? { overlay: '1' } : undefined
    })
  }
}

function createSettingsWindow(): void {
  settingsWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 760,
    minHeight: 620,
    title: 'Discord VC Overlay',
    backgroundColor: '#111318',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  loadRenderer(settingsWindow)
  settingsWindow.webContents.setZoomFactor(1)
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

function createOverlayWindow(): void {
  overlayWindow = new BrowserWindow({
    width: Math.round(360 * settings.size),
    height: Math.round(520 * settings.size),
    opacity: settings.opacity,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: settings.keepOnTop,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  placeOverlayWindow()
  loadRenderer(overlayWindow, true)
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function sanitizeSettings(candidate: Partial<AppSettings>): AppSettings {
  const hotkeys: Partial<AppSettings['hotkeys']> = candidate.hotkeys && typeof candidate.hotkeys === 'object'
    ? candidate.hotkeys
    : {}
  return {
    keepOnTop: typeof candidate.keepOnTop === 'boolean' ? candidate.keepOnTop : settings.keepOnTop,
    showVcName: typeof candidate.showVcName === 'boolean' ? candidate.showVcName : settings.showVcName,
    showAccountNames: typeof candidate.showAccountNames === 'boolean'
      ? candidate.showAccountNames
      : settings.showAccountNames,
    onlyShowTalking: typeof candidate.onlyShowTalking === 'boolean'
      ? candidate.onlyShowTalking
      : settings.onlyShowTalking,
    showOverlayMute: typeof candidate.showOverlayMute === 'boolean'
      ? candidate.showOverlayMute
      : settings.showOverlayMute,
    showOverlayDeafen: typeof candidate.showOverlayDeafen === 'boolean'
      ? candidate.showOverlayDeafen
      : settings.showOverlayDeafen,
    showOverlayDisconnect: typeof candidate.showOverlayDisconnect === 'boolean'
      ? candidate.showOverlayDisconnect
      : settings.showOverlayDisconnect,
    opacity: typeof candidate.opacity === 'number'
      ? Math.min(1, Math.max(0.35, candidate.opacity))
      : settings.opacity,
    size: typeof candidate.size === 'number'
      ? Math.min(1.5, Math.max(0.7, candidate.size))
      : settings.size,
    alignment: candidate.alignment === 'left' || candidate.alignment === 'right'
      ? candidate.alignment
      : settings.alignment,
    hotkeys: {
      mute: typeof hotkeys.mute === 'string' ? hotkeys.mute.trim().slice(0, 80) : settings.hotkeys.mute,
      deafen: typeof hotkeys.deafen === 'string' ? hotkeys.deafen.trim().slice(0, 80) : settings.hotkeys.deafen,
      disconnect: typeof hotkeys.disconnect === 'string'
        ? hotkeys.disconnect.trim().slice(0, 80)
        : settings.hotkeys.disconnect
    }
  }
}

async function persistSettings(): Promise<void> {
  await writeFile(
    join(app.getPath('userData'), 'settings.json'),
    JSON.stringify({ ...settings, sizeResetVersion: SIZE_RESET_VERSION }, null, 2)
  )
}

function updateOverlaySettings(patch: Partial<AppSettings>): void {
  if (patch.keepOnTop !== undefined) {
    overlayWindow?.setAlwaysOnTop(settings.keepOnTop, 'floating')
  }
  if (patch.opacity !== undefined) {
    overlayWindow?.setOpacity(settings.opacity)
  }
  const layoutChanged = patch.size !== undefined ||
    patch.onlyShowTalking !== undefined ||
    patch.showVcName !== undefined ||
    patch.showAccountNames !== undefined ||
    patch.showOverlayMute !== undefined ||
    patch.showOverlayDeafen !== undefined ||
    patch.showOverlayDisconnect !== undefined
  if (layoutChanged) resizeOverlay(latestSnapshot)
  sendToWindows('settings:update', settings)
}

function resizeOverlay(snapshot: VoiceSnapshot): void {
  if (!overlayWindow) return
  const visibleCount = settings.onlyShowTalking
    ? snapshot.participants.filter((participant) => participant.talking).length
    : snapshot.participants.length
  const contentHeight = snapshot.targetInVoice
    ? Math.max(212, 124 + visibleCount * 60)
    : 520
  overlayWindow.setContentSize(
    Math.round(360 * settings.size),
    Math.round(contentHeight * settings.size)
  )
}

function placeOverlayWindow(): void {
  if (!overlayWindow) return
  const bounds = overlayWindow.getBounds()
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
  const { x: workAreaX, y: workAreaY, width: workAreaWidth, height: workAreaHeight } = display.workArea
  const margin = 12
  const x = settings.alignment === 'left'
    ? workAreaX + margin
    : workAreaX + workAreaWidth - bounds.width - margin
  const y = Math.max(workAreaY + margin, Math.min(bounds.y, workAreaY + workAreaHeight - bounds.height - margin))
  overlayWindow.setPosition(x, y)
}

function registerHotkeys(): void {
  for (const accelerator of registeredHotkeys) globalShortcut.unregister(accelerator)
  registeredHotkeys = []

  const failures: string[] = []
  const seen = new Set<string>()
  const actions = [
    ['mute', settings.hotkeys.mute],
    ['deafen', settings.hotkeys.deafen],
    ['disconnect', settings.hotkeys.disconnect]
  ] as const

  for (const [action, accelerator] of actions) {
    if (!accelerator) continue
    if (seen.has(accelerator)) {
      failures.push(`${accelerator} is assigned more than once`)
      continue
    }
    seen.add(accelerator)
    try {
      const registered = globalShortcut.register(accelerator, () => {
        const operation = action === 'disconnect'
          ? disconnectDiscord()
          : monitor.toggleVoiceSetting(action === 'mute' ? 'mute' : 'deaf')
        void operation.catch((error: unknown) => {
          broadcastStatus(`Hotkey action failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
        })
      })
      if (registered) registeredHotkeys.push(accelerator)
      else failures.push(`${accelerator} is already in use`)
    } catch (error) {
      failures.push(`${accelerator}: ${error instanceof Error ? error.message : 'Invalid accelerator'}`)
    }
  }

  if (failures.length > 0) broadcastStatus(`Could not register hotkey(s): ${failures.join('; ')}`)
}

async function disconnectDiscord(): Promise<void> {
  await monitor.stop()
  await clearSavedCredentials()
}

function forwardVoiceSnapshot(snapshot: VoiceSnapshot): void {
  latestSnapshot = snapshot
  sendToWindows('voice:update', snapshot)
  if (!overlayWindow) return
  resizeOverlay(snapshot)
  if (snapshot.targetInVoice) {
    if (!overlayWindow.isVisible()) overlayWindow.showInactive()
  } else if (overlayWindow.isVisible()) {
    overlayWindow.hide()
  }
}

async function clearSavedCredentials(): Promise<void> {
  const tokenPath = join(app.getPath('userData'), 'discord-refresh-token.enc')
  if (existsSync(tokenPath)) await unlink(tokenPath)
}

async function readSavedRefreshToken(): Promise<string | undefined> {
  const tokenPath = join(app.getPath('userData'), 'discord-refresh-token.enc')
  if (!existsSync(tokenPath)) return undefined
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('macOS secure storage is unavailable; sign in again.')
  }
  try {
    return safeStorage.decryptString(await readFile(tokenPath))
  } catch {
    await clearSavedCredentials()
    throw new Error('The saved Discord sign-in could not be decrypted. Please sign in again.')
  }
}

ipcMain.handle('settings:get', () => settings)
ipcMain.handle('discord:status:get', () => statusMessage)
ipcMain.handle('voice:get', () => latestSnapshot)
ipcMain.handle('settings:save', async (_event, patch: Partial<AppSettings>) => {
  settings = sanitizeSettings(patch)
  await persistSettings()
  updateOverlaySettings(patch)
  if (patch.hotkeys !== undefined) registerHotkeys()
  if (patch.alignment !== undefined) placeOverlayWindow()
  return settings
})
ipcMain.handle('discord:connect', async () => {
  if (!/^\d{17,20}$/.test(clientId)) {
    return { connected: false, message: 'Discord sign-in is not configured in this build.' }
  }
  if (!tokenExchangeUrl) {
    return { connected: false, message: 'The Discord OAuth service is not configured in this build.' }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { connected: false, message: 'macOS secure storage is unavailable; sign-in was not saved.' }
  }

  try {
    const refreshToken = await readSavedRefreshToken()
    const newRefreshToken = await monitor.start(clientId, tokenExchangeUrl, refreshToken)
    await writeFile(
      join(app.getPath('userData'), 'discord-refresh-token.enc'),
      safeStorage.encryptString(newRefreshToken)
    )
    return { connected: true, message: 'Discord account connected.' }
  } catch (error) {
    await monitor.stop()
    return {
      connected: false,
      message: error instanceof Error ? error.message : 'Could not connect to Discord.'
    }
  }
})
ipcMain.handle('discord:disconnect', async () => {
  await disconnectDiscord()
})
ipcMain.handle('discord:voice-setting:toggle', async (_event, setting: 'mute' | 'deaf') => {
  if (setting !== 'mute' && setting !== 'deaf') throw new Error('Unsupported voice setting.')
  return monitor.toggleVoiceSetting(setting)
})

monitor.on('voice', (snapshot: VoiceSnapshot) => forwardVoiceSnapshot(snapshot))
monitor.on('status', (message: string) => broadcastStatus(message))

app.whenReady().then(async () => {
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  if (existsSync(settingsPath)) {
    const savedSettings = JSON.parse(await readFile(settingsPath, 'utf8')) as
      Partial<AppSettings> & { sizeResetVersion?: number }
    const shouldResetSize = savedSettings.sizeResetVersion !== SIZE_RESET_VERSION
    settings = sanitizeSettings({
      ...savedSettings,
      size: shouldResetSize ? defaultSettings.size : savedSettings.size
    })
    if (shouldResetSize) await persistSettings()
  }

  createSettingsWindow()
  createOverlayWindow()
  resizeOverlay(latestSnapshot)
  registerHotkeys()
  const tokenPath = join(app.getPath('userData'), 'discord-refresh-token.enc')
  if (existsSync(tokenPath)) {
    if (!safeStorage.isEncryptionAvailable()) {
      broadcastStatus('macOS secure storage is unavailable; sign in again.')
    } else if (/^\d{17,20}$/.test(clientId) && tokenExchangeUrl) {
      try {
        const refreshToken = await readSavedRefreshToken()
        if (!refreshToken) return
        const newRefreshToken = await monitor.start(clientId, tokenExchangeUrl, refreshToken)
        await writeFile(tokenPath, safeStorage.encryptString(newRefreshToken))
      } catch (error) {
        broadcastStatus(
          error instanceof Error ? error.message : 'Could not restore the Discord connection.'
        )
      }
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSettingsWindow()
      createOverlayWindow()
    } else {
      settingsWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void monitor.stop()
    app.quit()
  }
})

app.on('before-quit', () => {
  for (const accelerator of registeredHotkeys) globalShortcut.unregister(accelerator)
  registeredHotkeys = []
  void monitor.stop()
})
