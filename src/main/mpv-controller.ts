import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import net from 'net'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'

const MPV_REQUEST_TIMEOUT_MS = 5000
const MPV_CONNECT_TIMEOUT_MS = 8000
const MPV_CONNECT_RETRY_MS = 150

interface MpvPendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface MpvSocketResponse {
  request_id?: number
  error?: string
  data?: unknown
  event?: string
  name?: string
}

export interface MpvSubtitleStyle {
  fontSize: number
  color: string
  background: string
}

export interface MpvTrackInfo {
  id: number
  type: 'audio' | 'sub'
  title?: string
  lang?: string
  codec?: string
  selected: boolean
  external: boolean
}

export interface MpvStateSnapshot {
  available: boolean
  running: boolean
  paused: boolean
  buffering: boolean
  timePos: number
  duration: number
  volume: number
  muted: boolean
  aid: number | null
  sid: number | null
  fullscreen: boolean
  tracks: MpvTrackInfo[]
  path: string | null
  error: string | null
}

function createMpvSocketPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\freeiptv-mpv-${process.pid}-${randomUUID()}`
  }

  return join(tmpdir(), `freeiptv-mpv-${process.pid}-${randomUUID()}.sock`)
}

function resolveBundledMpvPath(): string | null {
  if (process.platform !== 'win32') return null

  const candidates = [
    join(process.resourcesPath, 'mpv', 'mpv.exe'),
    join(process.resourcesPath, 'resources', 'mpv', 'win32-x64', 'mpv.exe'),
    join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'mpv', 'win32-x64', 'mpv.exe'),
    join(__dirname, '../../resources/mpv/win32-x64/mpv.exe'),
    join(process.cwd(), 'resources', 'mpv', 'win32-x64', 'mpv.exe')
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return fallback
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  return fallback
}

function normalizeTrackType(value: unknown): 'audio' | 'sub' | null {
  if (value === 'audio' || value === 'sub') return value
  return null
}

export class MpvController {
  private process: ChildProcessWithoutNullStreams | null = null
  private socket: net.Socket | null = null
  private socketPath: string | null = null
  private socketBuffer = ''
  private startupPromise: Promise<void> | null = null
  private startupParentWid: string | null = null
  private nextRequestId = 1
  private pendingRequests = new Map<number, MpvPendingRequest>()
  private availabilityChecked = false
  private availability = false
  private readonly mpvPath = process.env['MPV_PATH'] || resolveBundledMpvPath() || 'mpv'
  private subtitleStyle: MpvSubtitleStyle = {
    fontSize: 24,
    color: '#ffffff',
    background: 'rgba(0,0,0,0.75)'
  }

  private state: MpvStateSnapshot = {
    available: false,
    running: false,
    paused: true,
    buffering: false,
    timePos: 0,
    duration: 0,
    volume: 80,
    muted: false,
    aid: null,
    sid: null,
    fullscreen: false,
    tracks: [],
    path: null,
    error: null
  }

  async isAvailable(): Promise<boolean> {
    if (this.availabilityChecked) return this.availability

    this.availability = await new Promise<boolean>((resolve) => {
      const child = spawn(this.mpvPath, ['--version'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore']
      })

      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill('SIGKILL')
        resolve(false)
      }, 2500)

      child.on('error', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(false)
      })

      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(code === 0)
      })
    })

    this.availabilityChecked = true
    this.state.available = this.availability
    return this.availability
  }

  getState(): MpvStateSnapshot {
    return {
      ...this.state,
      tracks: this.state.tracks.map((track) => ({ ...track }))
    }
  }

  async open(url: string, parentWid?: string): Promise<void> {
    await this.ensureStarted(parentWid)
    await this.command(['loadfile', url, 'replace'])
    await this.applySubtitleStyle().catch(() => undefined)
    await this.command(['set_property', 'pause', false]).catch(() => undefined)
    this.state.path = url
    this.state.running = true
    this.state.paused = false
    this.state.error = null
  }

  async stopPlayback(): Promise<void> {
    if (!this.process) return

    await this.command(['stop']).catch(() => undefined)
    this.state.running = false
    this.state.path = null
    this.state.timePos = 0
    this.state.duration = 0
    this.state.buffering = false
    this.state.tracks = []
    this.state.aid = null
    this.state.sid = null
  }

  async shutdown(): Promise<void> {
    if (this.process && this.socket && !this.socket.destroyed) {
      await this.command(['quit']).catch(() => undefined)
    }
    await this.cleanup()
  }

  async togglePause(): Promise<void> {
    if (!this.process) return
    await this.command(['cycle', 'pause'])
  }

  async setPause(paused: boolean): Promise<void> {
    if (!this.process) return
    await this.command(['set_property', 'pause', paused])
    this.state.paused = paused
  }

  async seek(seconds: number): Promise<void> {
    if (!this.process) return
    await this.command(['seek', seconds, 'relative'])
  }

  async seekTo(seconds: number): Promise<void> {
    if (!this.process) return
    await this.command(['seek', seconds, 'absolute', 'exact'])
  }

  async setVolume(volume: number): Promise<void> {
    if (!this.process) return
    await this.command(['set_property', 'volume', volume])
    this.state.volume = volume
  }

  async setMute(muted: boolean): Promise<void> {
    if (!this.process) return
    await this.command(['set_property', 'mute', muted])
    this.state.muted = muted
  }

  async setAudioTrack(trackId: number | null): Promise<void> {
    if (!this.process) return
    const aid = trackId === null ? 'auto' : trackId
    await this.command(['set_property', 'aid', aid])
    this.state.aid = trackId
  }

  async setSubtitleTrack(trackId: number | null): Promise<void> {
    if (!this.process) return
    const sid = trackId === null ? 'no' : trackId
    await this.command(['set_property', 'sid', sid])
    this.state.sid = trackId
  }

  async addSubtitleFile(filePath: string): Promise<number | null> {
    if (!this.process) return null
    await this.command(['sub-add', filePath, 'select']).catch(async () => {
      // Older mpv builds can reject "select"; fallback to default mode.
      await this.command(['sub-add', filePath])
    })

    await this.refreshTrackState()
    return this.state.sid
  }

  async setFullscreen(fullscreen: boolean): Promise<void> {
    if (!this.process) return
    await this.command(['set_property', 'fullscreen', fullscreen])
    this.state.fullscreen = fullscreen
  }

  async setSubtitleStyle(style: MpvSubtitleStyle): Promise<void> {
    this.subtitleStyle = {
      fontSize: Number.isFinite(style.fontSize) ? style.fontSize : this.subtitleStyle.fontSize,
      color: style.color || this.subtitleStyle.color,
      background: style.background || this.subtitleStyle.background
    }

    if (!this.process) return
    await this.applySubtitleStyle().catch(() => undefined)
  }

  async refreshState(): Promise<MpvStateSnapshot> {
    if (!this.process || !this.socket || this.socket.destroyed) {
      return this.getState()
    }

    await this.refreshTrackState()

    const results = await Promise.allSettled([
      this.command(['get_property', 'pause']),
      this.command(['get_property', 'time-pos']),
      this.command(['get_property', 'duration']),
      this.command(['get_property', 'demuxer-cache-state']),
      this.command(['get_property', 'fullscreen'])
    ])

    const pause = results[0].status === 'fulfilled' ? results[0].value : undefined
    const timePos = results[1].status === 'fulfilled' ? results[1].value : undefined
    const duration = results[2].status === 'fulfilled' ? results[2].value : undefined
    const cacheState = results[3].status === 'fulfilled' ? results[3].value : undefined
    const fullscreen = results[4].status === 'fulfilled' ? results[4].value : undefined

    this.state.paused = toBoolean(pause, this.state.paused)
    this.state.timePos = toNumber(timePos, this.state.timePos)
    this.state.duration = toNumber(duration, this.state.duration)
    this.state.buffering = this.getBufferingFromCacheState(cacheState)
    this.state.fullscreen = toBoolean(fullscreen, this.state.fullscreen)
    this.state.running = !!this.state.path

    return this.getState()
  }

  private async refreshTrackState(): Promise<void> {
    const results = await Promise.allSettled([
      this.command(['get_property', 'track-list']),
      this.command(['get_property', 'aid']),
      this.command(['get_property', 'sid']),
      this.command(['get_property', 'volume']),
      this.command(['get_property', 'mute']),
      this.command(['get_property', 'path'])
    ])

    const trackList = results[0].status === 'fulfilled' ? results[0].value : undefined
    const aid = results[1].status === 'fulfilled' ? results[1].value : undefined
    const sid = results[2].status === 'fulfilled' ? results[2].value : undefined
    const volume = results[3].status === 'fulfilled' ? results[3].value : undefined
    const muted = results[4].status === 'fulfilled' ? results[4].value : undefined
    const path = results[5].status === 'fulfilled' ? results[5].value : undefined

    this.state.tracks = this.normalizeTracks(trackList)
    this.state.aid = typeof aid === 'number' && Number.isInteger(aid) ? aid : null
    this.state.sid = typeof sid === 'number' && Number.isInteger(sid) ? sid : null
    this.state.volume = Math.max(0, Math.min(100, toNumber(volume, this.state.volume)))
    this.state.muted = toBoolean(muted, this.state.muted)
    this.state.path = typeof path === 'string' && path.length > 0 ? path : this.state.path
  }

  private normalizeTracks(input: unknown): MpvTrackInfo[] {
    if (!Array.isArray(input)) return []

    const tracks: MpvTrackInfo[] = []
    for (const rawTrack of input) {
      if (!rawTrack || typeof rawTrack !== 'object') continue
      const track = rawTrack as Record<string, unknown>

      const type = normalizeTrackType(track.type)
      if (!type) continue

      const id = Number(track.id)
      if (!Number.isInteger(id) || id <= 0) continue

      tracks.push({
        id,
        type,
        title: typeof track.title === 'string' ? track.title : undefined,
        lang: typeof track.lang === 'string' ? track.lang : undefined,
        codec: typeof track.codec === 'string' ? track.codec : undefined,
        selected: toBoolean(track.selected, false),
        external: toBoolean(track.external, false)
      })
    }

    return tracks
  }

  private getBufferingFromCacheState(cacheState: unknown): boolean {
    if (!cacheState || typeof cacheState !== 'object') return false
    const state = cacheState as Record<string, unknown>
    return toBoolean(state.underrun, false)
  }

  private async ensureStarted(parentWid?: string): Promise<void> {
    const available = await this.isAvailable()
    if (!available) throw new Error('mpv ikili dosyasi bulunamadi')

    if (this.process && this.socket && !this.socket.destroyed) {
      if (parentWid && this.startupParentWid && this.startupParentWid !== parentWid) {
        await this.shutdown()
      } else {
        return
      }
    }

    if (this.startupPromise) return this.startupPromise

    this.startupPromise = this.startMpv(parentWid)
    try {
      await this.startupPromise
    } finally {
      this.startupPromise = null
    }
  }

  private async startMpv(parentWid?: string): Promise<void> {
    const socketPath = createMpvSocketPath()
    this.socketPath = socketPath
    this.startupParentWid = parentWid ?? null

    const args = [
      '--idle=yes',
      '--keep-open=yes',
      '--player-operation-mode=cplayer',
      '--force-window=immediate',
      '--keepaspect-window=no',
      '--input-terminal=no',
      '--terminal=no',
      '--osd-level=0',
      '--msg-level=all=warn',
      '--pause=yes',
      `--input-ipc-server=${socketPath}`
    ]

    if (parentWid) {
      args.push(`--wid=${parentWid}`)
    }

    const child = spawn(this.mpvPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.process = child
    this.state.error = null
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      const text = chunk.trim()
      if (!text) return
      this.state.error = text.slice(-300)
    })

    child.on('error', async (error) => {
      this.state.error = error.message
      await this.cleanup()
    })

    child.on('close', async () => {
      this.state.running = false
      this.state.path = null
      await this.cleanup()
    })

    this.socket = await this.connectSocket(socketPath)
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => this.onSocketData(chunk))
    this.socket.on('error', () => undefined)
    this.socket.on('close', () => {
      this.socket = null
    })

    await Promise.allSettled([
      this.command(['observe_property', 1001, 'pause']),
      this.command(['observe_property', 1002, 'time-pos']),
      this.command(['observe_property', 1003, 'duration']),
      this.command(['observe_property', 1004, 'aid']),
      this.command(['observe_property', 1005, 'sid']),
      this.command(['observe_property', 1006, 'track-list']),
      this.command(['observe_property', 1007, 'demuxer-cache-state']),
      this.command(['observe_property', 1008, 'volume']),
      this.command(['observe_property', 1009, 'mute']),
      this.command(['observe_property', 1010, 'path']),
      this.command(['observe_property', 1011, 'fullscreen'])
    ])

    await this.applySubtitleStyle().catch(() => undefined)

    await this.refreshState()
  }

  private async applySubtitleStyle(): Promise<void> {
    if (!this.process) return

    const fontSize = Math.max(10, Math.min(96, Math.round(this.subtitleStyle.fontSize)))
    const subtitleScale = Math.max(0.5, Math.min(3, fontSize / 24))
    const mpvFontSize = Math.max(14, Math.round(fontSize * 2.2))
    const textColor = this.toMpvColor(this.subtitleStyle.color, false, '#FFFFFF')
    const backColor = this.toMpvColor(this.subtitleStyle.background, true, '#000000BF')

    await Promise.allSettled([
      this.command(['set_property', 'sub-ass-override', 'force']),
      this.command(['set_property', 'sub-scale', subtitleScale]),
      this.command(['set_property', 'sub-font-size', mpvFontSize]),
      this.command(['set_property', 'sub-color', textColor]),
      this.command(['set_property', 'sub-back-color', backColor]),
      this.command(['set_property', 'sub-border-size', 0]),
      this.command(['set_property', 'sub-shadow-offset', 0]),
      this.command(['set_property', 'sub-border-color', '#00000000'])
    ])
  }

  private toMpvColor(input: string, includeAlpha: boolean, fallback: string): string {
    const color = this.parseCssColor(input)
    if (!color) return fallback

    const toHex = (value: number) => value.toString(16).padStart(2, '0').toUpperCase()
    const base = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
    if (!includeAlpha) return base
    return `${base}${toHex(Math.round(color.a * 255))}`
  }

  private parseCssColor(input: string): { r: number; g: number; b: number; a: number } | null {
    const value = input.trim()
    if (!value) return null

    const shortHexMatch = value.match(/^#([0-9a-fA-F]{3})$/)
    if (shortHexMatch) {
      const [r, g, b] = shortHexMatch[1].split('').map((ch) => Number.parseInt(ch + ch, 16))
      return { r, g, b, a: 1 }
    }

    const hexMatch = value.match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/)
    if (hexMatch) {
      const hex = hexMatch[1]
      const alphaHex = hexMatch[2]
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: alphaHex ? Number.parseInt(alphaHex, 16) / 255 : 1
      }
    }

    const rgbMatch = value.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9]*\.?[0-9]+))?\s*\)$/i
    )
    if (!rgbMatch) return null

    const r = Math.max(0, Math.min(255, Number.parseInt(rgbMatch[1], 10)))
    const g = Math.max(0, Math.min(255, Number.parseInt(rgbMatch[2], 10)))
    const b = Math.max(0, Math.min(255, Number.parseInt(rgbMatch[3], 10)))
    const alphaRaw = rgbMatch[4] ? Number.parseFloat(rgbMatch[4]) : 1
    const a = Number.isFinite(alphaRaw) ? Math.max(0, Math.min(1, alphaRaw)) : 1

    return { r, g, b, a }
  }

  private async connectSocket(socketPath: string): Promise<net.Socket> {
    const startedAt = Date.now()

    while (Date.now() - startedAt < MPV_CONNECT_TIMEOUT_MS) {
      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const client = net.createConnection(socketPath)
          const onError = (error: Error) => {
            client.removeAllListeners()
            client.destroy()
            reject(error)
          }

          client.once('error', onError)
          client.once('connect', () => {
            client.removeListener('error', onError)
            resolve(client)
          })
        })

        return socket
      } catch {
        await new Promise((resolve) => setTimeout(resolve, MPV_CONNECT_RETRY_MS))
      }
    }

    throw new Error('mpv IPC soketine baglanilamadi')
  }

  private onSocketData(chunk: string): void {
    this.socketBuffer += chunk
    let newlineIndex = this.socketBuffer.indexOf('\n')

    while (newlineIndex !== -1) {
      const line = this.socketBuffer.slice(0, newlineIndex).trim()
      this.socketBuffer = this.socketBuffer.slice(newlineIndex + 1)
      newlineIndex = this.socketBuffer.indexOf('\n')
      if (!line) continue

      try {
        const message = JSON.parse(line) as MpvSocketResponse
        this.handleSocketMessage(message)
      } catch {
        // ignore malformed lines
      }
    }
  }

  private handleSocketMessage(message: MpvSocketResponse): void {
    if (typeof message.request_id === 'number') {
      const pending = this.pendingRequests.get(message.request_id)
      if (!pending) return

      this.pendingRequests.delete(message.request_id)
      clearTimeout(pending.timer)

      if (message.error && message.error !== 'success') {
        pending.reject(new Error(message.error))
      } else {
        pending.resolve(message.data)
      }

      return
    }

    if (message.event !== 'property-change') return

    switch (message.name) {
      case 'pause':
        this.state.paused = toBoolean(message.data, this.state.paused)
        break
      case 'time-pos':
        this.state.timePos = toNumber(message.data, this.state.timePos)
        break
      case 'duration':
        this.state.duration = toNumber(message.data, this.state.duration)
        break
      case 'aid':
        this.state.aid =
          typeof message.data === 'number' && Number.isInteger(message.data) ? message.data : null
        break
      case 'sid':
        this.state.sid =
          typeof message.data === 'number' && Number.isInteger(message.data) ? message.data : null
        break
      case 'track-list':
        this.state.tracks = this.normalizeTracks(message.data)
        break
      case 'demuxer-cache-state':
        this.state.buffering = this.getBufferingFromCacheState(message.data)
        break
      case 'volume':
        this.state.volume = Math.max(0, Math.min(100, toNumber(message.data, this.state.volume)))
        break
      case 'mute':
        this.state.muted = toBoolean(message.data, this.state.muted)
        break
      case 'path':
        this.state.path =
          typeof message.data === 'string' && message.data.length > 0 ? message.data : null
        this.state.running = !!this.state.path
        break
      case 'fullscreen':
        this.state.fullscreen = toBoolean(message.data, this.state.fullscreen)
        break
      default:
        break
    }
  }

  private async command(
    command: unknown[],
    timeoutMs = MPV_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    const socket = this.socket
    if (!socket || socket.destroyed) throw new Error('mpv IPC soket baglantisi yok')

    const requestId = this.nextRequestId++

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error('mpv komut zaman asimina ugradi'))
      }, timeoutMs)

      this.pendingRequests.set(requestId, { resolve, reject, timer })

      const payload = JSON.stringify({
        command,
        request_id: requestId
      })

      socket.write(`${payload}\n`, (error) => {
        if (!error) return
        const pending = this.pendingRequests.get(requestId)
        if (!pending) return
        this.pendingRequests.delete(requestId)
        clearTimeout(pending.timer)
        pending.reject(error)
      })
    })
  }

  private async cleanup(): Promise<void> {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('mpv IPC baglantisi kesildi'))
      this.pendingRequests.delete(requestId)
    }

    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }

    if (this.process) {
      this.process.removeAllListeners()
      if (!this.process.killed) {
        this.process.kill('SIGKILL')
      }
      this.process = null
    }

    if (this.socketPath && process.platform !== 'win32') {
      await unlink(this.socketPath).catch(() => undefined)
    }

    this.socketPath = null
    this.startupParentWid = null
    this.socketBuffer = ''
  }
}
