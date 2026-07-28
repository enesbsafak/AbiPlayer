import { beforeAll, describe, expect, it } from 'vitest'

// The controller resolves its binary path in a field initializer, which pokes
// at `process.resourcesPath` (Electron-only). Short-circuit that via the env
// override so the class can be constructed in a plain Node test runner.
process.env['MPV_PATH'] = 'mpv'

type SocketDataSink = { onSocketData(chunk: string): void }

let MpvController: typeof import('./mpv-controller').MpvController

beforeAll(async () => {
  ;({ MpvController } = await import('./mpv-controller'))
})

function feed(controller: unknown, ...messages: object[]): void {
  const sink = controller as unknown as SocketDataSink
  sink.onSocketData(messages.map((message) => JSON.stringify(message)).join('\n') + '\n')
}

describe('MpvController socket events', () => {
  // mpv runs with `--terminal=no` and prints to stdout rather than stderr, so
  // the JSON IPC `end-file` event is the only channel that reports a failed
  // stream. Without it the UI shows no error and never auto-reconnects.
  it('surfaces a load failure reported through end-file', () => {
    const controller = new MpvController()

    feed(
      controller,
      { event: 'start-file', playlist_entry_id: 1 },
      { event: 'end-file', reason: 'error', playlist_entry_id: 1, file_error: 'loading failed' }
    )

    const state = controller.getState()
    expect(state.error).toBe('Yayın açılamadı. Kaynak yanıt vermiyor veya adres geçersiz.')
    expect(state.running).toBe(false)
  })

  it('passes through unmapped file_error strings instead of dropping them', () => {
    const controller = new MpvController()

    feed(controller, { event: 'end-file', reason: 'error', file_error: 'http 403' })

    expect(controller.getState().error).toBe('Yayın açılamadı: http 403')
  })

  it('ignores non-error end-file reasons so normal stops are not shown as failures', () => {
    const controller = new MpvController()

    for (const reason of ['eof', 'stop', 'quit', 'redirect']) {
      feed(controller, { event: 'end-file', reason })
      expect(controller.getState().error).toBeNull()
    }
  })

  it('clears a previous error when the next file starts loading', () => {
    const controller = new MpvController()

    feed(controller, { event: 'end-file', reason: 'error', file_error: 'loading failed' })
    expect(controller.getState().error).not.toBeNull()

    feed(controller, { event: 'start-file', playlist_entry_id: 2 })
    expect(controller.getState().error).toBeNull()
  })

  it('still applies observed property changes alongside lifecycle events', () => {
    const controller = new MpvController()

    feed(
      controller,
      { event: 'property-change', name: 'pause', data: false },
      { event: 'property-change', name: 'volume', data: 55 },
      { event: 'property-change', name: 'path', data: 'http://example.test/stream.m3u8' }
    )

    const state = controller.getState()
    expect(state.paused).toBe(false)
    expect(state.volume).toBe(55)
    expect(state.running).toBe(true)
  })
})
