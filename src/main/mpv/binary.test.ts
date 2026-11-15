// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveMpvBinary, type MpvBinaryEnvironment } from './binary'

function env(overrides: Partial<MpvBinaryEnvironment>, files: string[]): MpvBinaryEnvironment {
  const existing = new Set(files)
  return {
    platform: 'win32',
    isPackaged: true,
    resourcesPath: 'C:\\App\\resources',
    appDir: 'C:\\App\\resources\\app.asar\\out\\main',
    cwd: 'C:\\Users\\someone\\Downloads',
    searchPath: 'C:\\Tools;C:\\Windows',
    exists: (candidate) => existing.has(candidate),
    ...overrides
  }
}

describe('resolveMpvBinary', () => {
  it('uses the copy shipped in a packaged Windows build', () => {
    expect(resolveMpvBinary(env({}, ['C:\\App\\resources\\mpv\\mpv.exe']))).toBe(
      'C:\\App\\resources\\mpv\\mpv.exe'
    )
  })

  it('ignores MPV_PATH, the working directory and PATH once packaged', () => {
    const resolved = resolveMpvBinary(
      env({ mpvPathOverride: 'C:\\evil\\mpv.exe' }, [
        'C:\\evil\\mpv.exe',
        'C:\\Users\\someone\\Downloads\\resources\\mpv\\win32-x64\\mpv.exe',
        'C:\\Tools\\mpv.exe'
      ])
    )
    expect(resolved).toBeNull()
  })

  it('honours MPV_PATH when not packaged (the test harness relies on it)', () => {
    expect(
      resolveMpvBinary(env({ isPackaged: false, mpvPathOverride: 'D:\\mpv\\mpv.exe' }, ['D:\\mpv\\mpv.exe']))
    ).toBe('D:\\mpv\\mpv.exe')
    // A bare command name is looked up on PATH.
    expect(
      resolveMpvBinary(env({ isPackaged: false, mpvPathOverride: 'mpv' }, ['C:\\Tools\\mpv.exe']))
    ).toBe('C:\\Tools\\mpv.exe')
  })

  it('finds the checkout copy and then PATH in development', () => {
    const dev = { isPackaged: false, resourcesPath: undefined, appDir: 'C:\\repo\\out\\main', cwd: 'C:\\repo' }
    expect(resolveMpvBinary(env(dev, ['C:\\repo\\resources\\mpv\\win32-x64\\mpv.exe']))).toBe(
      'C:\\repo\\resources\\mpv\\win32-x64\\mpv.exe'
    )
    expect(resolveMpvBinary(env(dev, ['C:\\Windows\\mpv.exe']))).toBe('C:\\Windows\\mpv.exe')
  })

  it('only accepts fixed system locations in packaged macOS and Linux builds', () => {
    const linux = { platform: 'linux' as const, resourcesPath: '/opt/app/resources', searchPath: '/home/u/bin:/usr/bin' }
    expect(resolveMpvBinary(env(linux, ['/home/u/bin/mpv']))).toBeNull()
    expect(resolveMpvBinary(env(linux, ['/usr/bin/mpv']))).toBe('/usr/bin/mpv')
    expect(resolveMpvBinary(env({ ...linux, isPackaged: false }, ['/home/u/bin/mpv']))).toBe(
      '/home/u/bin/mpv'
    )
  })
})
