import { fail } from '../db'

const invalid = (): never => fail('MEDIA_CONTENT', 'The uploaded image has an invalid PNG, JPEG or WebP structure.', 400)
const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length))
function joined(parts: Uint8Array[]) {
 const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0
 for (const part of parts) { result.set(part, at); at += part.length }
 return result
}
function crc(bytes: Uint8Array) {
 let value = 0xffffffff
 for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) }
 return (value ^ 0xffffffff) >>> 0
}

function png(bytes: Uint8Array) {
 const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts = [bytes.subarray(0, 8)]
 let at = 8, pixels = false, ended = false
 while (at + 12 <= bytes.length) {
  const length = data.getUint32(at), end = at + length + 12, kind = ascii(bytes, at + 4, 4)
  if (end > bytes.length || !/^[A-Za-z]{4}$/.test(kind) || crc(bytes.subarray(at + 4, end - 4)) !== data.getUint32(end - 4)) invalid()
  if (at === 8 && (kind !== 'IHDR' || length !== 13)) invalid()
  // Retain only pixel-defining chunks. Text, timestamps, profiles, EXIF/GPS,
  // unknown ancillary chunks and appended bytes cannot enter the public file.
  if (['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS'].includes(kind)) parts.push(bytes.subarray(at, end))
  else if (kind[0] === kind[0].toUpperCase()) invalid()
  if (kind === 'IDAT') pixels = true
  if (kind === 'IEND') { if (length !== 0 || end !== bytes.length) invalid(); ended = true; break }
  at = end
 }
 if (!pixels || !ended) invalid()
 return joined(parts)
}

function jpeg(bytes: Uint8Array) {
 const parts = [bytes.subarray(0, 2)]; let at = 2, scans = false
 while (at < bytes.length) {
  const start = at
  if (bytes[at++] !== 255) invalid()
  while (bytes[at] === 255) at++
  const marker = bytes[at++]
  if (marker === 217) { if (!scans || at !== bytes.length) invalid(); parts.push(new Uint8Array([255,217])); return joined(parts) }
  if (marker === undefined || marker === 0 || marker === 216) invalid()
  if (marker === 1 || (marker >= 208 && marker <= 215)) { parts.push(bytes.subarray(start, at)); continue }
  if (at + 2 > bytes.length) invalid()
  const length = bytes[at] * 256 + bytes[at + 1], end = at + length
  if (length < 2 || end > bytes.length) invalid()
  // APP0..APP15 and COM hold EXIF, GPS, XMP, ICC, thumbnails and comments.
  if (!(marker >= 224 && marker <= 239) && marker !== 254) parts.push(bytes.subarray(start, end))
  at = end
  if (marker === 218) {
   scans = true; const entropy = at
   for (;;) {
    while (at < bytes.length && bytes[at] !== 255) at++
    if (at >= bytes.length) invalid()
    let next = at + 1; while (bytes[next] === 255) next++
    if (bytes[next] === undefined) invalid()
    if (bytes[next] === 0 || (bytes[next] >= 208 && bytes[next] <= 215)) { at = next + 1; continue }
    parts.push(bytes.subarray(entropy, at)); break
   }
  }
 }
 return invalid()
}

function webp(bytes: Uint8Array) {
 const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts: Uint8Array[] = []; let at = 12, pixels = false
 while (at + 8 <= bytes.length) {
  const kind = ascii(bytes, at, 4), length = data.getUint32(at + 4, true), end = at + 8 + length + (length % 2)
  if (end > bytes.length) invalid()
  if (['VP8X', 'ALPH', 'VP8 ', 'VP8L', 'ANIM', 'ANMF'].includes(kind)) {
   const chunk = bytes.slice(at, end)
   if (kind === 'VP8X') { if (length !== 10) invalid(); chunk[8] &= ~(0x20 | 0x08 | 0x04) }
   parts.push(chunk)
   if (['VP8 ', 'VP8L', 'ANMF'].includes(kind)) pixels = true
  }
  at = end
 }
 if (at !== bytes.length || !pixels) invalid()
 const output = joined([bytes.subarray(0, 12), ...parts])
 new DataView(output.buffer).setUint32(4, output.length - 8, true)
 return output
}

/** Public copies contain encoded pixels, not embedded personal metadata. */
export function stripImageMetadata(bytes: Uint8Array, type: string) {
 if (type === 'image/png') return png(bytes)
 if (type === 'image/jpeg') return jpeg(bytes)
 if (type === 'image/webp') return webp(bytes)
 return invalid()
}
