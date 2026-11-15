/**
 * mpv JSON IPC: newline-delimited JSON over a named pipe / unix socket.
 * Replies carry the `request_id` we sent; everything else is an event.
 */

export interface MpvMessage {
  request_id?: number
  error?: string
  data?: unknown
  event?: string
  name?: string
  id?: number
  reason?: string
  file_error?: string
  playlist_entry_id?: number
  playlist_insert_id?: number
  playlist_insert_num_entries?: number
}

/** The transport one session talks over. Chunks arrive as UTF-8 text. */
export interface MpvIpcStream {
  write(line: string): void
  onData(listener: (chunk: string) => void): void
  /** Fires once when the connection is gone, whoever closed it. */
  onClose(listener: () => void): void
  destroy(): void
}

export const MPV_REQUEST_TIMEOUT_MS = 5000

/** Splits a byte stream into JSON messages; a message may span chunks. */
export class MpvLineDecoder {
  private buffer = ''

  push(chunk: string): MpvMessage[] {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''

    const messages: MpvMessage[] = []
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      try {
        const parsed: unknown = JSON.parse(line)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          messages.push(parsed as MpvMessage)
        }
      } catch {
        // mpv only ever writes JSON here; a malformed line is dropped rather
        // than allowed to poison the rest of the stream.
      }
    }
    return messages
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class MpvIpcClosedError extends Error {
  constructor(message = 'mpv IPC bağlantısı kesildi') {
    super(message)
    this.name = 'MpvIpcClosedError'
  }
}

/**
 * Request/response correlation for one connection. Owned by exactly one
 * session; once closed it rejects everything and never reopens.
 */
export class MpvIpcClient {
  private readonly decoder = new MpvLineDecoder()
  private readonly pending = new Map<number, PendingRequest>()
  private nextRequestId = 1
  private closedFlag = false

  constructor(
    private readonly stream: MpvIpcStream,
    private readonly handlers: {
      onEvent: (message: MpvMessage) => void
      /** The peer closed the connection (not called for `close()`). */
      onRemoteClose: () => void
    }
  ) {
    stream.onData((chunk) => this.receive(chunk))
    stream.onClose(() => {
      if (this.closedFlag) return
      this.shutdown()
      this.handlers.onRemoteClose()
    })
  }

  get closed(): boolean {
    return this.closedFlag
  }

  request(command: unknown[], timeoutMs = MPV_REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.closedFlag) return Promise.reject(new MpvIpcClosedError())

    const requestId = this.allocRequestId()
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('mpv komut zaman aşımına uğradı'))
      }, timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer })
      this.stream.write(`${JSON.stringify({ command, request_id: requestId })}\n`)
    })
  }

  /** Fire-and-forget write; used for `quit`, whose reply may never come. */
  send(command: unknown[]): void {
    if (this.closedFlag) return
    this.stream.write(`${JSON.stringify({ command })}\n`)
  }

  close(): void {
    if (this.closedFlag) return
    this.shutdown()
    this.stream.destroy()
  }

  private shutdown(): void {
    this.closedFlag = true
    const pending = Array.from(this.pending.values())
    this.pending.clear()
    for (const entry of pending) {
      clearTimeout(entry.timer)
      entry.reject(new MpvIpcClosedError())
    }
  }

  private receive(chunk: string): void {
    if (this.closedFlag) return
    for (const message of this.decoder.push(chunk)) {
      // A handler below may have closed us mid-chunk; the rest is stale.
      if (this.closedFlag) return
      if (typeof message.request_id === 'number' && message.event === undefined) {
        this.settle(message)
      } else if (typeof message.event === 'string') {
        this.handlers.onEvent(message)
      }
    }
  }

  private settle(message: MpvMessage): void {
    const requestId = message.request_id as number
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    if (message.error && message.error !== 'success') {
      pending.reject(new Error(message.error))
    } else {
      pending.resolve(message.data)
    }
  }

  private allocRequestId(): number {
    // mpv echoes the id opaquely; wrap well inside the safe-integer range.
    if (this.nextRequestId >= Number.MAX_SAFE_INTEGER) this.nextRequestId = 1
    const id = this.nextRequestId
    this.nextRequestId += 1
    return id
  }
}
