import { all, fail, one, optional, sql, text, type Context, type Row } from '../db'
import { stripImageMetadata } from './image-metadata'
import { campaignVideoResponse } from './video'

// A base64 field stays below D1's per-value limit. Uploads are public campaign
// material, stored in the same portable database as their campaign.
export const MEDIA_BYTES = 1024 * 1024
export const CAMPAIGN_BODY_BYTES = 4 * 1024 * 1024
const imageTypes = ['image/png', 'image/jpeg', 'image/webp']

export async function campaignInput(request: Request, json: boolean): Promise<Row | FormData> {
 const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
 if (reader) try {
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > CAMPAIGN_BODY_BYTES) fail('body_too_large', 'Campaign publication is limited to 4 MiB, with the image up to 1 MiB. Upload video separately.', 413); chunks.push(part.value) }
 } finally { await reader.cancel(); reader.releaseLock() }
 const bytes = new Uint8Array(size); let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
 const type = request.headers.get('content-type') ?? ''
 if (json) {
  if (!type.startsWith('application/json')) fail('json_required', 'Send JSON.', 415)
  try { const data = JSON.parse(new TextDecoder().decode(bytes)); if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error(); return data }
  catch { return fail('invalid_json', 'The request body is not a JSON object.', 400) }
 }
 if (!type.startsWith('multipart/form-data') && !type.startsWith('application/x-www-form-urlencoded')) fail('form_required', 'Send the campaign form.', 415)
 try { return await new Response(bytes, { headers: { 'content-type': type } }).formData() }
 catch { return fail('form_required', 'That campaign upload could not be read.', 400) }
}

function signature(bytes: Uint8Array, type: string): boolean {
 const ascii = (at: number, count: number) => String.fromCharCode(...bytes.subarray(at, at + count))
 if (type === 'image/png') return bytes.length >= 33 && bytes.slice(0, 8).every((n, i) => n === [137,80,78,71,13,10,26,10][i]) && ascii(12, 4) === 'IHDR'
 if (type === 'image/jpeg') return bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217
 if (type === 'image/webp') return bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12, 4)) && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length
 return false
}

/** Both native multipart and JSON publication enter this one validation path. */
export async function campaignMedia(input: Row | FormData) {
 const data: Row = input instanceof FormData ? Object.fromEntries(input) : input
 const legacyVideo = input instanceof FormData ? input.get('video') : null
 if (data.videoBase64 !== undefined || (legacyVideo && typeof legacyVideo !== 'string' && legacyVideo.size)) fail('VIDEO_UPLOAD', 'Upload the video separately from the campaign’s video form.', 400)
 const result: Row[] = []
 for (const kind of ['image'] as const) {
  const file = input instanceof FormData ? input.get(kind) : null
  let encoded = optional(data[`${kind}Base64`], `${kind} upload`, Math.ceil(MEDIA_BYTES / 3) * 4)
  let mediaType = data[`${kind}Type`]
  if (file && typeof file !== 'string' && file.size) {
   if (file.size > MEDIA_BYTES) fail('MEDIA_SIZE', `Upload a ${kind} no larger than 1 MiB.`, 400)
   const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
   for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
   encoded = btoa(binary); mediaType = file.type
  }
  if (!encoded) continue
  if (!imageTypes.includes(mediaType)) fail('MEDIA_TYPE', 'Use a PNG, JPEG or WebP image. SVG and HTML are not accepted.', 400)
  let binary: string
  try { binary = atob(encoded) } catch { fail('MEDIA_CONTENT', 'That campaign upload is not valid base64.', 400) }
  const bytes = Uint8Array.from(binary!, ch => ch.charCodeAt(0))
  if (!bytes.length || bytes.length > MEDIA_BYTES) fail('MEDIA_SIZE', `Upload a nonempty ${kind} no larger than 1 MiB.`, 400)
  if (!signature(bytes, mediaType)) fail('MEDIA_CONTENT', 'The uploaded bytes do not match the selected image format.', 400)
  if (kind === 'image') {
   const clean = stripImageMetadata(bytes, mediaType); let binary = ''
   for (let i = 0; i < clean.length; i += 8192) binary += String.fromCharCode(...clean.subarray(i, i + 8192))
   encoded = btoa(binary)
  }
  const description = text(data[`${kind}Description`], 'Image description', 300)
  result.push({ kind, mediaType, description, encoded, sizeBytes: atob(encoded).length })
 }
 if (result.length && ![true, 'yes'].includes(data.publicMedia)) fail('PUBLIC_MEDIA', 'Confirm these uploads and their metadata may be published to everyone.', 400)
 return result
}

export const mediaStatements = (campaignId: string, media: Row[]) => media.map(m => sql('INSERT INTO cf_campaign_media(campaign_id,kind,media_type,description,content_base64,size_bytes) VALUES(?,?,?,?,?,?)', campaignId, m.kind, m.mediaType, m.description, m.encoded, m.sizeBytes))
export const mediaList = (c: { db: D1Database }, campaignId: string) => all(c, 'SELECT kind,description FROM cf_campaign_media WHERE campaign_id=? ORDER BY kind', campaignId)

export async function campaignMediaResponse(request: Request, c: { db: D1Database; env?: Context['env'] }, slug: string, kind: string) {
 const row = await one(c, 'SELECT m.* FROM cf_campaign_media m JOIN cf_campaigns c ON c.id=m.campaign_id WHERE c.slug=? AND c.active=1 AND m.kind=?', slug, kind)
 if (!row) fail('not_found', 'That campaign upload is not available.', 404)
 if (row.kind === 'video') return campaignVideoResponse(request, c, row)
 const bytes = Uint8Array.from(atob(row.content_base64), ch => ch.charCodeAt(0))
 const headers: Record<string, string> = { 'content-type': row.media_type, 'content-length': String(bytes.length), 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' }
 const range = request.headers.get('range')
 if (range) {
  const match = range.match(/^bytes=(\d*)-(\d*)$/)
  let from = 0, through = bytes.length - 1
  if (match && (match[1] || match[2])) {
   if (!match[1]) from = Math.max(0, bytes.length - Number(match[2]))
   else { from = Number(match[1]); if (match[2]) through = Math.min(through, Number(match[2])) }
  } else from = -1
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(through) || from < 0 || through < from || from >= bytes.length) return new Response(null, { status: 416, headers: { ...headers, 'content-length': '0', 'content-range': `bytes */${bytes.length}` } })
  headers['content-range'] = `bytes ${from}-${through}/${bytes.length}`; headers['content-length'] = String(through - from + 1)
  return new Response(request.method === 'HEAD' ? null : bytes.slice(from, through + 1), { status: 206, headers })
 }
 return new Response(request.method === 'HEAD' ? null : bytes, { headers })
}
