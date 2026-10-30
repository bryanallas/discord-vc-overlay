import { randomUUID } from 'node:crypto'
import { connect as connectSocket, type Socket } from 'node:net'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { Participant, VoiceSetting, VoiceSnapshot } from './types'

const RPC_VERSION = 1
const MAX_FRAME_SIZE = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000
const AUTHORIZATION_TIMEOUT_MS = 120_000
const VOICE_EVENTS = [
  'SPEAKING_START',
  'SPEAKING_STOP',
  'VOICE_STATE_CREATE',
  'VOICE_STATE_UPDATE',
  'VOICE_STATE_DELETE'
] as const

type RpcEvent = {
  cmd?: string
  evt?: string
  nonce?: string
  data?: Record<string, unknown> | null
}

type RpcVoiceUser = {
  id: string
  username?: string
  global_name?: string | null
  avatar?: string | null
}

type RpcVoiceState = {
  nick?: string | null
  mute?: boolean
  voice_state?: {
    mute?: boolean
    deaf?: boolean
    self_mute?: boolean
    self_deaf?: boolean
  }
  user?: RpcVoiceUser
}

type RpcChannel = {
  id: string
  name: string
  guild_id?: string
  voice_states?: RpcVoiceState[]
}

type RpcVoiceSettings = {
  mute?: boolean
  deaf?: boolean
}

type PendingRequest = {
  resolve: (message: RpcEvent) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export function encodeIpcFrame(opcode: number, payload: string | Buffer): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  const header = Buffer.allocUnsafe(8)
  header.writeUInt32LE(opcode, 0)
  header.writeUInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

export function decodeIpcFrames(input: Buffer): {
  frames: Array<{ opcode: number; payload: Buffer }>
  remainder: Buffer
} {
  const frames: Array<{ opcode: number; payload: Buffer }> = []
  let offset = 0
  while (input.length - offset >= 8) {
    const opcode = input.readUInt32LE(offset)
    const length = input.readUInt32LE(offset + 4)
    if (length > MAX_FRAME_SIZE) throw new Error('Discord RPC sent an oversized frame.')
    if (input.length - offset - 8 < length) break
    frames.push({
      opcode,
      payload: input.subarray(offset + 8, offset + 8 + length)
    })
    offset += 8 + length
  }
  return { frames, remainder: input.subarray(offset) }
}

export class DiscordRpcMonitor extends EventEmitter {
  private socket: Socket | null = null
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private pending = new Map<string, PendingRequest>()
  private participants = new Map<string, Participant>()
  private talkingUsers = new Set<string>()
  private refreshTimer: NodeJS.Timeout | null = null
  private channelId: string | null = null
  private channelName: string | null = null
  private guildId: string | null = null
  private guildName: string | null = null
  private authenticated = false
  private selfMuted = false
  private selfDeafened = false
  private stopped = true
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: Error) => void) | null = null
  private readyTimer: NodeJS.Timeout | null = null

  async start(
    clientId: string,
    tokenExchangeUrl: string,
    refreshToken?: string
  ): Promise<string> {
    await this.stop()
    this.stopped = false
    this.resetVoiceState()

    try {
      this.socket = await openDiscordIpc()
      this.socket.on('data', (data) => this.receive(data))
      this.socket.on('error', (error) => this.failConnection(error))
      this.socket.on('close', () => {
        if (!this.stopped) this.failConnection(new Error('Discord closed the RPC connection.'))
      })

      const ready = new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve
        this.readyReject = reject
        this.readyTimer = setTimeout(
          () => reject(new Error('Discord did not answer the RPC handshake.')),
          REQUEST_TIMEOUT_MS
        )
      })
      this.write(0, JSON.stringify({ v: RPC_VERSION, client_id: clientId }))
      await ready

      let tokens: TokenResponse
      if (refreshToken) {
        try {
          tokens = await exchangeToken(tokenExchangeUrl, { refresh_token: refreshToken })
          await this.authenticate(tokens.access_token)
        } catch (error) {
          if (error instanceof ReauthorizationRequiredError || error instanceof RpcRequestError) {
            tokens = await this.authorize(clientId, tokenExchangeUrl)
          } else {
            throw error
          }
        }
      } else {
        tokens = await this.authorize(clientId, tokenExchangeUrl)
      }

      this.authenticated = true
      this.subscribe('VOICE_CHANNEL_SELECT')
      await this.syncSelectedChannel()
      void this.syncVoiceSettings().catch((error: unknown) => {
        this.emit('status', `Could not read Discord voice settings: ${errorMessage(error)}`)
      })
      this.refreshTimer = setInterval(() => {
        void this.syncSelectedChannel().catch((error: unknown) => this.emit('status', errorMessage(error)))
      }, 20_000)
      this.emit('status', 'Connected to your Discord desktop app.')
      return tokens.refresh_token
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.authenticated = false
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.readyTimer = null
    this.readyResolve = null
    this.readyReject = null
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(new Error('Discord RPC connection closed.'))
    }
    this.pending.clear()
    const socket = this.socket
    this.socket = null
    socket?.destroy()
    this.resetVoiceState()
    this.emitSnapshot(false, 'Disconnected')
    this.emit('status', 'Disconnected')
  }

  async toggleVoiceSetting(setting: VoiceSetting): Promise<boolean> {
    if (!this.authenticated) throw new Error('Connect to Discord before changing voice settings.')

    await this.syncVoiceSettings()
    const value = setting === 'mute' ? !this.selfMuted : !this.selfDeafened
    await this.request('SET_VOICE_SETTINGS', { [setting]: value })
    if (setting === 'mute') this.selfMuted = value
    else this.selfDeafened = value
    this.emitSnapshot(true, value
      ? setting === 'mute' ? 'Microphone muted.' : 'Audio deafened.'
      : setting === 'mute' ? 'Microphone unmuted.' : 'Audio undeafened.')
    return value
  }

  private async syncVoiceSettings(): Promise<void> {
    if (!this.authenticated) return
    const response = await this.request('GET_VOICE_SETTINGS', {})
    const settings = response.data as RpcVoiceSettings | null | undefined
    if (typeof settings?.mute === 'boolean') this.selfMuted = settings.mute
    if (typeof settings?.deaf === 'boolean') this.selfDeafened = settings.deaf
    this.emitSnapshot(true, `Watching ${this.channelName ?? 'voice channel'}`)
  }

  private async authorize(clientId: string, tokenExchangeUrl: string): Promise<TokenResponse> {
    this.emit('status', 'Approve Discord access in the Discord app…')
    const response = await this.request('AUTHORIZE', {
      client_id: clientId,
      scopes: ['rpc', 'identify']
    }, AUTHORIZATION_TIMEOUT_MS)
    const code = response.data?.code
    if (typeof code !== 'string' || !code) {
      throw new Error('Discord did not return an authorization code.')
    }
    const tokens = await exchangeToken(tokenExchangeUrl, { code })
    await this.authenticate(tokens.access_token)
    return tokens
  }

  private async authenticate(accessToken: string): Promise<void> {
    const response = await this.request('AUTHENTICATE', { access_token: accessToken })
    if (!response.data?.user) throw new Error('Discord did not authenticate the authorized account.')
  }

  private async syncSelectedChannel(): Promise<void> {
    if (!this.authenticated) return
    const response = await this.request('GET_SELECTED_VOICE_CHANNEL')
    const channel = response.data as unknown as RpcChannel | null | undefined
    if (!channel || typeof channel.id !== 'string') {
      if (this.channelId) this.unsubscribeFromChannel(this.channelId)
      this.resetVoiceState()
      this.emitSnapshot(true, 'You are not in a voice channel.')
      return
    }

    const changed = channel.id !== this.channelId
    if (changed) {
      if (this.channelId) this.unsubscribeFromChannel(this.channelId)
      this.channelId = channel.id
      this.channelName = channel.name
      this.guildId = channel.guild_id ?? null
      this.guildName = null
      this.participants.clear()
      this.talkingUsers.clear()
      this.subscribeToChannel(channel.id)
      if (this.guildId) {
        void this.loadGuildName(this.guildId).catch((error: unknown) => {
          this.emit('status', `Could not load server name: ${errorMessage(error)}`)
        })
      }
    } else {
      this.channelName = channel.name
    }

    this.updateParticipants(channel.voice_states ?? [], !changed)
    this.emitSnapshot(true, `Watching ${this.channelName}`)
  }

  private async loadGuildName(guildId: string): Promise<void> {
    const response = await this.request('GET_GUILD', { guild_id: guildId })
    const name = response.data?.name
    if (this.guildId === guildId && typeof name === 'string') {
      this.guildName = name
      this.emitSnapshot(true, `Watching ${this.channelName}`)
    }
  }

  private subscribeToChannel(channelId: string): void {
    for (const evt of VOICE_EVENTS) this.subscribe(evt, { channel_id: channelId })
  }

  private unsubscribeFromChannel(channelId: string): void {
    for (const evt of VOICE_EVENTS) this.subscribe(evt, { channel_id: channelId }, 'UNSUBSCRIBE')
  }

  private subscribe(
    evt: string,
    args?: Record<string, string>,
    cmd: 'SUBSCRIBE' | 'UNSUBSCRIBE' = 'SUBSCRIBE'
  ): void {
    this.write(1, JSON.stringify({
      cmd,
      evt,
      ...(args ? { args } : {}),
      nonce: randomUUID()
    }))
  }

  private updateParticipants(states: RpcVoiceState[], preserveTalking: boolean): void {
    const next = new Map<string, Participant>()
    for (const state of states) {
      const participant = toParticipant(state, preserveTalking && this.talkingUsers.has(state.user?.id ?? ''))
      if (participant) next.set(participant.id, participant)
    }
    this.participants = next
    this.talkingUsers = new Set(
      [...this.talkingUsers].filter((id) => next.has(id))
    )
  }

  private handleVoiceState(evt: string, data: Record<string, unknown>): void {
    const voiceState = data as unknown as RpcVoiceState & { user_id?: string }
    const userId = voiceState.user?.id ?? voiceState.user_id
    if (!userId) return

    if (evt === 'VOICE_STATE_DELETE') {
      this.participants.delete(userId)
      this.talkingUsers.delete(userId)
    } else {
      const existing = this.participants.get(userId)
      const incoming = toParticipant(
        voiceState,
        this.talkingUsers.has(userId)
      )
      if (incoming) {
        this.participants.set(userId, {
          ...existing,
          ...incoming,
          talking: this.talkingUsers.has(userId)
        })
      }
    }
    this.emitSnapshot(true, `Watching ${this.channelName ?? 'voice channel'}`)
  }

  private receive(data: Buffer): void {
    try {
      const decoded = decodeIpcFrames(Buffer.concat([this.buffer, data]))
      this.buffer = decoded.remainder
      for (const frame of decoded.frames) this.handleFrame(frame.opcode, frame.payload)
    } catch (error) {
      this.failConnection(error instanceof Error ? error : new Error('Invalid Discord RPC frame.'))
    }
  }

  private handleFrame(opcode: number, body: Buffer): void {
    if (opcode === 3) {
      this.write(4, body)
      return
    }
    if (opcode === 2) {
      this.failConnection(new Error('Discord closed the RPC connection.'))
      return
    }
    if (opcode !== 1) return

    const message = JSON.parse(body.toString('utf8')) as RpcEvent
    if (message.evt === 'READY') {
      if (this.readyTimer) clearTimeout(this.readyTimer)
      this.readyTimer = null
      this.readyResolve?.()
      this.readyResolve = null
      this.readyReject = null
    }

    if (message.nonce) {
      const pending = this.pending.get(message.nonce)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pending.delete(message.nonce)
        if (message.evt === 'ERROR') {
          pending.reject(new RpcRequestError(rpcErrorMessage(message.data)))
        } else {
          pending.resolve(message)
        }
      }
    }
    if (message.evt === 'ERROR' && (!message.nonce || !this.pending.has(message.nonce))) {
      this.emit('status', rpcErrorMessage(message.data))
    }

    if (message.evt === 'VOICE_CHANNEL_SELECT') {
      void this.syncSelectedChannel().catch((error: unknown) => this.emit('status', errorMessage(error)))
    } else if (
      message.evt === 'VOICE_STATE_CREATE' ||
      message.evt === 'VOICE_STATE_UPDATE' ||
      message.evt === 'VOICE_STATE_DELETE'
    ) {
      if (message.data) this.handleVoiceState(message.evt, message.data)
    } else if (message.evt === 'SPEAKING_START' || message.evt === 'SPEAKING_STOP') {
      const userId = message.data?.user_id
      if (typeof userId === 'string') {
        if (message.evt === 'SPEAKING_START') this.talkingUsers.add(userId)
        else this.talkingUsers.delete(userId)
        const participant = this.participants.get(userId)
        if (participant) participant.talking = message.evt === 'SPEAKING_START'
        this.emitSnapshot(true, `Watching ${this.channelName ?? 'voice channel'}`)
      }
    }
  }

  private request(
    cmd: string,
    args?: Record<string, string | string[] | boolean>,
    timeoutMs = REQUEST_TIMEOUT_MS
  ): Promise<RpcEvent> {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(new Error('Discord is not connected. Open the Discord desktop app and try again.'))
    }
    const nonce = randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(nonce)
        reject(new Error(`Discord did not respond to ${cmd}.`))
      }, timeoutMs)
      this.pending.set(nonce, {
        resolve,
        reject,
        timeout
      })
      try {
        this.write(1, JSON.stringify({ cmd, ...(args ? { args } : {}), nonce }))
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(nonce)
        reject(error instanceof Error ? error : new Error('Could not send request to Discord.'))
      }
    })
  }

  private write(opcode: number, payload: string | Buffer): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Discord RPC connection is closed.')
    }
    this.socket.write(encodeIpcFrame(opcode, payload))
  }

  private failConnection(error: Error): void {
    if (this.stopped) return
    this.stopped = true
    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.readyTimer = null
    this.readyReject?.(error)
    this.readyReject = null
    this.readyResolve = null
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    this.socket?.destroy()
    this.socket = null
    this.authenticated = false
    this.resetVoiceState()
    this.emitSnapshot(false, error.message)
    this.emit('status', error.message)
  }

  private resetVoiceState(): void {
    this.participants.clear()
    this.talkingUsers.clear()
    this.channelId = null
    this.channelName = null
    this.guildId = null
    this.guildName = null
    this.selfMuted = false
    this.selfDeafened = false
  }

  private emitSnapshot(connected: boolean, message: string): void {
    const snapshot: VoiceSnapshot = {
      connected,
      targetInVoice: Boolean(this.channelId),
      guildName: this.guildName,
      channelName: this.channelName,
      participants: [...this.participants.values()].sort((left, right) => left.name.localeCompare(right.name)),
      message,
      selfMuted: this.selfMuted,
      selfDeafened: this.selfDeafened
    }
    this.emit('voice', snapshot)
  }
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

class ReauthorizationRequiredError extends Error {}
class RpcRequestError extends Error {}

async function exchangeToken(
  tokenExchangeUrl: string,
  input: { code?: string; refresh_token?: string }
): Promise<TokenResponse> {
  let response: Response
  try {
    response = await fetch(tokenExchangeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000)
    })
  } catch (error) {
    throw new Error(`Could not reach the OAuth service: ${errorMessage(error)}`)
  }
  const result = await response.json() as Partial<TokenResponse> & {
    error?: string
    message?: string
    error_description?: string
  }
  if (!response.ok) {
    const message = result.message ?? result.error_description ?? result.error ?? `OAuth service returned HTTP ${response.status}.`
    if (input.refresh_token && result.error === 'invalid_grant') {
      throw new ReauthorizationRequiredError(message)
    }
    throw new Error(message)
  }
  if (
    typeof result.access_token !== 'string' ||
    typeof result.refresh_token !== 'string'
  ) {
    throw new Error('OAuth service returned an invalid token response.')
  }
  return result as TokenResponse
}

async function openDiscordIpc(): Promise<Socket> {
  const prefixes = [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    process.env.TMP,
    process.env.TEMP,
    '/tmp'
  ].filter((value): value is string => Boolean(value))
  const candidates = [...new Set(prefixes.flatMap((prefix) =>
    Array.from({ length: 10 }, (_, index) => join(prefix, `discord-ipc-${index}`))
  ))]

  const errors: string[] = []
  for (const path of candidates) {
    try {
      return await connectToSocket(path)
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }
  throw new Error(
    `Could not find Discord's local IPC connection. Open the Discord desktop app and retry. ${errors.at(-1) ?? ''}`.trim()
  )
}

function connectToSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(path)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`Timed out connecting to ${path}.`))
    }, 750)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function toParticipant(state: RpcVoiceState, talking: boolean): Participant | null {
  const user = state.user
  if (!user?.id) return null
  const name = state.nick?.trim() || user.global_name?.trim() || user.username || 'Discord user'
  const avatar = user.avatar
  const extension = avatar?.startsWith('a_') ? 'gif' : 'png'
  const avatarUrl = avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${avatar}.${extension}?size=96`
    : `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex(user.id)}.png`
  const voice = state.voice_state
  return {
    id: user.id,
    name,
    username: user.username ?? name,
    avatarUrl,
    muted: Boolean(state.mute || voice?.mute || voice?.self_mute),
    deafened: Boolean(voice?.deaf || voice?.self_deaf),
    talking
  }
}

function defaultAvatarIndex(id: string): number {
  try {
    return Number(BigInt(id) % 6n)
  } catch {
    return 0
  }
}

function rpcErrorMessage(data: Record<string, unknown> | null | undefined): string {
  const message = data?.message
  const code = data?.code
  return typeof message === 'string'
    ? `Discord RPC error${code ? ` ${String(code)}` : ''}: ${message}`
    : 'Discord rejected the RPC request.'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
