import { useEffect, useMemo, useState } from 'react'
import {
  AlignLeft,
  AlignRight,
  AudioLines,
  CircleHelp,
  Eye,
  Headphones,
  MicOff,
  Mic,
  MonitorCog,
  PhoneOff,
  Radio,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  VolumeX
} from 'lucide-react'
import type { AppSettings, Participant, VoiceSetting, VoiceSnapshot } from '../electron/types'

const defaults: AppSettings = {
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

const emptySnapshot: VoiceSnapshot = {
  connected: false,
  targetInVoice: false,
  guildName: null,
  channelName: null,
  participants: [],
  message: 'Sign in with Discord to get started.',
  selfMuted: false,
  selfDeafened: false
}

export default function App() {
  const isOverlay = new URLSearchParams(window.location.search).has('overlay')
  const [settings, setSettings] = useState(defaults)
  const [hotkeyDrafts, setHotkeyDrafts] = useState(defaults.hotkeys)
  const [snapshot, setSnapshot] = useState(emptySnapshot)
  const [status, setStatus] = useState('Not connected')
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    const applySettings = (nextSettings: AppSettings) => {
      setSettings(nextSettings)
      setHotkeyDrafts(nextSettings.hotkeys)
    }
    const removeSettings = window.overlayApi.onSettingsUpdate(applySettings)
    const removeVoice = window.overlayApi.onVoiceUpdate(setSnapshot)
    const removeStatus = window.overlayApi.onStatusUpdate(setStatus)
    void Promise.all([
      window.overlayApi.getSettings(),
      window.overlayApi.getStatus(),
      window.overlayApi.getVoiceSnapshot()
    ]).then(([savedSettings, savedStatus, savedSnapshot]) => {
      applySettings(savedSettings)
      setStatus(savedStatus)
      setSnapshot(savedSnapshot)
    }).catch((error: unknown) => {
      setStatus(`Could not load app state: ${error instanceof Error ? error.message : 'Unknown error'}`)
    })
    return () => {
      removeSettings()
      removeVoice()
      removeStatus()
    }
  }, [])

  const participants = useMemo(() => {
    return settings.onlyShowTalking
      ? snapshot.participants.filter((participant) => participant.talking)
      : snapshot.participants
  }, [settings.onlyShowTalking, snapshot.participants])

  const updateSetting = (patch: Partial<AppSettings>) => {
    const updated = { ...settings, ...patch }
    setSettings(updated)
    void window.overlayApi.saveSettings(patch).then(setSettings).catch((error: unknown) => {
      setStatus(`Could not save setting: ${error instanceof Error ? error.message : 'Unknown error'}`)
    })
  }

  const connect = async () => {
    setConnecting(true)
    try {
      const result = await window.overlayApi.connect()
      setStatus(result.message)
    } catch (error) {
      setStatus(`Could not connect: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    try {
      await window.overlayApi.disconnect()
      setStatus('Disconnected')
    } catch (error) {
      setStatus(`Could not disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const toggleVoiceSetting = async (setting: VoiceSetting) => {
    try {
      await window.overlayApi.toggleVoiceSetting(setting)
    } catch (error) {
      setStatus(`Could not change voice setting: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  if (isOverlay) {
    return (
      <Overlay
        settings={settings}
        snapshot={snapshot}
        participants={participants}
        onToggleVoiceSetting={(setting) => void toggleVoiceSetting(setting)}
        onDisconnect={() => void disconnect()}
      />
    )
  }

  return (
    <main className="settings-page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><AudioLines size={19} strokeWidth={2.2} /></div>
          <span>voice<span className="brand-dot">.</span>overlay</span>
        </div>
        <div className="topbar-right">
          <span className="platform-tag"><span className="platform-dot" /> macOS app</span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={13} /> YOUR VOICE, AT A GLANCE</div>
          <h1>Stay in the<br /><span>conversation.</span></h1>
          <p>A quiet little overlay for your Discord voice channel. Right where you need it, never in the way.</p>
        </div>
        <div className="hero-preview" aria-hidden="true">
          <div className="preview-glow" />
          <div className="preview-card">
            <div className="preview-heading">
              <span className="live-dot" /> VOICE CHANNEL
              <span className="preview-count">4</span>
            </div>
            <div className="preview-member talking">
              <span className="preview-avatar avatar-olive">O</span>
              <span>Olivia</span><AudioLines className="preview-speaking" size={16} />
            </div>
            <div className="preview-member">
              <span className="preview-avatar avatar-blue">J</span>
              <span>Jordan</span><span className="preview-muted"><MicOff size={14} /></span>
            </div>
            <div className="preview-member">
              <span className="preview-avatar avatar-rose">S</span>
              <span>Sam</span>
            </div>
          </div>
          <div className="preview-caption"><span className="caption-dot" /> talking now</div>
        </div>
      </section>

      <section className="connect-card">
        <div className="section-heading">
          <div className="section-icon purple"><Radio size={18} /></div>
          <div>
            <h2>Connect to Discord</h2>
            <p>Sign in securely through the Discord desktop app.</p>
          </div>
          <div className={`connection-pill ${snapshot.connected ? 'is-connected' : ''}`}>
            <span /> {snapshot.connected ? 'Connected' : 'Not connected'}
          </div>
        </div>
        <div className="connect-panel">
          <div className="connect-copy">
            <div className="discord-login-mark"><AudioLines size={17} /></div>
            <div>
              <strong>Continue with Discord</strong>
              <span>Approve this app in Discord to share voice-channel details.</span>
            </div>
          </div>
          <div className="connect-actions">
            {snapshot.connected && (
              <button className="secondary-button" onClick={() => void disconnect()}>Disconnect</button>
            )}
            <button className="primary-button" onClick={() => void connect()} disabled={connecting}>
              {connecting ? <span className="spinner" /> : <Radio size={15} />}
              {connecting ? 'Connecting…' : snapshot.connected ? 'Reconnect' : 'Sign in with Discord'}
            </button>
          </div>
        </div>
        <div className="security-note">
          <ShieldCheck size={15} />
          <span>Discord asks for permission. Your refresh token is encrypted and stored on this Mac.</span>
          <button className="help-button" title="Voice state is read from the Discord desktop app's authorized local RPC connection.">
            <CircleHelp size={15} />
          </button>
        </div>
        <div className="status-line"><span className={snapshot.connected ? 'status-dot online' : 'status-dot'} />{status}</div>
      </section>

      <section className="settings-card">
        <div className="section-heading settings-heading">
          <div className="section-icon blue"><Settings2 size={18} /></div>
          <div>
            <h2>Overlay settings</h2>
            <p>Make it yours. Your changes save automatically.</p>
          </div>
        </div>
        <div className="settings-list">
          <ToggleRow
            icon={<MonitorCog size={17} />}
            title="Keep window in front"
            description="Float above your other windows"
            checked={settings.keepOnTop}
            onChange={(checked) => updateSetting({ keepOnTop: checked })}
          />
          <ToggleRow
            icon={<Radio size={17} />}
            title="Show voice channel name"
            description="Include the channel name at the top"
            checked={settings.showVcName}
            onChange={(checked) => updateSetting({ showVcName: checked })}
          />
          <ToggleRow
            icon={<Eye size={17} />}
            title="Show account names"
            description="Display names next to profile pictures"
            checked={settings.showAccountNames}
            onChange={(checked) => updateSetting({ showAccountNames: checked })}
          />
          <ToggleRow
            icon={<AudioLines size={17} />}
            title="Only show talking accounts"
            description="Hide people who aren't speaking"
            checked={settings.onlyShowTalking}
            onChange={(checked) => updateSetting({ onlyShowTalking: checked })}
          />
          <ToggleRow
            icon={<Mic size={17} />}
            title="Show mute button"
            description="Display the mute control on the overlay"
            checked={settings.showOverlayMute}
            onChange={(checked) => updateSetting({ showOverlayMute: checked })}
          />
          <ToggleRow
            icon={<VolumeX size={17} />}
            title="Show deafen button"
            description="Display the deafen control on the overlay"
            checked={settings.showOverlayDeafen}
            onChange={(checked) => updateSetting({ showOverlayDeafen: checked })}
          />
          <ToggleRow
            icon={<PhoneOff size={17} />}
            title="Show disconnect button"
            description="Display the disconnect control on the overlay"
            checked={settings.showOverlayDisconnect}
            onChange={(checked) => updateSetting({ showOverlayDisconnect: checked })}
          />
          <div className="slider-row">
            <div className="slider-label">
              <div className="setting-icon"><SlidersHorizontal size={17} /></div>
              <div><strong>Window opacity</strong><small>Adjust the overlay transparency</small></div>
            </div>
            <div className="slider-control">
              <input
                aria-label="Window opacity"
                type="range"
                min="0.35"
                max="1"
                step="0.01"
                value={settings.opacity}
                style={{ '--range-progress': `${((settings.opacity - 0.35) / 0.65) * 100}%` } as React.CSSProperties}
                onChange={(event) => updateSetting({ opacity: Number(event.target.value) })}
              />
              <span>{Math.round(settings.opacity * 100)}%</span>
            </div>
          </div>
          <div className="slider-row">
            <div className="slider-label">
              <div className="setting-icon"><MonitorCog size={17} /></div>
              <div><strong>Overlay Window Size</strong><small>Resize the overlay</small></div>
            </div>
            <div className="slider-control">
              <input
                aria-label="Overlay Window Size"
                type="range"
                min="0.7"
                max="1.5"
                step="0.01"
                value={settings.size}
                style={{ '--range-progress': `${((settings.size - 0.7) / 0.8) * 100}%` } as React.CSSProperties}
                onChange={(event) => updateSetting({ size: Number(event.target.value) })}
              />
              <span>{Math.round(settings.size * 100)}%</span>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-card placement-card">
        <div className="section-heading settings-heading">
          <div className="section-icon purple"><MonitorCog size={18} /></div>
          <div>
            <h2>Placement &amp; hotkeys</h2>
            <p>Choose an edge and set shortcuts that work anywhere.</p>
          </div>
        </div>
        <div className="placement-content">
          <div className="alignment-row">
            <div className="toggle-copy">
              <strong>Horizontal alignment</strong>
              <small>Position the overlay at a screen edge</small>
            </div>
            <div className="alignment-options">
              <button
                className={`alignment-button ${settings.alignment === 'left' ? 'selected' : ''}`}
                aria-pressed={settings.alignment === 'left'}
                onClick={() => updateSetting({ alignment: 'left' })}
              ><AlignLeft size={15} /> Left</button>
              <button
                className={`alignment-button ${settings.alignment === 'right' ? 'selected' : ''}`}
                aria-pressed={settings.alignment === 'right'}
                onClick={() => updateSetting({ alignment: 'right' })}
              ><AlignRight size={15} /> Right</button>
            </div>
          </div>
          <div className="hotkey-grid">
            {([
              ['mute', 'Mute / unmute'],
              ['deafen', 'Deafen / undeafen'],
              ['disconnect', 'Disconnect']
            ] as const).map(([key, label]) => (
              <label className="hotkey-field" key={key}>
                <span>{label}</span>
                <input
                  type="text"
                  aria-label={`${label} hotkey`}
                  value={hotkeyDrafts[key]}
                  placeholder="Leave blank to disable"
                  onChange={(event) => {
                    setHotkeyDrafts({ ...hotkeyDrafts, [key]: event.target.value })
                  }}
                  onBlur={() => updateSetting({ hotkeys: hotkeyDrafts })}
                />
              </label>
            ))}
          </div>
          <p className="hotkey-help">Use accelerator format, e.g. CommandOrControl+Alt+Shift+M. Leave blank to disable a shortcut.</p>
        </div>
      </section>

      <footer className="page-footer">
        <span><span className="footer-dot" /> {snapshot.targetInVoice ? `Watching ${snapshot.channelName}` : status}</span>
        <span className="footer-saved"><ShieldCheck size={13} /> Settings save automatically</span>
      </footer>
    </main>
  )
}

function ToggleRow(props: {
  icon: React.ReactNode
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="toggle-row">
      <div className="setting-icon">{props.icon}</div>
      <div className="toggle-copy"><strong>{props.title}</strong><small>{props.description}</small></div>
      <button
        className={`switch ${props.checked ? 'checked' : ''}`}
        role="switch"
        aria-checked={props.checked}
        aria-label={props.title}
        onClick={(event) => {
          event.preventDefault()
          props.onChange(!props.checked)
        }}
      ><span /></button>
    </div>
  )
}

function Overlay(props: {
  settings: AppSettings
  snapshot: VoiceSnapshot
  participants: Participant[]
  onToggleVoiceSetting: (setting: VoiceSetting) => void
  onDisconnect: () => void
}) {
  const { settings, snapshot, participants, onToggleVoiceSetting, onDisconnect } = props
  const channelTitle = settings.showVcName ? snapshot.channelName : null
  return (
    <div className="overlay-root" style={{ zoom: settings.size }}>
      <div className="overlay-card">
        {channelTitle && (
          <div className="overlay-header">
            <span className="live-dot" />
            <span className="channel-title">{channelTitle}</span>
            <span className="participant-count">{participants.length}</span>
          </div>
        )}
        {participants.length > 0 ? (
          <div className="participant-list">
            {participants.map((participant) => (
              <div
                className={`participant ${settings.alignment === 'right' ? 'info-right' : ''} ${participant.talking ? 'is-talking' : ''}`}
                key={participant.id}
              >
                <img
                  src={participant.avatarUrl}
                  alt=""
                  className="avatar"
                  onError={(event) => {
                    event.currentTarget.src = fallbackAvatar(participant.name)
                  }}
                />
                {settings.showAccountNames && <span className="participant-name" title={participant.username}>{participant.name}</span>}
                <div className="participant-state">
                  {participant.muted && <MicOff size={15} aria-label="Muted" />}
                  {participant.deafened && <VolumeX size={15} aria-label="Deafened" />}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overlay-empty">
            <div className="empty-icon">{snapshot.connected ? <Headphones size={22} /> : <Radio size={22} />}</div>
            <span>{snapshot.connected ? 'Waiting for voice chat' : 'Connect a bot to begin'}</span>
          </div>
        )}
        {(settings.showOverlayMute || settings.showOverlayDeafen || settings.showOverlayDisconnect) && (
          <div className="overlay-controls">
          {settings.showOverlayMute && <button
            className={`overlay-control ${snapshot.selfMuted ? 'active' : ''}`}
            title={snapshot.selfMuted ? 'Unmute microphone' : 'Mute microphone'}
            aria-label={snapshot.selfMuted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={snapshot.selfMuted}
            disabled={!snapshot.connected}
            onClick={() => onToggleVoiceSetting('mute')}
          >
            {snapshot.selfMuted ? <MicOff size={15} /> : <Mic size={15} />}
            <span>{snapshot.selfMuted ? 'Unmute' : 'Mute'}</span>
          </button>}
          {settings.showOverlayDeafen && <button
            className={`overlay-control ${snapshot.selfDeafened ? 'active' : ''}`}
            title={snapshot.selfDeafened ? 'Undeafen audio' : 'Deafen audio'}
            aria-label={snapshot.selfDeafened ? 'Undeafen audio' : 'Deafen audio'}
            aria-pressed={snapshot.selfDeafened}
            disabled={!snapshot.connected}
            onClick={() => onToggleVoiceSetting('deaf')}
          >
            <VolumeX size={15} />
            <span>{snapshot.selfDeafened ? 'Undeafen' : 'Deafen'}</span>
          </button>}
          {settings.showOverlayDisconnect && <button
            className="overlay-control disconnect-control"
            title="Disconnect from Discord"
            aria-label="Disconnect from Discord"
            disabled={!snapshot.connected}
            onClick={onDisconnect}
          >
            <PhoneOff size={15} />
            <span>Disconnect</span>
          </button>}
          </div>
        )}
      </div>
    </div>
  )
}

function fallbackAvatar(name: string): string {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="100%" height="100%" fill="#30323d"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#c8c9d2" font-family="sans-serif" font-size="40">${initial}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
