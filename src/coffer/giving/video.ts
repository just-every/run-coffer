import { requireRole } from '../auth'
import { all, commit, event, fail, guard, id, newId, one, sql, text, type Context } from '../db'

export const VIDEO_BYTES = 100 * 1024 * 1024
const absentVideo = "NOT EXISTS(SELECT 1 FROM cf_campaign_media WHERE campaign_id=? AND kind='video')"

async function discardUpload(c: Context, uploadId: string, key: string) {
 // Claim disposal atomically against publication. A publisher must still hold
 // an undiscarded reservation; whichever transaction wins makes the other stop.
 const claimed = await c.db.prepare(`UPDATE cf_campaign_video_uploads SET discarded_at=COALESCE(discarded_at,?)
  WHERE id=? AND object_key=? AND NOT EXISTS(SELECT 1 FROM cf_campaign_media WHERE object_key=?)`).bind(c.now, uploadId, key, key).run()
 if (!claimed.meta.changes) return
 await c.env!.FILES.delete(key)
 await c.db.prepare('DELETE FROM cf_campaign_video_uploads WHERE id=? AND discarded_at IS NOT NULL').bind(uploadId).run()
}

function mp4(bytes: Uint8Array, size: number) {
 if (bytes.length < 24) return false
 const ascii = (at: number, count: number) => String.fromCharCode(...bytes.subarray(at, at + count))
 const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
 return ascii(4, 4) === 'ftyp' && boxSize >= 16 && boxSize <= size && ['isom','iso2','iso3','iso4','iso5','iso6','iso7','iso8','iso9','mp41','mp42','avc1','av01','M4V ','dash'].includes(ascii(8, 4))
}

/** Recover abandoned, unpublished uploads only. Never delete a published key.
 * Cleanup does not exercise a revoked uploader's product authority. */
export async function cleanVideoUploads(c: Context) {
 const cutoff = new Date(Date.parse(c.now) - 60 * 60_000).toISOString()
 const rows = await all(c, 'SELECT * FROM cf_campaign_video_uploads WHERE started_at<? ORDER BY started_at LIMIT 20', cutoff)
 for (const row of rows) await discardUpload(c, row.id, row.object_key)
}

/** A browser File supplies its known byte length. FixedLengthStream preserves
 * that length for R2 while enforcing it without materializing the video. */
export async function uploadCampaignVideo(c: Context, request: Request, campaignId: string) {
 requireRole(c.actor, ['owner', 'admin'], 'publish campaign video')
 campaignId = id(campaignId, 'Campaign')
 if (request.headers.get('content-type') !== 'video/mp4') fail('MEDIA_TYPE', 'Upload an MP4 video file.', 415)
 if (request.headers.get('x-coffer-public-media') !== 'yes') fail('PUBLIC_MEDIA', 'Confirm the video and its embedded metadata may be published to everyone.', 400)
 const declared = request.headers.get('content-length')
 if (!declared || !/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))) fail('VIDEO_LENGTH', 'Upload the original file with its byte length.', 411)
 const length = Number(declared)
 if (length < 24 || length > VIDEO_BYTES) fail('VIDEO_SIZE', 'Upload a nonempty MP4 video no larger than 100 MiB.', 413)
 if (!request.body) fail('VIDEO_BODY', 'Choose an MP4 video file.', 400)
 let description: string
 try { description = decodeURIComponent(request.headers.get('x-coffer-video-description') ?? '') } catch { return fail('INPUT', 'The video description could not be read.', 400) }
 description = text(description, 'Video description', 300)
 if (!c.env?.FILES) fail('VIDEO_STORAGE', 'Campaign file storage is unavailable. Configure this installation’s FILES bucket.', 503)
 await cleanVideoUploads(c)
 const campaign = await one(c, 'SELECT id,slug FROM cf_campaigns WHERE id=? AND active=1', campaignId)
 if (!campaign) fail('NOT_FOUND', 'That campaign is not available.', 404)
 const uploadId = newId(), key = `campaign-media/${uploadId}.mp4`
 await commit(c, [
  guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND active=1)', 'NOT_FOUND', 'That campaign is not available.', campaignId),
  guard(absentVideo, 'VIDEO_EXISTS', 'This campaign already has a published video.', campaignId),
  guard('NOT EXISTS(SELECT 1 FROM cf_campaign_video_uploads WHERE campaign_id=?)', 'VIDEO_UPLOADING', 'A video is already uploading for this campaign. Finish that upload before trying again.', campaignId),
  sql('INSERT INTO cf_campaign_video_uploads(id,campaign_id,object_key,started_at) VALUES(?,?,?,?)', uploadId, campaignId, key, c.now),
 ])
 try {
  const fixed = new FixedLengthStream(length)
  const transfer = new AbortController()
  // Await both branches, including on failure, so cleanup cannot race a write
  // that is still completing. Backpressure keeps memory bounded by the stream.
  const results = await Promise.allSettled([
   request.body.pipeTo(fixed.writable, { signal: transfer.signal }),
   c.env.FILES.put(key, fixed.readable, { httpMetadata: { contentType: 'video/mp4' } }).catch(error => { transfer.abort(); throw error }),
  ])
  if (results.some(result => result.status === 'rejected')) fail('VIDEO_TRANSFER', 'The video upload did not complete. No new video was published. Try the original file again.', 400)
  const stored = await c.env.FILES.get(key, { range: { offset: 0, length: 64 } })
  if (!stored || stored.size !== length || !mp4(new Uint8Array(await stored.arrayBuffer()), stored.size)) fail('MEDIA_CONTENT', 'The uploaded bytes are not an MP4 video. No new video was published.', 400)
  await commit(c, [
   guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND active=1)', 'NOT_FOUND', 'That campaign is no longer available.', campaignId),
   guard('EXISTS(SELECT 1 FROM cf_campaign_video_uploads WHERE id=? AND campaign_id=? AND object_key=? AND discarded_at IS NULL)', 'VIDEO_CHANGED', 'This upload is no longer current. No new video was published.', uploadId, campaignId, key),
   guard(absentVideo, 'VIDEO_EXISTS', 'This campaign already has a published video.', campaignId),
   sql("INSERT INTO cf_campaign_media(campaign_id,kind,media_type,description,object_key,size_bytes) VALUES(?,'video','video/mp4',?,?,?)", campaignId, description, key, stored.size),
   sql('DELETE FROM cf_campaign_video_uploads WHERE id=?', uploadId),
   event(c, 'campaign.video', 'campaign', campaignId, null, { sizeBytes: length }),
  ])
  return { id: campaignId, slug: campaign.slug, kind: 'video', sizeBytes: length }
 } finally {
  // An uncertain D1 acknowledgement may have committed. Claim disposal against
  // the actual reference before deleting anything, never a published object.
  await discardUpload(c, uploadId, key)
 }
}

export async function campaignVideoResponse(request: Request, c: { env?: Context['env'] }, row: Record<string, any>) {
 const bucket = c.env?.FILES
 if (!bucket) fail('VIDEO_STORAGE', 'Campaign file storage is unavailable.', 503)
 const headers: Record<string, string> = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'referrer-policy': 'no-referrer' }
 const range = request.headers.get('range')
 let offset = 0, length = row.size_bytes
 if (range) {
  const match = range.match(/^bytes=(\d*)-(\d*)$/)
  let through = row.size_bytes - 1
  if (!match || (!match[1] && !match[2])) offset = -1
  else if (!match[1]) offset = Math.max(0, row.size_bytes - Number(match[2]))
  else { offset = Number(match[1]); if (match[2]) through = Math.min(through, Number(match[2])) }
  length = through - offset + 1
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || offset >= row.size_bytes || length < 1) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${row.size_bytes}`, 'content-length': '0' } })
  headers['content-range'] = `bytes ${offset}-${offset + length - 1}/${row.size_bytes}`
 }
 // R2 multipart restore changes storage ETags. The immutable key identifies
 // this file; Base verifies archived and restored bytes by their SHA-256.
 const object = await bucket.get(row.object_key, range ? { range: { offset, length } } : undefined)
 if (!object || object.size !== row.size_bytes) fail('VIDEO_CHANGED', 'That campaign video is not currently available.', 409)
 headers['content-length'] = String(length)
 if (request.method === 'HEAD') { await object.body.cancel(); return new Response(null, { status: range ? 206 : 200, headers }) }
 return new Response(object.body, { status: range ? 206 : 200, headers })
}
