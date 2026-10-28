import type { Bindings } from '../auth.server'
// @ts-expect-error Shared mail validation is JavaScript and owns the mailbox grammar.
import { parseAddress } from '../modules/mail/src/core/validation.mjs'
import { requireRole } from './auth'
import { commit, event, fail, guard, integer, object, one, sha256, sql, type Context, type Row } from './db'
import { donorMailUnavailable } from './outbound-mail'

// Provider definitions and validation: https://www.twilio.com/docs/sendgrid/api-reference/domain-authentication
// DNS requests always go to the fixed resolver; record names never become fetch origins.
const API = 'https://api.sendgrid.com/v3/whitelabel/domains/'
const DNS = 'https://cloudflare-dns.com/dns-query'
const KEYS = ['mail_cname', 'dkim1', 'dkim2'] as const
type RecordKey = typeof KEYS[number]
export type SendingDomainRecord = { key: RecordKey; purpose: 'SPF' | 'DKIM'; type: 'CNAME'; host: string; value: string; valid: boolean }
type Saved = { id: number; version: number; provider: 'sendgrid'; mail_from: string; domain: string; configuration_hash: string; authentication_id: number; records: string; status: 'pending' | 'verified'; checked_at: string | null; verified_at: string | null }
const current = (c: { db: D1Database }) => one<Saved>(c, 'SELECT * FROM cf_sending_domain WHERE id=1')

function access(c: Context) { requireRole(c.actor, ['owner', 'admin'], 'manage the sending domain') }
function senderDomain(env?: Bindings): string | null {
 try { return parseAddress(env?.MAIL_FROM).email.split('@')[1].toLowerCase() } catch { return null }
}
function unavailable(env?: Bindings): string | null {
 const reason = donorMailUnavailable(env)
 if (reason) return reason
 if (env?.MAIL_PROVIDER !== 'sendgrid') return 'Verified automatic receipts currently require SendGrid with automated domain security.'
 if (!senderDomain(env)) return 'Set a valid sender address in the installation mail settings.'
 return null
}
async function configurationHash(env?: Bindings) {
 // Only the digest is persisted. Rotating the provider credential requires fresh verification.
 return sha256(JSON.stringify(['coffer:sending-domain:1', env?.MAIL_PROVIDER ?? '', env?.MAIL_FROM ?? '', env?.MAIL_API_KEY ?? '', env?.MAIL_ACCOUNT_ID ?? '', env?.MAIL_RELAY_URL ?? '']))
}
function configured(env?: Bindings): asserts env is Bindings {
 const reason = unavailable(env)
 if (reason) fail('sending_domain_unavailable', reason, 409)
}
function normalizeHost(value: unknown): string | null {
 if (typeof value !== 'string' || value.length > 254) return null
 const host = value.toLowerCase().replace(/\.$/, '')
 return /^(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) ? host : null
}
function definition(value: Row, authenticationId: number, domain: string): SendingDomainRecord[] {
 if (value.id !== authenticationId || normalizeHost(value.domain) !== domain || value.automatic_security !== true || value.legacy === true)
  fail('sending_domain_definition', 'Choose a SendGrid domain authentication for this exact sender domain with automated security enabled.', 409)
 const records = KEYS.map(key => {
  const record = value.dns?.[key], host = normalizeHost(record?.host), target = normalizeHost(record?.data)
  if (typeof record?.type !== 'string' || record.type.toLowerCase() !== 'cname' || !host || !target || !host.endsWith('.' + domain) || !target.endsWith('.sendgrid.net') ||
      (key !== 'mail_cname' && !host.endsWith('._domainkey.' + domain)))
   fail('sending_domain_definition', 'SendGrid returned incomplete or unsupported domain authentication records. Check automated security in SendGrid.', 409)
  return { key, purpose: key === 'mail_cname' ? 'SPF' as const : 'DKIM' as const, type: 'CNAME' as const, host, value: target, valid: false }
 })
 if (new Set(records.map(r => r.host)).size !== records.length) fail('sending_domain_definition', 'SendGrid returned duplicate domain authentication records.', 502)
 return records
}
async function provider(env: Bindings, authenticationId: number, validate = false): Promise<Row> {
 let response: Response
 try {
  response = await fetch(API + authenticationId + (validate ? '/validate' : ''), { method: validate ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
   headers: { authorization: `Bearer ${env.MAIL_API_KEY}`, accept: 'application/json' } })
 } catch { return fail('sending_domain_provider', 'SendGrid could not be reached. The sending domain has not been verified.', 502) }
 if ([401, 403].includes(response.status)) fail('sending_domain_provider_access', 'The mail key needs access to this SendGrid domain authentication and its validation API.', 409)
 if (!response.ok) fail('sending_domain_provider', 'SendGrid could not check this domain authentication. Check its ID and account permissions.', 502)
 const value: unknown = await response.json().catch(() => null)
 if (!value || typeof value !== 'object' || Array.isArray(value)) fail('sending_domain_provider', 'SendGrid returned an unreadable domain authentication result.', 502)
 return value as Row
}
async function dns(name: string, type: 'CNAME' | 'TXT'): Promise<Row[]> {
 const url = new URL(DNS)
 url.searchParams.set('name', name); url.searchParams.set('type', type)
 let response: Response
 try { response = await fetch(url.href, { headers: { accept: 'application/dns-json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) }) }
 catch { return fail('sending_domain_dns', 'The DNS resolver could not be reached. The sending domain has not been verified.', 502) }
 const result = await response.json().catch(() => null) as Row | null
 if (!response.ok || !result || ![0, 3].includes(result.Status) || (result.Answer !== undefined && !Array.isArray(result.Answer)))
  fail('sending_domain_dns', 'The DNS resolver could not confirm the records. The sending domain has not been verified.', 502)
 const answers: unknown[] = result.Status === 0 ? result.Answer ?? [] : []
 if (answers.some(r => !r || typeof r !== 'object' || Array.isArray(r))) fail('sending_domain_dns', 'The DNS resolver returned unreadable records. The sending domain has not been verified.', 502)
 return answers as Row[]
}
function txt(value: unknown): string {
 if (typeof value !== 'string') return ''
 // DNS JSON presents TXT records as one or more quoted character strings.
 const parts = value.match(/"(?:[^"\\]|\\.)*"/g)
 if (!parts || parts.join(' ') !== value.trim()) return ''
 try { return parts.map(p => JSON.parse(p)).join('') } catch { return '' }
}

export async function sendingDomain(c: Context) {
 access(c)
 await commit(c, [])
 const saved = await current(c), reason = unavailable(c.env)
 const matches = !!saved && !reason && saved.configuration_hash === await configurationHash(c.env)
 return { version: saved?.version ?? 0, status: saved ? matches ? saved.status : 'configuration_changed' : 'unconfigured',
  domain: saved?.domain ?? senderDomain(c.env), mailFrom: saved?.mail_from ?? c.env?.MAIL_FROM ?? null, provider: saved?.provider ?? c.env?.MAIL_PROVIDER ?? null,
  currentMailFrom: c.env?.MAIL_FROM ?? null, authenticationId: saved?.authentication_id ?? null,
  records: saved ? JSON.parse(saved.records) as SendingDomainRecord[] : [], checkedAt: saved?.checked_at ?? null,
  verifiedAt: matches ? saved?.verified_at ?? null : null, canConfigure: !reason, unavailable: reason }
}

/** This assertion is also available to scheduled automatic receipt dispatch. */
export async function assertVerifiedReceiptSender(c: { db: D1Database }, env?: Bindings) {
 configured(env)
 const saved = await current(c)
 if (!saved || saved.status !== 'verified' || !saved.verified_at || saved.configuration_hash !== await configurationHash(env) || saved.mail_from !== env.MAIL_FROM || saved.domain !== senderDomain(env))
  fail('sending_domain_unverified', 'Verify the current sending domain in Settings before sending automatic receipts.', 409)
 return { id: 1, version: saved.version, domain: saved.domain, mailFrom: saved.mail_from, provider: saved.provider }
}

export async function sendingDomainCommand(c: Context, command: string, input: unknown) {
 access(c)
 if (c.transactionPlan) fail('sending_domain_transaction', 'Sending domain checks must run as a separate command.', 409)
 const p = object(input), version = integer(typeof p.version === 'string' && /^\d+$/.test(p.version) ? Number(p.version) : p.version, 'Sending domain version')
 if (!['sendingDomain.save', 'sendingDomain.verify'].includes(command)) fail('COMMAND', 'Unknown sending domain command.', 404)
 configured(c.env)
 const env = c.env, saved = await current(c)
 if ((saved?.version ?? 0) !== version) fail('VERSION', 'The sending domain changed. Refresh before saving or checking again.')
 const fence = () => guard('COALESCE((SELECT version FROM cf_sending_domain WHERE id=1),0)=?', 'VERSION', 'The sending domain changed. Refresh before saving or checking again.', version)
 // Recheck the current actor before crossing a provider edge, and again on every write.
 await commit(c, [fence()])
 if (command === 'sendingDomain.save') {
  const authenticationId = integer(typeof p.authenticationId === 'string' && /^\d+$/.test(p.authenticationId) ? Number(p.authenticationId) : p.authenticationId, 'SendGrid authentication ID', 1)
  const domain = senderDomain(env)!, records = definition(await provider(env, authenticationId), authenticationId, domain)
  const hash = await configurationHash(env)
  await commit(c, [fence(), sql(`INSERT INTO cf_sending_domain(id,version,provider,mail_from,domain,configuration_hash,authentication_id,records,status,configured_by,updated_at)
   VALUES(1,?,'sendgrid',?,?,?,?,?,'pending',?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,provider=excluded.provider,mail_from=excluded.mail_from,domain=excluded.domain,
   configuration_hash=excluded.configuration_hash,authentication_id=excluded.authentication_id,records=excluded.records,status='pending',checked_at=NULL,verified_at=NULL,configured_by=excluded.configured_by,updated_at=excluded.updated_at`,
   version + 1, env.MAIL_FROM!, domain, hash, authenticationId, JSON.stringify(records), c.actor.id, c.now),
   event(c, 'sendingDomain.saved', 'sending_domain', '1', null, { version: version + 1, authenticationId })])
 } else {
  if (!saved) fail('sending_domain_unconfigured', 'Save a sending domain before checking its DNS records.')
  if (saved.configuration_hash !== await configurationHash(env)) fail('sending_domain_changed', 'The installation mail settings changed. Save the current sending domain before verifying it.')
  // Reserve this check and remove earlier verification before any external lookup.
  const pendingRecords = (JSON.parse(saved.records) as SendingDomainRecord[]).map(r => ({ ...r, valid: false }))
  await commit(c, [fence(), sql("UPDATE cf_sending_domain SET version=version+1,status='pending',records=?,verified_at=NULL,checked_at=NULL,updated_at=? WHERE id=1", JSON.stringify(pendingRecords), c.now),
   event(c, 'sendingDomain.checkStarted', 'sending_domain', '1', null, { version: version + 1 })])
  const records = definition(await provider(env, saved.authentication_id), saved.authentication_id, saved.domain)
  if (JSON.stringify(records.map(({ valid: _valid, ...r }) => r)) !== JSON.stringify((JSON.parse(saved.records) as SendingDomainRecord[]).map(({ valid: _valid, ...r }) => r)))
   fail('sending_domain_changed', 'The SendGrid DNS requirements changed. Save the domain again to load the current records.')
  const [validation, answers, spf] = await Promise.all([provider(env, saved.authentication_id, true), Promise.all(records.map(r => dns(r.host, 'CNAME'))), dns(records[0].host, 'TXT')])
  if (validation.id !== saved.authentication_id || typeof validation.valid !== 'boolean') fail('sending_domain_provider', 'SendGrid returned an unmatched domain validation result.', 502)
  const spfRecords = spf.filter(r => r.type === 16 && normalizeHost(r.name) === records[0].value).map(r => txt(r.data)).filter(v => /^v=spf1(?:\s|$)/i.test(v))
  records.forEach((r, i) => { r.valid = validation.validation_results?.[r.key]?.valid === true && answers[i].some(a => a.type === 5 && normalizeHost(a.name) === r.host && normalizeHost(a.data) === r.value) && (r.key !== 'mail_cname' || spfRecords.length === 1) })
  const verified = validation.valid === true && records.every(r => r.valid)
  await commit(c, [guard('EXISTS(SELECT 1 FROM cf_sending_domain WHERE id=1 AND version=? AND configuration_hash=?)', 'VERSION', 'The sending domain changed during verification. Refresh and check again.', version + 1, saved.configuration_hash),
   sql('UPDATE cf_sending_domain SET status=?,records=?,checked_at=?,verified_at=?,updated_at=? WHERE id=1', verified ? 'verified' : 'pending', JSON.stringify(records), c.now, verified ? c.now : null, c.now),
   event(c, verified ? 'sendingDomain.verified' : 'sendingDomain.pending', 'sending_domain', '1', null, { version: version + 1, checks: records.map(r => ({ key: r.key, valid: r.valid })) })])
 }
 return sendingDomain(c)
}
