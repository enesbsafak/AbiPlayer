import { itemAt } from '../../shared/checked'

// Windows-1254 (Turkish) bytes 0x80–0x9F. Unassigned positions map to the C1
// control of the same value, as the WHATWG Encoding standard does.
const CP1254_80_9F = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x008d, 0x008e, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x009e, 0x0178
]

// 0xA0–0xFF is ISO-8859-9: Latin-1 with six Turkish letters swapped in.
const CP1254_TURKISH_OVERRIDES: Record<number, number> = {
  0xd0: 0x011e, // Ğ
  0xdd: 0x0130, // İ
  0xde: 0x015e, // Ş
  0xf0: 0x011f, // ğ
  0xfd: 0x0131, // ı
  0xfe: 0x015f // ş
}

/**
 * Implemented by table rather than `TextDecoder('windows-1254')`, whose
 * support depends on how much ICU data the runtime ships.
 */
export function decodeWindows1254(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) {
    let codePoint: number
    if (byte < 0x80) codePoint = byte
    else if (byte < 0xa0) codePoint = itemAt(CP1254_80_9F, byte - 0x80)
    else codePoint = CP1254_TURKISH_OVERRIDES[byte] ?? byte
    out += String.fromCharCode(codePoint)
  }
  return out
}

/**
 * Decodes a subtitle or playlist file the way users expect: a BOM wins
 * (UTF-8, UTF-16 LE/BE); otherwise UTF-8 if the bytes are valid UTF-8, and
 * Windows-1254 if not — the encoding most Turkish .srt files are saved in.
 */
export function decodeTextFile(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // 'utf-16be' is another ICU-dependent label; swap to LE instead.
    const swapped = new Uint8Array(bytes.length - 2 - ((bytes.length - 2) % 2))
    for (let i = 0; i < swapped.length; i += 2) {
      swapped[i] = itemAt(bytes, i + 3)
      swapped[i + 1] = itemAt(bytes, i + 2)
    }
    return new TextDecoder('utf-16le').decode(swapped)
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return decodeWindows1254(bytes)
  }
}
