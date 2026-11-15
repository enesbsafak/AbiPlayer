// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildMpvLaunchArgs, hwdecValue } from './args'

describe('buildMpvLaunchArgs', () => {
  const args = buildMpvLaunchArgs({
    socketPath: '\\\\.\\pipe\\test',
    parentWid: '1234',
    hardwareDecoding: true
  })

  it('isolates mpv from user config, scripts and yt-dlp', () => {
    expect(args).toContain('--no-config')
    expect(args).toContain('--load-scripts=no')
    expect(args).toContain('--ytdl=no')
  })

  it('never passes audio-spdif as a launch argument', () => {
    // Passing it at launch deadlocks mpv before the IPC socket exists, which
    // is unrecoverable; passthrough is only ever applied via set_property.
    for (const hardwareDecoding of [true, false]) {
      const built = buildMpvLaunchArgs({ socketPath: 'x', parentWid: null, hardwareDecoding })
      expect(built.some((arg) => arg.startsWith('--audio-spdif'))).toBe(false)
    }
  })

  it('embeds into the given window and listens on the given pipe', () => {
    expect(args).toContain('--wid=1234')
    expect(args).toContain('--input-ipc-server=\\\\.\\pipe\\test')
    expect(
      buildMpvLaunchArgs({ socketPath: 'x', parentWid: null, hardwareDecoding: true }).some((arg) =>
        arg.startsWith('--wid=')
      )
    ).toBe(false)
  })

  it('uses the safe hardware decoder whitelist, or software decoding when off', () => {
    // `auto` would let mpv choose decoders known to misbehave on some drivers.
    expect(hwdecValue(true)).toBe('auto-safe')
    expect(hwdecValue(false)).toBe('no')
    expect(args).toContain('--hwdec=auto-safe')
  })
})
