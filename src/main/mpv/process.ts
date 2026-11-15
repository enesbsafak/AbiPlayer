import { spawn } from 'child_process'
import net from 'net'
import type { MpvIpcStream } from './protocol'

export interface MpvExitInfo {
  code: number | null
  signal: string | null
}

/** The slice of a child process a session needs; faked in tests. */
export interface MpvProcessHandle {
  kill(signal: 'SIGTERM' | 'SIGKILL'): void
  /** Called once when the process has exited. */
  onExit(listener: (info: MpvExitInfo) => void): void
  /** The process could not be started (or signalled). */
  onError(listener: (error: Error) => void): void
}

export type MpvSpawner = (binary: string, args: string[]) => MpvProcessHandle

/** One connection attempt; rejects when nothing is listening yet. */
export type MpvConnector = (socketPath: string) => Promise<MpvIpcStream>

export const spawnMpvProcess: MpvSpawner = (binary, args) => {
  // `--terminal=no` keeps mpv silent; failures arrive over the IPC event
  // stream. Ignoring stdio means no pipe can ever fill up and stall the child.
  const child = spawn(binary, args, { windowsHide: true, stdio: 'ignore' })
  return {
    kill: (signal) => {
      try {
        child.kill(signal)
      } catch {
        // Already gone; the exit listener reports it.
      }
    },
    onExit: (listener) => {
      child.once('exit', (code, signal) => listener({ code, signal }))
    },
    onError: (listener) => {
      child.on('error', listener)
    }
  }
}

export const connectMpvSocket: MpvConnector = (socketPath) =>
  new Promise<MpvIpcStream>((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    const onConnectError = (error: Error) => {
      socket.destroy()
      reject(error)
    }
    socket.once('error', onConnectError)
    socket.once('connect', () => {
      socket.off('error', onConnectError)
      socket.setEncoding('utf8')
      // A write or read error is followed by 'close', which the session
      // handles; the listener only keeps the error from being thrown.
      socket.on('error', () => undefined)
      resolve({
        write: (line) => {
          if (!socket.destroyed) socket.write(line)
        },
        onData: (listener) => {
          socket.on('data', (chunk: string) => listener(chunk))
        },
        onClose: (listener) => {
          socket.once('close', () => listener())
        },
        destroy: () => socket.destroy()
      })
    })
  })
