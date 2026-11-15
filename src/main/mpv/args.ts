import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

export function createMpvSocketPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return `\\\\.\\pipe\\freeiptv-mpv-${process.pid}-${randomUUID()}`
  }
  return join(tmpdir(), `freeiptv-mpv-${process.pid}-${randomUUID()}.sock`)
}

/**
 * `auto-safe` limits mpv to the hardware decoders on its own known-good list,
 * which is what keeps a flaky driver from producing a black picture; `auto`
 * would happily pick those. `no` forces software decoding.
 */
export function hwdecValue(hardwareDecoding: boolean): string {
  return hardwareDecoding ? 'auto-safe' : 'no'
}

export interface MpvLaunchOptions {
  socketPath: string
  parentWid: string | null
  hardwareDecoding: boolean
}

export function buildMpvLaunchArgs(options: MpvLaunchOptions): string[] {
  const args = [
    // The app owns every setting: a user's own mpv.conf, input.conf or
    // scripts must not change how the embedded player behaves, and a failed
    // URL must not spawn yt-dlp.
    '--no-config',
    '--load-scripts=no',
    '--ytdl=no',
    '--idle=yes',
    '--keep-open=yes',
    '--player-operation-mode=cplayer',
    // Keep this, including for the pre-warmed idle process. The Electron
    // window is transparent and the player page draws a transparent
    // background so the mpv surface shows through; without an mpv window the
    // user would see straight through to the desktop while a stream loads.
    // Outside the player route the page is opaque and covers the idle surface.
    '--force-window=immediate',
    '--keepaspect-window=no',
    '--input-terminal=no',
    '--terminal=no',
    '--osd-level=0',
    '--no-osc',
    '--no-input-default-bindings',
    '--input-vo-keyboard=no',
    '--pause=yes',
    `--hwdec=${hwdecValue(options.hardwareDecoding)}`,
    // NOTE: --audio-spdif must NEVER be added here. Passed as a launch
    // argument it deadlocks mpv outright when the device rejects the
    // bitstream — the process hangs before it even creates the IPC socket,
    // leaving no way out but SIGKILL. Applied later via set_property the very
    // same value degrades gracefully instead (see the passthrough verifier).
    // Network resilience for live streams
    '--network-timeout=30',
    '--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_delay_max=5,reconnect_on_network_error=1',
    '--demuxer-max-bytes=150MiB',
    '--demuxer-max-back-bytes=50MiB',
    '--cache=yes',
    '--cache-secs=30',
    // Verify TLS against the system store. A host the user trusted gets its
    // own options per load (loadfile file options, see src/main/tls/policy.ts),
    // so relaxing one host never relaxes another.
    '--tls-verify=yes',
    `--input-ipc-server=${options.socketPath}`
  ]

  if (options.parentWid) {
    args.push(`--wid=${options.parentWid}`)
  }

  return args
}
