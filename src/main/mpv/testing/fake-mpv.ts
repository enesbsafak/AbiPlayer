/**
 * A scriptable stand-in for mpv: an injectable spawner and pipe connector
 * whose peer speaks the JSON IPC protocol. Tests never start a real mpv.
 *
 * By default each fake answers the way mpv does for the commands the
 * controller sends; individual commands can be held back and released later
 * to stage races.
 */
import type { MpvIpcStream } from '../protocol'
import type { MpvConnector, MpvExitInfo, MpvProcessHandle, MpvSpawner } from '../process'

export interface ReceivedCommand {
  requestId: number | null
  command: unknown[]
}

type Reply = { data?: unknown; error?: string }

export class FakeMpvPeer implements MpvIpcStream {
  destroyed = false
  private dataListeners: Array<(chunk: string) => void> = []
  private closeListeners: Array<() => void> = []

  constructor(private readonly onLine: (line: string) => void) {}

  write(line: string): void {
    if (this.destroyed) return
    for (const part of line.split('\n')) {
      if (part.trim()) this.onLine(part)
    }
  }

  onData(listener: (chunk: string) => void): void {
    this.dataListeners.push(listener)
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener)
  }

  destroy(): void {
    this.hangUp()
  }

  /** Delivers raw bytes to the client, exactly as given. */
  sendRaw(chunk: string): void {
    if (this.destroyed) return
    for (const listener of this.dataListeners) listener(chunk)
  }

  send(message: object): void {
    this.sendRaw(`${JSON.stringify(message)}\n`)
  }

  /** The mpv side closes the connection. */
  hangUp(): void {
    if (this.destroyed) return
    this.destroyed = true
    const listeners = this.closeListeners
    this.closeListeners = []
    for (const listener of listeners) listener()
  }
}

export class FakeMpvProcess implements MpvProcessHandle {
  readonly signals: string[] = []
  exited = false
  /** Whether the pipe accepts connections. */
  listening = true
  /** Whether SIGTERM ends the process (SIGKILL always does). */
  exitsOnTerm = true
  peer: FakeMpvPeer | null = null
  readonly received: ReceivedCommand[] = []
  readonly properties = new Map<string, unknown>()
  /** Commands (by name) whose replies are held until `release`. */
  readonly holding = new Set<string>()
  private held: ReceivedCommand[] = []
  private nextEntryId = 1
  private currentEntryId: number | null = null
  /** Whether `loadfile` replies include `playlist_entry_id`. */
  replyEntryIds = true
  private exitListeners: Array<(info: MpvExitInfo) => void> = []
  private errorListeners: Array<(error: Error) => void> = []

  constructor(
    readonly binary: string,
    readonly args: string[]
  ) {}

  get socketPath(): string {
    const arg = this.args.find((value) => value.startsWith('--input-ipc-server='))
    return arg ? arg.slice('--input-ipc-server='.length) : ''
  }

  get entryId(): number | null {
    return this.currentEntryId
  }

  /** A wedged process: records signals but never exits from them. */
  ignoresSignals = false

  kill(signal: 'SIGTERM' | 'SIGKILL'): void {
    this.signals.push(signal)
    if (this.ignoresSignals) return
    if (signal === 'SIGKILL' || this.exitsOnTerm) this.exit(null, signal)
  }

  onExit(listener: (info: MpvExitInfo) => void): void {
    this.exitListeners.push(listener)
  }

  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener)
  }

  /** The process ends (crash, quit, or a signal). Its pipe goes with it. */
  exit(code: number | null = 0, signal: string | null = null): void {
    if (this.exited) return
    this.exited = true
    this.listening = false
    this.peer?.hangUp()
    for (const listener of this.exitListeners) listener({ code, signal })
  }

  failToSpawn(error = new Error('spawn mpv ENOENT')): void {
    this.listening = false
    for (const listener of this.errorListeners) listener(error)
  }

  connect(): FakeMpvPeer {
    const peer = new FakeMpvPeer((line) => this.receive(line))
    this.peer = peer
    return peer
  }

  commands(name?: string): unknown[][] {
    return this.received
      .map((entry) => entry.command)
      .filter((command) => name === undefined || command[0] === name)
  }

  setProperties(): Array<[string, unknown]> {
    return this.commands('set_property').map((command) => [command[1] as string, command[2]])
  }

  /** Replies to every held command (or only those named). */
  release(name?: string): void {
    const releasing = this.held.filter((entry) => name === undefined || entry.command[0] === name)
    this.held = this.held.filter((entry) => !releasing.includes(entry))
    for (const entry of releasing) this.answer(entry)
  }

  reply(requestId: number, reply: Reply): void {
    this.peer?.send({ request_id: requestId, error: reply.error ?? 'success', data: reply.data })
  }

  event(message: object): void {
    this.peer?.send(message)
  }

  /** Reports a property change; the value is also what `get_property` returns. */
  propertyChange(name: string, data?: unknown): void {
    if (data === undefined) this.properties.delete(name)
    else this.properties.set(name, data)
    this.peer?.send(data === undefined ? { event: 'property-change', name } : { event: 'property-change', name, data })
  }

  startFile(entryId: number | null = this.currentEntryId): void {
    this.event(entryId === null ? { event: 'start-file' } : { event: 'start-file', playlist_entry_id: entryId })
  }

  fileLoaded(): void {
    this.event({ event: 'file-loaded' })
  }

  playbackRestart(): void {
    this.event({ event: 'playback-restart' })
  }

  endFile(reason: string, extra: Record<string, unknown> = {}, entryId = this.currentEntryId): void {
    this.event({ event: 'end-file', reason, playlist_entry_id: entryId, ...extra })
  }

  private receive(line: string): void {
    const parsed = JSON.parse(line) as { command: unknown[]; request_id?: number }
    const entry: ReceivedCommand = {
      requestId: typeof parsed.request_id === 'number' ? parsed.request_id : null,
      command: parsed.command
    }
    this.received.push(entry)
    if (this.holding.has(String(entry.command[0]))) {
      this.held.push(entry)
      return
    }
    // Replies go out asynchronously, as they would over a real pipe.
    queueMicrotask(() => this.answer(entry))
  }

  private answer(entry: ReceivedCommand): void {
    const [name, ...rest] = entry.command
    let reply: Reply = {}

    switch (name) {
      case 'quit':
        this.exit(0)
        return
      case 'loadfile': {
        const id = this.nextEntryId++
        this.currentEntryId = id
        this.properties.set('path', rest[0])
        reply = this.replyEntryIds ? { data: { playlist_entry_id: id } } : {}
        break
      }
      case 'set_property':
        this.properties.set(String(rest[0]), rest[1])
        break
      case 'get_property': {
        const key = String(rest[0])
        reply = this.properties.has(key)
          ? { data: this.properties.get(key) }
          : { error: 'property unavailable' }
        break
      }
      default:
        break
    }

    if (entry.requestId !== null) this.reply(entry.requestId, reply)
  }
}

/** Owns every fake process spawned by one controller. */
export class FakeMpv {
  readonly processes: FakeMpvProcess[] = []
  /** Applied to each process right after it is spawned, before it can connect. */
  onSpawn: (process: FakeMpvProcess) => void = () => undefined

  readonly spawn: MpvSpawner = (binary, args) => {
    const fake = new FakeMpvProcess(binary, args)
    this.processes.push(fake)
    this.onSpawn(fake)
    return fake
  }

  readonly connect: MpvConnector = async (socketPath) => {
    const fake = this.processes.find((candidate) => candidate.socketPath === socketPath)
    if (!fake || !fake.listening || fake.exited) {
      throw new Error(`connect ENOENT ${socketPath}`)
    }
    return fake.connect()
  }

  get last(): FakeMpvProcess {
    const fake = this.processes[this.processes.length - 1]
    if (!fake) throw new Error('no mpv process was spawned')
    return fake
  }

  get alive(): FakeMpvProcess[] {
    return this.processes.filter((fake) => !fake.exited)
  }
}
