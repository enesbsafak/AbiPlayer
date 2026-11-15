// Self-signed X.509 certificates made at test time with nothing but node:crypto,
// for the TLS policy's unit tests and the end-to-end mock provider's HTTPS
// mode. Test-only: nothing in the app imports it. A tiny DER writer covers
// exactly the fields a TLS server certificate needs: subject, validity, the
// key, and the basicConstraints / extKeyUsage / subjectAltName extensions.

import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from 'node:crypto'
import { isIP } from 'node:net'

export interface CertificateOptions {
  /** Subject and issuer common name. */
  commonName?: string
  /** subjectAltName entries; IP literals become iPAddress entries. */
  altNames?: string[]
  notBefore?: Date
  notAfter?: Date
  /** Serial number as unsigned big-endian bytes; random (16 bytes) by default. */
  serialNumber?: Buffer
}

export interface GeneratedCertificate {
  /** PEM certificate. */
  cert: string
  /** PEM PKCS#8 private key. */
  key: string
  /** SHA-256 of the DER certificate, upper-case hex pairs joined by ':'. */
  fingerprint256: string
}

const DAY_MS = 86_400_000

function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size])
  const bytes: number[] = []
  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content)
  return Buffer.concat([Buffer.from([tag]), length(body.length), body])
}

const sequence = (...items: Buffer[]) => tlv(0x30, ...items)
const set = (...items: Buffer[]) => tlv(0x31, ...items)
const explicit = (n: number, item: Buffer) => tlv(0xa0 + n, item)

function oid(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split('.').map(Number)
  if (first === undefined || second === undefined) throw new Error(`Invalid OID ${dotted}`)
  const bytes = [first * 40 + second]
  for (const value of rest) {
    const chunk: number[] = [value & 0x7f]
    for (let v = Math.floor(value / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift(0x80 | (v & 0x7f))
    bytes.push(...chunk)
  }
  return tlv(0x06, Buffer.from(bytes))
}

/**
 * DER INTEGER of an unsigned big-endian number. DER wants the shortest form:
 * no leading zero byte unless the next byte has its top bit set (which would
 * read as negative). OpenSSL rejects any other leading zero ("illegal
 * padding"), and random serials start with one about once in 256 certificates.
 */
export function derUnsignedInteger(bytes: Buffer): Buffer {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1
  const digits = bytes.subarray(start)
  const negativeLooking = ((digits[0] ?? 0) & 0x80) !== 0
  return tlv(0x02, negativeLooking || digits.length === 0 ? Buffer.concat([Buffer.from([0]), digits]) : digits)
}

function time(date: Date): Buffer {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getUTCFullYear()
  const rest = `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  // RFC 5280: UTCTime up to 2049, GeneralizedTime after.
  return year < 2050 ? tlv(0x17, Buffer.from(`${pad(year % 100)}${rest}`)) : tlv(0x18, Buffer.from(`${year}${rest}`))
}

function name(commonName: string): Buffer {
  return sequence(set(sequence(oid('2.5.4.3'), tlv(0x0c, Buffer.from(commonName, 'utf8')))))
}

function ipBytes(address: string): Buffer {
  if (isIP(address) === 4) return Buffer.from(address.split('.').map(Number))
  // Expand '::' and write eight 16-bit groups.
  const [head, tail = ''] = address.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = address.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
  const buffer = Buffer.alloc(16)
  groups.forEach((group, index) => buffer.writeUInt16BE(Number.parseInt(group || '0', 16), index * 2))
  return buffer
}

function extensions(altNames: string[]): Buffer {
  const san = altNames.map((entry) => (isIP(entry) ? tlv(0x87, ipBytes(entry)) : tlv(0x82, Buffer.from(entry, 'ascii'))))
  return explicit(
    3,
    sequence(
      // basicConstraints: CA true, as `openssl req -x509` makes them.
      sequence(oid('2.5.29.19'), tlv(0x04, sequence(tlv(0x01, Buffer.from([0xff]))))),
      // extKeyUsage: serverAuth.
      sequence(oid('2.5.29.37'), tlv(0x04, sequence(oid('1.3.6.1.5.5.7.3.1')))),
      sequence(oid('2.5.29.17'), tlv(0x04, sequence(...san)))
    )
  )
}

function toPem(der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? []
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`
}

function build(options: CertificateOptions, publicKey: KeyObject, privateKey: KeyObject): Buffer {
  const commonName = options.commonName ?? 'Abi Player sahte sağlayıcı'
  const now = Date.now()
  const notBefore = options.notBefore ?? new Date(now - DAY_MS)
  const notAfter = options.notAfter ?? new Date(now + 30 * DAY_MS)
  const serial = options.serialNumber ?? randomBytes(16)
  const algorithm = sequence(oid('1.2.840.10045.4.3.2')) // ecdsa-with-SHA256
  const tbs = sequence(
    explicit(0, derUnsignedInteger(Buffer.from([2]))),
    derUnsignedInteger(serial),
    algorithm,
    name(commonName),
    sequence(time(notBefore), time(notAfter)),
    name(commonName),
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions(options.altNames ?? ['127.0.0.1', 'localhost'])
  )
  const signature = sign('sha256', tbs, privateKey)
  return sequence(tbs, algorithm, tlv(0x03, Buffer.from([0]), signature))
}

/** A fresh key pair and a self-signed certificate for it. */
export function generateSelfSignedCertificate(options: CertificateOptions = {}): GeneratedCertificate {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const der = build(options, publicKey, privateKey)
  const cert = toPem(der)
  // Parsing it back proves the encoding is well-formed.
  const parsed = new X509Certificate(cert)
  const digest = createHash('sha256').update(der).digest('hex').toUpperCase()
  const fingerprint256 = digest.match(/.{2}/g)!.join(':')
  if (parsed.fingerprint256 !== fingerprint256) throw new Error('certificate encoding mismatch')
  return { cert, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, fingerprint256 }
}
