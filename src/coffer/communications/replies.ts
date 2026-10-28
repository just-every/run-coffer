import { routingOwner } from '../relationship-owner'
import type { Bindings } from '../../auth.server'
import { manager, requireRole } from '../auth'
import { all, commit, event, fail, guard, id, longText, one, sha256, sql, type Context, type Row } from '../db'
import { automaticStopIsCurrent, automaticStopStatements, currentConsent, replyStopCommand, stopEvidence, stopIsCurrent, syncAutomaticStop } from './reply-stop'

const sourceNames: Record<string, string> = { mailbox: 'Personal mailbox', welcome: 'Welcome', appeal: 'Appeal', receipt: 'Receipt', acknowledgment: 'Acknowledgment', acknowledgement: 'Acknowledgment', statement: 'Statement' }
export const replySource = (kind: string) => sourceNames[kind] ?? 'Email'

const MAX_RAW = 1024 * 1024
const clean = (value: string, limit: number) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, limit)
const address = (value: string) => value.trim().toLowerCase()

export async function readRaw(message: ForwardableEmailMessage): Promise<Uint8Array<ArrayBuffer> | null> {
 if (message.rawSize > MAX_RAW) return null
 const reader = message.raw.getReader(), chunks: Uint8Array[] = []
 let size = 0
 try {
  while (true) {
   const part = await reader.read()
   if (part.done) break
   size += part.value.byteLength
   if (size > MAX_RAW) { await reader.cancel(); return null }
   chunks.push(part.value)
  }
 } finally { reader.releaseLock() }
 const raw = new Uint8Array(size)
 let offset = 0
 for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength }
 return raw
}

function decode(value: string, encoding: string, charset = 'utf-8'): string {
 let bytes: Uint8Array
 if (encoding === 'base64') {
  const binary = atob(value.replace(/\s/g, ''))
  bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
 } else {
  const raw = encoding === 'quoted-printable' ? value.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))) : value
  bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0))
 }
 return new TextDecoder(charset).decode(bytes)
}

function subject(value: string): string {
 return clean(value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (word, charset, encoding, body) => {
  try { return decode(encoding.toLowerCase() === 'q' ? body.replace(/_/g, ' ') : body, encoding.toLowerCase() === 'b' ? 'base64' : 'quoted-printable', charset) } catch { return word }
 }), 400) || '(No subject)'
}

/** Extract a bounded text/plain excerpt only. Attachments and HTML are not stored. */
export function plainExcerpt(raw: Uint8Array): string {
 // Preserve bytes so transfer encodings and declared charsets can be decoded per part.
 let binary = ''
 for (let offset = 0; offset < raw.length; offset += 8192) binary += String.fromCharCode(...raw.subarray(offset, offset + 8192))
 let parts = 0
 function visit(part: string, depth: number): string {
  if (depth > 5 || ++parts > 40) return ''
  const split = /\r?\n\r?\n/.exec(part)
  if (!split) return ''
  const headers = new Map<string, string>()
  for (const line of part.slice(0, split.index).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
   const colon = line.indexOf(':')
   if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim())
  }
  if (/\battachment\b/i.test(headers.get('content-disposition') ?? '')) return ''
  const type = headers.get('content-type') ?? 'text/plain', body = part.slice(split.index + split[0].length)
  if (/^multipart\//i.test(type)) {
   const boundary = /\bboundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(type)
   if (!boundary || (boundary[1] ?? boundary[2]).length > 200) return ''
   const delimiter = `--${boundary[1] ?? boundary[2]}`
   // Only complete boundary lines delimit parts; preamble and epilogue are ignored.
   let current: string[] | null = null
   for (const line of body.split(/\r?\n/)) {
    if (line.trimEnd() === delimiter || line.trimEnd() === `${delimiter}--`) {
     if (current) { const text = visit(current.join('\r\n'), depth + 1); if (text) return text }
     if (line.trimEnd() === `${delimiter}--`) break
     current = []
    } else if (current) current.push(line)
   }
   return ''
  }
  if (!/^text\/plain(?:\s*;|\s*$)/i.test(type)) return ''
  const charset = /\bcharset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(type)
  const encoding = (headers.get('content-transfer-encoding') ?? '').toLowerCase()
  if (!['', '7bit', '8bit', 'binary', 'base64', 'quoted-printable'].includes(encoding)) return ''
  try { return clean(decode(body, encoding, charset?.[1] ?? charset?.[2] ?? 'utf-8'), 4000) } catch { return '' }
 }
 return visit(binary, 0)
}

/** The From address, only when Cloudflare's own receiver header (always the topmost
 * Authentication-Results) says it passed DMARC. Mail services send with their own
 * envelope sender, so a donor replying through one is recognized by this instead. */
export function authenticatedFrom(raw: Uint8Array): string | null {
 let head = ''
 for (let i = 0; i < Math.min(raw.length, 65536); i++) head += String.fromCharCode(raw[i])
 const lines = head.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)
 const results = lines.find(line => /^authentication-results:/i.test(line))
 if (!results || !/^authentication-results:\s*mx\.cloudflare\.net;/i.test(results)) return null
 const domain = /\bdmarc=pass\b[^;]*?\bheader\.from=([^\s;]+)/i.exec(results)?.[1]?.toLowerCase()
 const from = lines.find(line => /^from:/i.test(line))?.slice(5) ?? ''
 const sender = address(/<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? from)
 return domain && /^[^@\s]+@[^@\s]+$/.test(sender) && sender.split('@')[1] === domain ? sender : null
}


const threadSubject = (value: string) => subject(value).replace(/^(?:(?:re|fw|fwd|automatic reply|out of (?:the )?office|auto(?:matic)?[- ]response)\s*:\s*)+/i, '').trim().toLowerCase()

async function findCommunication(message: ForwardableEmailMessage, env: Bindings, raw: Uint8Array): Promise<Row | null> {
 const config = env as Bindings & { COFFER_REPLY_DOMAIN?: string; COFFER_REPLY_ADDRESS?: string }
 const destination = address(message.to), fixed = address(config.COFFER_REPLY_ADDRESS ?? '')
 const point=`SELECT cp.value FROM cf_contact_points cp WHERE cp.id=c.email_contact_id AND cp.donor_id=d.id AND cp.kind='email' AND cp.active=1 AND cp.version=c.email_contact_version AND cp.value=c.recipient_email`
 const live = `SELECT c.*,d.email AS donor_email,(${point}) AS contact_email FROM (
  SELECT id,donor_id,subject,reply_to,source_kind,source_id,created_at,'communication' AS source_type,recipient_email,COALESCE(recipient_contact_id,json_extract(name_fields,'$._emailContact')) AS email_contact_id,COALESCE(recipient_contact_version,json_extract(name_fields,'$._emailContactVersion')) AS email_contact_version
  FROM cf_communications WHERE status IN ('submitted','uncertain')
  UNION ALL
  SELECT a.id,a.donor_id,a.subject,a.reply_to,
   CASE WHEN b.kind='statement' THEN 'statement' WHEN a.id LIKE 'receipt-%' THEN 'receipt' ELSE 'acknowledgment' END,
   a.id,b.prepared_at,'letter',a.recipient_email,json_extract(a.address,'$.emailContactId'),json_extract(a.address,'$.emailContactVersion') FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id
  WHERE a.route='email' AND a.attempt_id IS NOT NULL AND a.delivery_status IN ('submitted','delivered','bounced','complained','uncertain','sending')
 ) c JOIN cf_donors d ON d.id=c.donor_id WHERE d.erased_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`
 if (fixed && destination === fixed) {
  const senders = [...new Set([address(message.from), authenticatedFrom(raw)].filter(Boolean))]
  const candidates = await all({ db: env.DB }, `${live} AND (lower(trim(d.email)) IN (SELECT value FROM json_each(?)) OR lower(trim((${point}))) IN(SELECT value FROM json_each(?))) AND lower(trim(c.reply_to))=? ORDER BY c.created_at DESC,c.id DESC`, JSON.stringify(senders),JSON.stringify(senders), destination)
  return candidates.find(c => threadSubject(c.subject) === threadSubject(message.headers.get('subject') ?? '')) ?? null
 }
 const match = /^coffer\+((?:receipt-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@([^@\s]+)$/.exec(destination)
 if (!config.COFFER_REPLY_DOMAIN || !match || match[2] !== address(config.COFFER_REPLY_DOMAIN)) return null
 const communication = await one({ db: env.DB }, `${live} AND lower(trim(c.reply_to))=?`, destination)
 return communication && address(communication.reply_to ?? '') === destination && [address(message.from),authenticatedFrom(raw)].some(sender=>sender&&[address(communication.donor_email??''),address(communication.contact_email??'')].includes(sender)) ? communication : null
}

async function recordState(db: D1Database, taskId: string, attempt: string, state: string, note: string, at: string) {
 await db.batch([
  db.prepare("UPDATE cf_reply_tasks SET status=?,note=? WHERE id=? AND status='pending' AND attempt_key=?").bind(state, note, taskId, attempt),
  db.prepare('UPDATE cf_interactions SET next_step=? WHERE id=? AND EXISTS(SELECT 1 FROM cf_reply_tasks WHERE id=? AND status=? AND attempt_key=?)').bind(note, taskId, taskId, state, attempt),
  db.prepare(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,'email-routing','Email routing','system',?,'reply',id,donor_id,'{}' FROM cf_reply_tasks WHERE id=? AND status=? AND attempt_key=?`).bind(at, `reply.${state}`, taskId, state, attempt),
 ])
}

/** Cloudflare Email Routing ingress. A configured destination and a known donor sender must match. */
export async function receiveReply(message: ForwardableEmailMessage, env: Bindings): Promise<void> {
 if (env.RER_INSTALLATION_ID || env.RER_MANAGEMENT_ORIGIN) { message.setReject('Reply routing is not available yet on RER Managed.'); return }
 const raw = await readRaw(message)
 if (!raw) { message.setReject('Reply exceeds the 1 MB limit.'); return }
 const communication = await findCommunication(message, env, raw)
 if (!communication) {
  message.setReject('Unknown reply sender or address.'); return
 }
 const title = subject(message.headers.get('subject') ?? ''), body = plainExcerpt(raw)
 const headerId = message.headers.get('message-id')?.trim(), contentHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),value=>value.toString(16).padStart(2,'0')).join('')
 const key = await sha256(`${communication.donor_id}\0${headerId && headerId.length <= 998 ? headerId : contentHash}`)
 const automatic = /^(?!no(?:\s*;|\s*$))\S/i.test(message.headers.get('auto-submitted')?.trim() ?? '') ||
  (message.headers.has('x-autoreply') && !/^\s*no\s*$/i.test(message.headers.get('x-autoreply') ?? '')) ||
  message.headers.has('x-autorespond') || /^\s*(?:automatic reply|out of (?:the )?office|auto(?:matic)?[- ]response)\b/i.test(title)
 await recordIncomingReply(env,communication,{title,body,key,automatic,forward:async to=>{await message.forward(to)}})
}

/** All email ingresses share routing, stop interpretation and saved reply custody. */
export async function recordIncomingReply(env:Bindings,communication:Row,input:{title:string;body:string;key:string;automatic:boolean;forward:(to:string)=>Promise<void>}) {
 const now = new Date().toISOString(), {title,body,automatic}=input, messageId=input.key, taskId=`reply:${messageId}`
 const owner = await routingOwner(env.DB, communication.donor_id)
 const evidence = automatic ? null : stopEvidence(body)
 const note = automatic ? 'Automatic reply filed; no forwarding or follow-up required.' : owner ? 'Waiting to forward to the assigned relationship manager.' : 'Forwarding failed: no active relationship manager or owner account is available.'
 const state = automatic ? 'filed' : owner ? 'pending' : 'failed'
 const received = await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO cf_reply_tasks(id,communication_id,letter_id,donor_id,owner_id,subject,body,received_at,message_id,status,note,automatic,
   stop_status,stop_version,stop_evidence,stop_consent_id,stop_email,stop_donor_id,stop_proposed_at,stop_proposed_by,mailbox_id)
   SELECT ?,?,?,d.id,?,?,?,?,?,?,?,?,?, ?,?,${currentConsent},d.email,d.id,?,?,? FROM cf_donors d
   WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`)
   .bind(taskId, communication.source_type === 'communication' ? communication.id : null, communication.source_type === 'letter' ? communication.id : null,
    owner?.id ?? null, title, body, now, messageId, state, note, automatic ? 1 : 0,
    evidence ? 'automatic' : null, evidence ? 1 : 0, evidence, evidence ? now : null, evidence ? 'Email routing' : null, communication.mailbox_id??null, communication.donor_id),
  ...await automaticStopStatements(env.DB, taskId, now),
  env.DB.prepare(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,'email-routing','Email routing','system','reply.received','reply',id,donor_id,? FROM cf_reply_tasks WHERE id=? AND NOT EXISTS(SELECT 1 FROM cf_interactions WHERE id=?)`)
   .bind(now, JSON.stringify({ communicationId: communication.id, sourceKind: communication.source_kind, sourceId: communication.source_id, automatic }), taskId, taskId),
  env.DB.prepare(`INSERT OR IGNORE INTO cf_interactions(id,donor_id,kind,occurred_on,who,notes,next_step,recorded_at,recorded_by)
   SELECT id,donor_id,'email',?,'Donor',?,?,?,'Email routing' FROM cf_reply_tasks WHERE id=?`)
   .bind(now.slice(0, 10), communication.mailbox_id?'Private mailbox reply saved.':`${replySource(communication.source_kind)} reply · ${title}\n${body || 'No plain-text excerpt is available.'}${evidence ? '\nEmail consent withdrawn automatically from this explicit request.' : ''}`, note, now, taskId),
 ])
 if (received[1].meta.changes) await syncAutomaticStop(env, taskId, now)
 const task = await one({ db: env.DB }, 'SELECT * FROM cf_reply_tasks WHERE id=?', taskId)
 if (!task || !['pending', 'failed'].includes(task.status)) return
 if (task.attempt_key) {
  if (task.forwarding_at && Date.parse(task.forwarding_at) < Date.now() - 300000) {
   await recordState(env.DB, taskId, task.attempt_key, 'uncertain', 'Forwarding outcome is unknown. Check the assigned person’s inbox before taking action.', now)
  }
  return
 }
 if (!owner) return
 const attempt = crypto.randomUUID()
 const claim = await env.DB.prepare(`UPDATE cf_reply_tasks SET status='pending',owner_id=?,forwarded_to=?,attempt_key=?,forwarding_at=?,note='Forwarding in progress.'
  WHERE id=? AND status IN ('pending','failed') AND attempt_key IS NULL
  AND EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND status='active' AND role IN ('owner','admin','member'))
  AND EXISTS(SELECT 1 FROM cf_donors WHERE id=cf_reply_tasks.donor_id AND erased_at IS NULL)`)
  .bind(owner.id, owner.email, attempt, now, taskId, owner.id, owner.email).run()
 if (!claim.meta.changes) return
 try { await input.forward(owner.email) } catch {
  await recordState(env.DB, taskId, attempt, 'uncertain', 'Forwarding did not confirm success. Check the assigned person’s inbox; the saved reply needs attention.', new Date().toISOString())
  // A provider exception may happen after acceptance. Never automatically send twice.
  throw new Error('Reply forwarding did not confirm success; review the reply task.')
 }
 await recordState(env.DB, taskId, attempt, 'forwarded', communication.mailbox_id?'Mailbox provider accepted forwarding to the assigned relationship manager. Follow-up is still open.':'Cloudflare confirmed forwarding to the assigned relationship manager. Follow-up is still open.', new Date().toISOString())
}

export function replyTasks(c: Context) {
 requireRole(c.actor, ['owner', 'admin', 'member'], 'read donor replies')
 return all(c, `SELECT r.*,d.name AS donor_name,o.display_name AS owner_name,o.status AS owner_status,
  COALESCE(c.source_kind,CASE WHEN r.mailbox_id IS NOT NULL THEN 'mailbox' WHEN b.kind='statement' THEN 'statement' WHEN a.id LIKE 'receipt-%' THEN 'receipt' ELSE 'acknowledgment' END) AS source_kind,
  COALESCE(c.source_id,a.id) AS source_id,
  CASE WHEN r.status='pending' AND r.attempt_key IS NOT NULL AND r.forwarding_at<? THEN 1 ELSE 0 END AS stale_forward,
  CASE WHEN r.stop_status='proposed' AND NOT (${stopIsCurrent}) THEN 1 ELSE 0 END AS stale_stop,
  CASE WHEN r.stop_status='automatic' AND (${automaticStopIsCurrent}) THEN 1 ELSE 0 END AS can_reverse_stop
  FROM cf_reply_tasks r JOIN cf_donors d ON d.id=r.donor_id AND d.erased_at IS NULL AND (r.mailbox_id IS NULL OR ?=1)
  LEFT JOIN cf_communications c ON c.id=r.communication_id LEFT JOIN cf_acks a ON a.id=r.letter_id
  LEFT JOIN cf_ack_batches b ON b.id=a.batch_id LEFT JOIN oa_operators o ON o.id=r.owner_id
  ORDER BY CASE WHEN r.status IN ('filed','done') THEN 1 ELSE 0 END,r.received_at DESC,r.id DESC`, new Date(Date.parse(c.now) - 300000).toISOString(),manager(c.actor)?1:0)
}

export async function replyCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 const stopped = await replyStopCommand(c, command, p)
 if (stopped !== undefined) return stopped
 if (command !== 'reply.complete') return undefined
 requireRole(c.actor, ['owner', 'admin', 'member'], 'complete donor replies')
 const taskId = id(p.taskId, 'Reply task'), notes = longText(p.notes, 'Follow-up outcome', 2000)
 const task = await one(c, 'SELECT * FROM cf_reply_tasks WHERE id=?', taskId)
 if (!task) fail('NOT_FOUND', 'That reply task no longer exists.', 404)
 if(task.mailbox_id&&!manager(c.actor))fail('FORBIDDEN','Only owners and admins review private mailbox replies.',403)
 if (!manager(c.actor) && task.owner_id !== c.actor.id) fail('FORBIDDEN', 'Only the assigned person or an administrator can finish this reply.', 403)
 await commit(c, [guard(`EXISTS(SELECT 1 FROM cf_reply_tasks r JOIN cf_donors d ON d.id=r.donor_id WHERE r.id=? AND r.status NOT IN ('done','filed') AND d.erased_at IS NULL AND (?=1 OR r.owner_id=?))`, 'REPLY_CHANGED', 'This reply changed or is already closed. Refresh before saving.', taskId, manager(c.actor) ? 1 : 0, c.actor.id),
  sql("UPDATE cf_reply_tasks SET status='done',note=? WHERE id=?", notes, taskId),
  sql('UPDATE cf_interactions SET next_step=? WHERE id=?', task.mailbox_id?'Private mailbox follow-up completed.':`Follow-up completed by ${c.actor.name}: ${notes}`, taskId),
  event(c, command, 'reply', taskId, task.donor_id, { communicationId: task.communication_id })])
 return (await one(c, 'SELECT * FROM cf_reply_tasks WHERE id=?', taskId))!
}
