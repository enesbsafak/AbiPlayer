// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCertificate } from './certificate'
import { generateSelfSignedCertificate } from './testing/self-signed'
import { TrustStore, type StoredPin } from './trust-store'

let dir: string
let filePath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'abi-tls-store-'))
  filePath = join(dir, 'tls-trust.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function pinFor(host: string, port: number): StoredPin {
  const generated = generateSelfSignedCertificate({ altNames: [host] })
  const details = readCertificate(generated.cert)!
  return { ...details, host, port, problems: ['authority'], sourceIds: ['xtream_1'], trustedAt: 1000 }
}

describe('TrustStore', () => {
  it('persists pins and reads them back in a new instance', async () => {
    const store = new TrustStore({ filePath })
    const pin = pinFor('panel.example', 8443)
    await store.put(pin)

    const reloaded = new TrustStore({ filePath })
    expect(reloaded.get({ host: 'panel.example', port: 8443 })?.fingerprint256).toBe(pin.fingerprint256)
    expect(reloaded.get({ host: 'panel.example', port: 443 })).toBeNull()
    expect(reloaded.list()).toHaveLength(1)
  })

  it('removes a pin and persists the removal', async () => {
    const store = new TrustStore({ filePath })
    await store.put(pinFor('panel.example', 443))
    expect(await store.remove({ host: 'panel.example', port: 443 })).toBe(true)
    expect(await store.remove({ host: 'panel.example', port: 443 })).toBe(false)
    expect(new TrustStore({ filePath }).list()).toEqual([])
  })

  it('moves a corrupt file aside and starts empty', () => {
    writeFileSync(filePath, '{ not json')
    const messages: string[] = []
    const store = new TrustStore({ filePath, now: () => 42, log: (message) => messages.push(message) })
    expect(store.list()).toEqual([])
    expect(existsSync(filePath)).toBe(false)
    expect(readdirSync(dir)).toContain('tls-trust.json.corrupt-42')
    expect(messages.join(' ')).toMatch(/unreadable/)
  })

  it('treats a file of the wrong shape as corrupt', () => {
    writeFileSync(filePath, JSON.stringify({ hosts: 'nope' }))
    expect(new TrustStore({ filePath, now: () => 7 }).list()).toEqual([])
    expect(readdirSync(dir)).toContain('tls-trust.json.corrupt-7')
  })

  it('drops entries that do not hold together, and never-relaxable hosts', () => {
    const good = pinFor('panel.example', 443)
    const forged = { ...pinFor('other.example', 443), fingerprint256: good.fingerprint256 }
    const github = pinFor('github.com', 443)
    writeFileSync(filePath, JSON.stringify({ version: 1, pins: [good, forged, github, { host: 'x' }, null] }))
    const store = new TrustStore({ filePath })
    expect(store.list().map((pin) => pin.host)).toEqual(['panel.example'])
  })

  it('normalizes host case and IDN when reading', () => {
    const pin = { ...pinFor('xn--bcher-kva.example', 443), host: 'BÜCHER.example' }
    writeFileSync(filePath, JSON.stringify({ version: 1, pins: [pin] }))
    expect(new TrustStore({ filePath }).get({ host: 'xn--bcher-kva.example', port: 443 })).not.toBeNull()
  })

  it('refuses to store a never-relaxable host', async () => {
    const store = new TrustStore({ filePath })
    await expect(store.put(pinFor('api.themoviedb.org', 443))).rejects.toThrow()
    expect(existsSync(filePath)).toBe(false)
  })

  it('writes the file atomically as JSON', async () => {
    const store = new TrustStore({ filePath })
    await Promise.all([store.put(pinFor('a.example', 443)), store.put(pinFor('b.example', 443))])
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as { pins: StoredPin[] }
    expect(parsed.pins.map((pin) => pin.host)).toEqual(['a.example', 'b.example'])
  })
})
