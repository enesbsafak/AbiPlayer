import { describe, expect, it } from 'vitest'
import { isLegalNoticeTarget, resolveLegalNoticePath, type LegalNoticeEnvironment } from './legal-notices'

function env(overrides: Partial<LegalNoticeEnvironment>, existing: string[]): LegalNoticeEnvironment {
  const present = new Set(existing)
  return {
    isPackaged: true,
    resourcesPath: 'C:\\App\\resources',
    appDir: 'C:\\repo\\out\\main',
    cwd: 'C:\\repo',
    exists: (candidate) => present.has(candidate),
    ...overrides
  }
}

describe('resolveLegalNoticePath', () => {
  it('uses the copies shipped under resources\\legal in a packaged build', () => {
    const shipped = env({}, ['C:\\App\\resources\\legal\\THIRD-PARTY-NOTICES.txt', 'C:\\App\\resources\\legal\\licenses'])
    expect(resolveLegalNoticePath(shipped, 'notices')).toBe('C:\\App\\resources\\legal\\THIRD-PARTY-NOTICES.txt')
    expect(resolveLegalNoticePath(shipped, 'licenses')).toBe('C:\\App\\resources\\legal\\licenses')
  })

  it('never falls back to the checkout or the working directory when packaged', () => {
    const packaged = env({ cwd: 'C:\\Users\\me\\Downloads' }, [
      'C:\\repo\\THIRD-PARTY-NOTICES.md',
      'C:\\Users\\me\\Downloads\\licenses'
    ])
    expect(resolveLegalNoticePath(packaged, 'notices')).toBeNull()
    expect(resolveLegalNoticePath(packaged, 'licenses')).toBeNull()
    expect(resolveLegalNoticePath(env({ resourcesPath: undefined }, []), 'notices')).toBeNull()
  })

  it('uses the files in the checkout in development', () => {
    const dev = env({ isPackaged: false }, ['C:\\repo\\THIRD-PARTY-NOTICES.md', 'C:\\repo\\licenses'])
    expect(resolveLegalNoticePath(dev, 'notices')).toBe('C:\\repo\\THIRD-PARTY-NOTICES.md')
    expect(resolveLegalNoticePath(dev, 'licenses')).toBe('C:\\repo\\licenses')
  })
})

describe('isLegalNoticeTarget', () => {
  it('accepts only the two fixed targets', () => {
    expect(isLegalNoticeTarget('notices')).toBe(true)
    expect(isLegalNoticeTarget('licenses')).toBe(true)
    for (const value of ['C:\\Windows\\notepad.exe', 'NOTICES', '', null, undefined, 1, {}]) {
      expect(isLegalNoticeTarget(value)).toBe(false)
    }
  })
})
