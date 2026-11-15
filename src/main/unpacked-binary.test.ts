import { describe, expect, it } from 'vitest'
import { resolveMediaTools, type MediaToolEnvironment } from './unpacked-binary'

function env(overrides: Partial<MediaToolEnvironment>, existing: string[]): MediaToolEnvironment {
  const present = new Set(existing)
  return {
    platform: 'win32',
    isPackaged: true,
    resourcesPath: 'C:\\App\\resources',
    appDir: 'C:\\repo\\out\\main',
    cwd: 'C:\\repo',
    exists: (candidate) => present.has(candidate),
    ...overrides
  }
}

describe('resolveMediaTools', () => {
  it('uses the copy shipped as an extra resource in a packaged build', () => {
    expect(
      resolveMediaTools(env({}, ['C:\\App\\resources\\ffmpeg\\ffmpeg.exe', 'C:\\App\\resources\\ffmpeg\\ffprobe.exe']))
    ).toEqual({
      ffmpeg: 'C:\\App\\resources\\ffmpeg\\ffmpeg.exe',
      ffprobe: 'C:\\App\\resources\\ffmpeg\\ffprobe.exe'
    })
  })

  it('never falls back to the checkout or the working directory when packaged', () => {
    const resolved = resolveMediaTools(
      env({ cwd: 'C:\\Users\\me\\Downloads' }, [
        'C:\\repo\\resources\\ffmpeg\\win32-x64\\ffmpeg.exe',
        'C:\\Users\\me\\Downloads\\resources\\ffmpeg\\win32-x64\\ffprobe.exe'
      ])
    )
    expect(resolved).toEqual({ ffmpeg: null, ffprobe: null })
  })

  it('uses the prepared checkout copy in development', () => {
    const dev = { isPackaged: false, resourcesPath: 'C:\\repo\\node_modules\\electron\\dist\\resources' }
    expect(
      resolveMediaTools(
        env(dev, [
          'C:\\repo\\resources\\ffmpeg\\win32-x64\\ffmpeg.exe',
          'C:\\repo\\resources\\ffmpeg\\win32-x64\\ffprobe.exe'
        ])
      )
    ).toEqual({
      ffmpeg: 'C:\\repo\\resources\\ffmpeg\\win32-x64\\ffmpeg.exe',
      ffprobe: 'C:\\repo\\resources\\ffmpeg\\win32-x64\\ffprobe.exe'
    })
  })

  it('reports a missing binary as null instead of guessing', () => {
    expect(resolveMediaTools(env({}, ['C:\\App\\resources\\ffmpeg\\ffmpeg.exe']))).toEqual({
      ffmpeg: 'C:\\App\\resources\\ffmpeg\\ffmpeg.exe',
      ffprobe: null
    })
  })

  it('ships nothing outside Windows', () => {
    expect(resolveMediaTools(env({ platform: 'linux' }, ['C:\\App\\resources\\ffmpeg\\ffmpeg.exe']))).toEqual({
      ffmpeg: null,
      ffprobe: null
    })
  })
})
