// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MpvIpcClient, MpvIpcClosedError, MpvLineDecoder, type MpvMessage } from './protocol'
import { FakeMpvPeer } from './testing/fake-mpv'

describe('MpvLineDecoder', () => {
  it('reassembles a message split across chunks', () => {
    const decoder = new MpvLineDecoder()
    expect(decoder.push('{"event":"prop')).toEqual([])
    expect(decoder.push('erty-change","name":"pause"')).toEqual([])
    expect(decoder.push(',"data":true}\n')).toEqual([
      { event: 'property-change', name: 'pause', data: true }
    ])
  })

  it('yields every message when several arrive in one chunk', () => {
    const decoder = new MpvLineDecoder()
    const messages = decoder.push('{"event":"a"}\n{"event":"b"}\n{"event":"c"')
    expect(messages.map((message) => message.event)).toEqual(['a', 'b'])
    expect(decoder.push('}\n').map((message) => message.event)).toEqual(['c'])
  })

  it('drops malformed lines without losing the ones around them', () => {
    const decoder = new MpvLineDecoder()
    const messages = decoder.push('{"event":"a"}\nnot json\n[1,2]\n\n{"event":"b"}\n')
    expect(messages.map((message) => message.event)).toEqual(['a', 'b'])
  })
})

describe('MpvIpcClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const written: Array<{ command: unknown[]; request_id?: number }> = []
    const peer = new FakeMpvPeer((line) => written.push(JSON.parse(line)))
    const events: MpvMessage[] = []
    const onRemoteClose = vi.fn()
    const client = new MpvIpcClient(peer, { onEvent: (message) => events.push(message), onRemoteClose })
    return { written, peer, events, client, onRemoteClose }
  }

  it('matches replies to requests by request_id, in any order', async () => {
    const { written, peer, client } = setup()

    const first = client.request(['get_property', 'volume'])
    const second = client.request(['get_property', 'mute'])
    const [a, b] = written.map((entry) => entry.request_id)

    peer.send({ request_id: b, error: 'success', data: true })
    peer.send({ request_id: a, error: 'success', data: 55 })

    await expect(first).resolves.toBe(55)
    await expect(second).resolves.toBe(true)
  })

  it('rejects with mpv error strings', async () => {
    const { written, peer, client } = setup()
    const pending = client.request(['get_property', 'nope'])
    peer.send({ request_id: written[0].request_id, error: 'property not found' })
    await expect(pending).rejects.toThrow('property not found')
  })

  it('routes events to the event handler, not to pending requests', () => {
    const { peer, events, client } = setup()
    void client.request(['get_property', 'pause']).catch(() => undefined)
    peer.sendRaw('{"event":"start-file","playlist_entry_id":3}\n{"event":"pro')
    peer.sendRaw('perty-change","name":"pause","data":false}\n')
    expect(events).toEqual([
      { event: 'start-file', playlist_entry_id: 3 },
      { event: 'property-change', name: 'pause', data: false }
    ])
  })

  it('times a request out and ignores its late reply', async () => {
    const { written, peer, client } = setup()
    const pending = client.request(['get_property', 'volume'], 1000)
    const assertion = expect(pending).rejects.toThrow('zaman aşımı')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    // A reply after the timeout must not resolve anything or throw.
    peer.send({ request_id: written[0].request_id, error: 'success', data: 1 })
  })

  it('rejects everything pending when the peer hangs up, and reports it once', async () => {
    const { peer, client, onRemoteClose } = setup()
    const pending = client.request(['get_property', 'volume'])
    peer.hangUp()
    await expect(pending).rejects.toBeInstanceOf(MpvIpcClosedError)
    await expect(client.request(['get_property', 'mute'])).rejects.toBeInstanceOf(MpvIpcClosedError)
    expect(onRemoteClose).toHaveBeenCalledTimes(1)
  })

  it('does not report its own close as a remote hang-up', async () => {
    const { client, onRemoteClose } = setup()
    const pending = client.request(['get_property', 'volume'])
    client.close()
    await expect(pending).rejects.toBeInstanceOf(MpvIpcClosedError)
    expect(onRemoteClose).not.toHaveBeenCalled()
  })
})
