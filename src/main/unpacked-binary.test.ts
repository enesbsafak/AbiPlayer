import { describe, expect, it } from 'vitest'
import { resolveUnpackedBinary } from './unpacked-binary'

describe('resolveUnpackedBinary', () => {
  // Packaged builds resolved these paths into app.asar, which is not a real
  // directory — spawn failed with ENOENT and embedded subtitle probing and
  // extraction silently never worked outside dev.
  it('redirects a Windows in-asar path to the unpacked copy', () => {
    expect(
      resolveUnpackedBinary(
        'C:\\app\\resources\\app.asar\\node_modules\\ffprobe-static\\bin\\win32\\x64\\ffprobe.exe'
      )
    ).toBe(
      'C:\\app\\resources\\app.asar.unpacked\\node_modules\\ffprobe-static\\bin\\win32\\x64\\ffprobe.exe'
    )
  })

  it('redirects a POSIX in-asar path to the unpacked copy', () => {
    expect(
      resolveUnpackedBinary('/opt/app/resources/app.asar/node_modules/ffmpeg-static/ffmpeg')
    ).toBe('/opt/app/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg')
  })

  it('leaves a dev path untouched', () => {
    const devPath = 'C:\\repo\\node_modules\\ffmpeg-static\\ffmpeg.exe'
    expect(resolveUnpackedBinary(devPath)).toBe(devPath)
  })

  it('does not rewrite a sibling directory that merely starts with app.asar', () => {
    // Rewriting `app.asar.backup` would point at something that does not exist.
    const path = 'C:\\repo\\app.asar.backup\\ffmpeg.exe'
    expect(resolveUnpackedBinary(path)).toBe(path)
  })

  it('returns null for a missing binary path', () => {
    expect(resolveUnpackedBinary(null)).toBeNull()
    expect(resolveUnpackedBinary(undefined)).toBeNull()
  })
})
