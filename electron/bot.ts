import { EventEmitter } from 'node:events'
import {
  Client,
  GatewayIntentBits,
  type VoiceState
} from 'discord.js'
import {
  joinVoiceChannel,
  type VoiceConnection
} from '@discordjs/voice'
import type { Participant, VoiceSnapshot } from './types'

export class BotMonitor extends EventEmitter {
  private client: Client | null = null
  private connection: VoiceConnection | null = null
  private targetUserId = ''
  private speakingUsers = new Set<string>()
  private targetState: VoiceState | null = null

  async start(token: string, userId: string): Promise<void> {
    await this.stop()
    this.targetUserId = userId

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    })
    this.client = client

    client.once('ready', () => {
      this.emit('status', `Connected as ${client.user?.tag ?? 'Discord bot'}`)
      void this.refresh()
    })
    client.on('voiceStateUpdate', (oldState, newState) => {
      if (oldState.id === this.targetUserId || newState.id === this.targetUserId) {
        void this.refresh()
        return
      }

      if (
        this.targetState &&
        newState.guild.id === this.targetState.guild.id &&
        newState.channelId === this.targetState.channelId
      ) {
        void this.refresh()
      }
    })
    client.on('error', (error) => {
      this.emit('status', `Discord connection error: ${error.message}`)
    })

    try {
      await client.login(token)
    } catch (error) {
      await this.stop()
      throw new Error(`Could not connect to Discord: ${messageFor(error)}`)
    }
  }

  async stop(): Promise<void> {
    this.targetState = null
    this.speakingUsers.clear()
    this.connection?.destroy()
    this.connection = null
    if (this.client) {
      this.client.destroy()
      this.client = null
    }
    this.targetUserId = ''
    this.emitSnapshot({
      connected: false,
      targetInVoice: false,
      guildName: null,
      channelName: null,
      participants: [],
      message: 'Disconnected'
    })
    this.emit('status', 'Disconnected')
  }

  private async refresh(): Promise<void> {
    const client = this.client
    if (!client?.isReady()) return

    const activeState = [...client.guilds.cache.values()]
      .map((guild) => guild.voiceStates.cache.get(this.targetUserId))
      .find((state) => Boolean(state?.channelId))

    if (!activeState?.channelId || !activeState.channel) {
      this.targetState = null
      this.leaveVoiceChannel()
      this.emitSnapshot({
        connected: true,
        targetInVoice: false,
        guildName: null,
        channelName: null,
        participants: [],
        message: 'The tracked account is not in a voice channel the bot can see.'
      })
      return
    }

    this.targetState = activeState
    this.joinVoiceChannel(activeState)
    const guild = activeState.guild
    const channelId = activeState.channelId
    const channelStates = [...guild.voiceStates.cache.values()]
      .filter((state) =>
        state.channelId === channelId &&
        state.member &&
        state.id !== client.user?.id
      )
    const participantIds = new Set(channelStates.map((state) => state.id))
    this.speakingUsers = new Set([...this.speakingUsers].filter((id) => participantIds.has(id)))
    const participants = channelStates
      .map((state): Participant => {
        const member = state.member!
        const user = member.user
        return {
          id: user.id,
          name: member.displayName,
          username: user.username,
          avatarUrl: member.displayAvatarURL({ extension: 'png', size: 96 }),
          muted: Boolean(state.mute || state.selfMute),
          deafened: Boolean(state.deaf || state.selfDeaf),
          talking: this.speakingUsers.has(user.id)
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name))

    this.emitSnapshot({
      connected: true,
      targetInVoice: true,
      guildName: guild.name,
      channelName: activeState.channel.name,
      participants,
      message: `Watching ${activeState.channel.name}`
    })
  }

  private joinVoiceChannel(state: VoiceState): void {
    if (!state.channelId || !state.channel) return
    if (
      this.connection?.joinConfig.guildId === state.guild.id &&
      this.connection.joinConfig.channelId === state.channelId
    ) {
      return
    }

    this.leaveVoiceChannel()
    const connection = joinVoiceChannel({
      channelId: state.channelId,
      guildId: state.guild.id,
      adapterCreator: state.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true
    })
    this.connection = connection
    connection.receiver.speaking.on('start', (userId) => {
      this.speakingUsers.add(userId)
      void this.refresh()
    })
    connection.receiver.speaking.on('end', (userId) => {
      this.speakingUsers.delete(userId)
      void this.refresh()
    })
    connection.on('error', (error) => {
      this.emit('status', `Voice connection error: ${error.message}`)
    })
  }

  private leaveVoiceChannel(): void {
    this.connection?.destroy()
    this.connection = null
    this.speakingUsers.clear()
  }

  private emitSnapshot(snapshot: VoiceSnapshot): void {
    this.emit('voice', snapshot)
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
