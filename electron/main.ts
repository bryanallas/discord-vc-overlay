import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, safeStorage, screen } from 'electron'
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
  showOverlayOutline: true,
  opacity: 0.92,
  size: 1,
  appearance: 'system',
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
let overlayContentWidth = 360
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
let overlaySnapAnimation: NodeJS.Timeout | null = null

function settingsBackgroundColor(): string {
  const dark = settings.appearance === 'dark' ||
    (settings.appearance === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#111318' : '#f4f5f8'
}

function applyAppearance(): void {
  nativeTheme.themeSource = settings.appearance
  settingsWindow?.setBackgroundColor(settingsBackgroundColor())
}

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
    ...(process.platform === 'win32'
      ? { icon: join(__dirname, '../../resources/app-icon.ico') }
      : {}),
    backgroundColor: settingsBackgroundColor(),
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

function showSettingsWindow(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    createSettingsWindow()
    return
  }
  if (settingsWindow.isMinimized()) settingsWindow.restore()
  settingsWindow.show()
  settingsWindow.focus()
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
    showOverlayOutline: typeof candidate.showOverlayOutline === 'boolean'
      ? candidate.showOverlayOutline
      : settings.showOverlayOutline,
    opacity: typeof candidate.opacity === 'number'
      ? Math.min(1, Math.max(0.35, candidate.opacity))
      : settings.opacity,
    size: typeof candidate.size === 'number'
      ? Math.min(1.5, Math.max(0.7, candidate.size))
      : settings.size,
    appearance: candidate.appearance === 'light' ||
      candidate.appearance === 'dark' ||
      candidate.appearance === 'system'
      ? candidate.appearance
      : settings.appearance,
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
  if (patch.appearance !== undefined) applyAppearance()
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
    patch.showOverlayDisconnect !== undefined ||
    patch.showOverlayOutline !== undefined
  if (layoutChanged) resizeOverlay(latestSnapshot)
  sendToWindows('settings:update', settings)
}

function resizeOverlay(snapshot: VoiceSnapshot): void {
  if (!overlayWindow) return
  const bounds = overlayWindow.getBounds()
  const visibleCount = settings.onlyShowTalking
    ? snapshot.participants.filter((participant) => participant.talking).length
    : snapshot.participants.length
  const contentHeight = snapshot.targetInVoice
    ? Math.max(
      212,
      124 + visibleCount * 60 + (settings.showAccountNames ? 0 : stackedControlsExtraHeight())
    )
    : 520
  const width = Math.round(overlayContentWidth * settings.size)
  overlayWindow.setContentSize(width, Math.round(contentHeight * settings.size))
  if (settings.alignment === 'right' && width !== bounds.width) {
    overlayWindow.setPosition(bounds.x + bounds.width - width, bounds.y)
  }
}

function stackedControlsExtraHeight(): number {
  const buttonCount = 1 +
    Number(settings.showOverlayMute) +
    Number(settings.showOverlayDeafen) +
    Number(settings.showOverlayDisconnect)
  const stackedHeight = 8 + buttonCount * 32 + Math.max(0, buttonCount - 1) * 6
  return Math.max(0, stackedHeight - 40)
}

ipcMain.on('overlay:width', (event, width: unknown) => {
  if (event.sender !== overlayWindow?.webContents) return
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    broadcastStatus('The overlay reported an invalid width.')
    return
  }
  overlayContentWidth = Math.min(360, Math.max(160, width))
  resizeOverlay(latestSnapshot)
})

function placeOverlayWindow(): void {
  if (!overlayWindow) return
  if (overlaySnapAnimation) clearInterval(overlaySnapAnimation)
  overlaySnapAnimation = null
  const bounds = overlayWindow.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const { x: workAreaX, width: workAreaWidth } = display.workArea
  const margin = 12
  const x = settings.alignment === 'left'
    ? workAreaX + margin
    : workAreaX + workAreaWidth - bounds.width - margin
  const startX = bounds.x
  const startY = bounds.y
  const distance = x - startX
  if (distance === 0) return

  const duration = 260
  const startedAt = Date.now()
  overlaySnapAnimation = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      if (overlaySnapAnimation) clearInterval(overlaySnapAnimation)
      overlaySnapAnimation = null
      return
    }
    const progress = Math.min(1, (Date.now() - startedAt) / duration)
    const easedProgress = 1 - (1 - progress) ** 3
    overlayWindow.setPosition(Math.round(startX + distance * easedProgress), startY)
    if (progress === 1) {
      if (overlaySnapAnimation) clearInterval(overlaySnapAnimation)
      overlaySnapAnimation = null
    }
  }, 16)
}

function isOverlaySender(sender: Electron.WebContents): boolean {
  return sender === overlayWindow?.webContents
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
          ? monitor.leaveVoiceChannel()
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
    throw new Error('System secure storage is unavailable; sign in again.')
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
    return { connected: false, message: 'System secure storage is unavailable; sign-in was not saved.' }
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
ipcMain.handle('discord:voice-channel:leave', async () => {
  await monitor.leaveVoiceChannel()
})
ipcMain.handle('settings:open', (event) => {
  if (!isOverlaySender(event.sender)) {
    throw new Error('Only the overlay window can open the settings window.')
  }
  showSettingsWindow()
})
ipcMain.handle('overlay:get-bounds', (event) => {
  if (!isOverlaySender(event.sender) || !overlayWindow) {
    throw new Error('Only the overlay window can request its position.')
  }
  const { x, y } = overlayWindow.getBounds()
  return { x, y }
})
ipcMain.handle('overlay:move', (event, x: unknown, y: unknown) => {
  if (!isOverlaySender(event.sender) || !overlayWindow) {
    throw new Error('Only the overlay window can move itself.')
  }
  if (
    typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y)
  ) {
    throw new Error('The overlay position must be finite screen coordinates.')
  }
  if (overlaySnapAnimation) clearInterval(overlaySnapAnimation)
  overlaySnapAnimation = null
  overlayWindow.setPosition(Math.round(x), Math.round(y))
})
ipcMain.handle('discord:voice-setting:toggle', async (_event, setting: 'mute' | 'deaf') => {
  if (setting !== 'mute' && setting !== 'deaf') throw new Error('Unsupported voice setting.')
  return monitor.toggleVoiceSetting(setting)
})
ipcMain.handle('overlay:align-horizontal', (event) => {
  if (event.sender !== overlayWindow?.webContents) {
    throw new Error('Only the overlay window can request horizontal alignment.')
  }
  placeOverlayWindow()
})

monitor.on('voice', (snapshot: VoiceSnapshot) => forwardVoiceSnapshot(snapshot))
monitor.on('status', (message: string) => broadcastStatus(message))

app.whenReady().then(async () => {
  nativeTheme.on('updated', () => {
    settingsWindow?.setBackgroundColor(settingsBackgroundColor())
  })
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

  applyAppearance()
  createSettingsWindow()
  createOverlayWindow()
  resizeOverlay(latestSnapshot)
  registerHotkeys()
  const tokenPath = join(app.getPath('userData'), 'discord-refresh-token.enc')
  if (existsSync(tokenPath)) {
    if (!safeStorage.isEncryptionAvailable()) {
      broadcastStatus('System secure storage is unavailable; sign in again.')
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
      showSettingsWindow()
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
