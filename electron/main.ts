import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BotMonitor } from './bot'
import type { AppSettings, VoiceSnapshot } from './types'

const defaultSettings: AppSettings = {
  keepOnTop: true,
  showVcName: true,
  showAccountNames: true,
  onlyShowTalking: false,
  opacity: 0.92,
  size: 1
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
  message: 'Disconnected'
}
const monitor = new BotMonitor()

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
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

function createOverlayWindow(): void {
  overlayWindow = new BrowserWindow({
    width: Math.round(360 * settings.size),
    height: Math.round(520 * settings.size),
    minWidth: 260,
    minHeight: 260,
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
  loadRenderer(overlayWindow, true)
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function sanitizeSettings(candidate: Partial<AppSettings>): AppSettings {
  return {
    keepOnTop: typeof candidate.keepOnTop === 'boolean' ? candidate.keepOnTop : settings.keepOnTop,
    showVcName: typeof candidate.showVcName === 'boolean' ? candidate.showVcName : settings.showVcName,
    showAccountNames: typeof candidate.showAccountNames === 'boolean'
      ? candidate.showAccountNames
      : settings.showAccountNames,
    onlyShowTalking: typeof candidate.onlyShowTalking === 'boolean'
      ? candidate.onlyShowTalking
      : settings.onlyShowTalking,
    opacity: typeof candidate.opacity === 'number'
      ? Math.min(1, Math.max(0.35, candidate.opacity))
      : settings.opacity,
    size: typeof candidate.size === 'number'
      ? Math.min(1.5, Math.max(0.7, candidate.size))
      : settings.size
  }
}

async function persistSettings(): Promise<void> {
  await writeFile(join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings, null, 2))
}

function updateOverlaySettings(): void {
  overlayWindow?.setAlwaysOnTop(settings.keepOnTop, 'floating')
  resizeOverlay(latestSnapshot)
  sendToWindows('settings:update', settings)
}

function resizeOverlay(snapshot: VoiceSnapshot): void {
  if (!overlayWindow) return
  const visibleCount = settings.onlyShowTalking
    ? snapshot.participants.filter((participant) => participant.talking).length
    : snapshot.participants.length
  const contentHeight = snapshot.targetInVoice
    ? Math.min(760, Math.max(164, 84 + visibleCount * 60))
    : 520
  overlayWindow.setContentSize(
    Math.round(360 * settings.size),
    Math.round(contentHeight * settings.size)
  )
  overlayWindow.webContents.setZoomFactor(settings.size)
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
  const tokenPath = join(app.getPath('userData'), 'bot-token.enc')
  const userPath = join(app.getPath('userData'), 'tracked-user.txt')
  await Promise.all([
    existsSync(tokenPath) ? unlink(tokenPath) : Promise.resolve(),
    existsSync(userPath) ? unlink(userPath) : Promise.resolve()
  ])
}

ipcMain.handle('settings:get', () => settings)
ipcMain.handle('discord:status:get', () => statusMessage)
ipcMain.handle('voice:get', () => latestSnapshot)
ipcMain.handle('settings:save', async (_event, patch: Partial<AppSettings>) => {
  settings = sanitizeSettings(patch)
  await persistSettings()
  updateOverlaySettings()
  return settings
})
ipcMain.handle('discord:connect', async (_event, input: { botToken: string; userId: string }) => {
  const botToken = typeof input?.botToken === 'string' ? input.botToken.trim() : ''
  const userId = typeof input?.userId === 'string' ? input.userId.trim() : ''
  if (!botToken || !/^\d{17,20}$/.test(userId)) {
    return { connected: false, message: 'Enter a bot token and a valid Discord account ID.' }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { connected: false, message: 'macOS secure storage is unavailable; the bot token was not saved.' }
  }

  try {
    await clearSavedCredentials()
    await monitor.start(botToken, userId)
    const encryptedToken = safeStorage.encryptString(botToken)
    await writeFile(join(app.getPath('userData'), 'bot-token.enc'), encryptedToken)
    await writeFile(join(app.getPath('userData'), 'tracked-user.txt'), userId)
    return { connected: true, message: 'Connecting to Discord…' }
  } catch (error) {
    await monitor.stop()
    await clearSavedCredentials()
    return {
      connected: false,
      message: error instanceof Error ? error.message : 'Could not connect to Discord.'
    }
  }
})
ipcMain.handle('discord:disconnect', async () => {
  await monitor.stop()
  await clearSavedCredentials()
})

monitor.on('voice', (snapshot: VoiceSnapshot) => forwardVoiceSnapshot(snapshot))
monitor.on('status', (message: string) => broadcastStatus(message))

app.whenReady().then(async () => {
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  if (existsSync(settingsPath)) {
    settings = sanitizeSettings(JSON.parse(await readFile(settingsPath, 'utf8')) as Partial<AppSettings>)
  }

  createSettingsWindow()
  createOverlayWindow()
  const tokenPath = join(app.getPath('userData'), 'bot-token.enc')
  const userPath = join(app.getPath('userData'), 'tracked-user.txt')
  if (existsSync(tokenPath) && existsSync(userPath)) {
    if (!safeStorage.isEncryptionAvailable()) {
      broadcastStatus('macOS secure storage is unavailable; reconnect to Discord.')
    } else {
      const encryptedToken = await readFile(tokenPath)
      const userId = (await readFile(userPath, 'utf8')).trim()
      try {
        await monitor.start(safeStorage.decryptString(encryptedToken), userId)
      } catch (error) {
        await clearSavedCredentials()
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
  void monitor.stop()
})
