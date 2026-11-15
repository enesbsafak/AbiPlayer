import { X509Certificate } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { derUnsignedInteger, generateSelfSignedCertificate } from './self-signed'

// The cause of the intermittent failures in certificate.test.ts and
// trust-store.test.ts: a random serial that began with 0x00 followed by a
// byte below 0x80 was written with that zero, which OpenSSL refuses.
describe('derUnsignedInteger', () => {
  it('writes the shortest form', () => {
    expect(derUnsignedInteger(Buffer.from([0x00, 0x12, 0x34]))).toEqual(Buffer.from([0x02, 0x02, 0x12, 0x34]))
    expect(derUnsignedInteger(Buffer.from([0x00, 0x00, 0x01]))).toEqual(Buffer.from([0x02, 0x01, 0x01]))
    expect(derUnsignedInteger(Buffer.from([0x02]))).toEqual(Buffer.from([0x02, 0x01, 0x02]))
  })

  it('keeps a value with its top bit set positive', () => {
    expect(derUnsignedInteger(Buffer.from([0x80, 0x01]))).toEqual(Buffer.from([0x02, 0x03, 0x00, 0x80, 0x01]))
    expect(derUnsignedInteger(Buffer.from([0x00, 0x80]))).toEqual(Buffer.from([0x02, 0x02, 0x00, 0x80]))
  })

  it('writes zero as a single zero byte', () => {
    expect(derUnsignedInteger(Buffer.from([0x00, 0x00]))).toEqual(Buffer.from([0x02, 0x01, 0x00]))
    expect(derUnsignedInteger(Buffer.alloc(0))).toEqual(Buffer.from([0x02, 0x01, 0x00]))
  })
})

describe('generateSelfSignedCertificate', () => {
  it('accepts serials with leading zero bytes and with the top bit set', () => {
    for (const serial of [
      Buffer.from('0012345678', 'hex'),
      Buffer.from('0000ff', 'hex'),
      Buffer.from('80aa', 'hex'),
      Buffer.from('7f', 'hex')
    ]) {
      const { cert } = generateSelfSignedCertificate({ serialNumber: serial })
      expect(new X509Certificate(cert).serialNumber.replace(/^0+(?=.)/, '')).toBe(
        serial.toString('hex').toUpperCase().replace(/^0+(?=.)/, '')
      )
    }
  })
})
