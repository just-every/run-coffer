import { commit, event, fail, guard, integer, one, sql, text, type Context, type Row, type Stmt } from './db'
import { textEnvironment } from './giving/connections'
import type { GivingEnv } from './giving/stripe'

const columns = `version,account_sid,messaging_service_sid,campaign_sid,sender,campaign_status,sender_registered,
 CASE WHEN approved=1 AND connection_sealed IS (SELECT sealed FROM cf_giving_connections WHERE name='twilio') THEN 1 ELSE 0 END AS approved,
 checked_at,provider_updated_at,number_campaign_sid,phone_number_sid,number_status,number_status_at`
const managers = (c: Context) => { if (!['owner','admin'].includes(c.actor.role)) fail('FORBIDDEN', 'Only an owner or admin manages SMS registration.', 403) }
const sid = (value: unknown, _prefix: string, label: string) => text(value, label, 100)

/** No credentials or encrypted connection contents enter returned state. */
export async function smsRegistrationState(c: Pick<Context, 'db'>): Promise<Row> {
 return await one(c, `SELECT ${columns} FROM cf_sms_registration WHERE id=1`) ?? { version: 0, approved: 0, campaign_status: 'UNREGISTERED', sender_registered: 0, number_status: 'unknown' }
}

async function configured(c: Context) {
 if (!c.env) fail('SMS_UNAVAILABLE', 'Connect Twilio before verifying SMS registration.', 409)
 const connection = await one(c, "SELECT sealed FROM cf_giving_connections WHERE name='twilio'")
 const env = await textEnvironment(c.env as GivingEnv)
 if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) fail('SMS_UNAVAILABLE', 'Connect Twilio before verifying SMS registration.', 409)
 sid(env.TWILIO_ACCOUNT_SID, 'AC', 'Twilio account SID')
 if (!/^\+[1-9]\d{7,14}$/.test(env.TWILIO_FROM)) fail('SMS_UNAVAILABLE', 'Configure a Twilio sender with + and country code.', 409)
 return { env, sealed: connection?.sealed ?? null }
}

async function getTwilio(env: GivingEnv, path: string): Promise<Row> {
 try {
  const response = await fetch(`https://messaging.twilio.com${path}`, {
   method: 'GET', headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, Accept: 'application/json' },
   redirect: 'manual', signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) fail('SMS_REGISTRATION_UNAVAILABLE', 'Twilio could not verify this registration. Check the account, service and campaign in Twilio, then refresh.', 503)
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid provider response')
  return data as Row
 } catch {
  return fail('SMS_REGISTRATION_UNAVAILABLE', 'Twilio registration verification is unavailable. No text may be sent until verification succeeds.', 503)
 }
}

// API references: https://www.twilio.com/docs/messaging/api/usapptoperson-resource
// and https://www.twilio.com/docs/messaging/api/phonenumber-resource
async function providerState(env: GivingEnv, service: string, campaignSid: string) {
 const base = `/v1/Services/${service}`
 const campaign = await getTwilio(env, `${base}/Compliance/Usa2p/${campaignSid}`)
 if (campaign.sid !== campaignSid || campaign.messaging_service_sid !== service || campaign.account_sid !== env.TWILIO_ACCOUNT_SID || typeof campaign.campaign_status !== 'string') {
  fail('SMS_REGISTRATION_UNAVAILABLE', 'Twilio returned a different account or campaign. Check the registration references.', 503)
 }
 let next: string | null = `${base}/PhoneNumbers?PageSize=1000`, registered = false, phoneNumberSid:string|null=null
 const visited = new Set<string>()
 while (next) {
  if (visited.has(next)) fail('SMS_REGISTRATION_UNAVAILABLE', 'Twilio returned incomplete sender verification. Refresh registration before sending.', 503)
  visited.add(next)
  const page = await getTwilio(env, next)
  if (!Array.isArray(page.phone_numbers)) fail('SMS_REGISTRATION_UNAVAILABLE', 'Twilio returned incomplete sender verification.', 503)
  const number=page.phone_numbers.find((number:Row)=>number.phone_number===env.TWILIO_FROM&&number.service_sid===service&&number.account_sid===env.TWILIO_ACCOUNT_SID)
  registered=Boolean(number&&typeof number.sid==='string');phoneNumberSid=registered?number.sid:null
  if (registered) break
  const nextUrl = page.meta?.next_page_url
  if (nextUrl === null || nextUrl === undefined) { next = null; continue }
  // Never forward credentials to a provider-supplied host or unrelated path.
  const url = new URL(nextUrl, 'https://messaging.twilio.com')
  if (url.origin !== 'https://messaging.twilio.com' || url.pathname !== `${base}/PhoneNumbers`) fail('SMS_REGISTRATION_UNAVAILABLE', 'Twilio returned an invalid sender verification page.', 503)
  next = url.pathname + url.search
 }
 return {
  status: text(campaign.campaign_status, 'Twilio campaign status', 100), registered, phoneNumberSid,
  approved: campaign.campaign_status === 'VERIFIED' && campaign.mock === false && registered,
  updatedAt: typeof campaign.date_updated === 'string' ? campaign.date_updated : null,
 }
}

async function refresh(c: Context, service: string, campaign: string, version: number, action: string, numberCampaignSid:string): Promise<Row> {
 if (c.transactionPlan) fail('SMS_REGISTRATION_UNAVAILABLE', 'Registration verification requires an immediate provider check.', 409)
 const { env, sealed } = await configured(c), result = await providerState(env, service, campaign)
 const saved=await one(c,'SELECT * FROM cf_sms_registration WHERE id=1')
 const changed=!saved||saved.account_sid!==env.TWILIO_ACCOUNT_SID||saved.messaging_service_sid!==service||saved.campaign_sid!==campaign||saved.sender!==env.TWILIO_FROM||saved.connection_sealed!==sealed||saved.number_campaign_sid!==numberCampaignSid||saved.phone_number_sid!==result.phoneNumberSid
 const numberStatus=changed?'unknown':saved!.number_status,configuredAt=changed?c.now:saved!.number_configured_at
 const approved=result.approved&&numberStatus==='registered'
 await commit(c, [
  guard('COALESCE((SELECT version FROM cf_sms_registration WHERE id=1),0)=?', 'VERSION', 'SMS registration changed. Refresh before continuing.', version),
  guard("(SELECT sealed FROM cf_giving_connections WHERE name='twilio') IS ?", 'SMS_CONNECTION_CHANGED', 'The Twilio connection changed. Refresh registration again.', sealed),
  sql(`INSERT INTO cf_sms_registration(id,version,account_sid,messaging_service_sid,campaign_sid,sender,campaign_status,sender_registered,approved,checked_at,provider_updated_at,connection_sealed,number_campaign_sid,phone_number_sid,number_configured_at,number_status,number_status_at,number_event_id)
   VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,account_sid=excluded.account_sid,messaging_service_sid=excluded.messaging_service_sid,campaign_sid=excluded.campaign_sid,sender=excluded.sender,campaign_status=excluded.campaign_status,sender_registered=excluded.sender_registered,approved=excluded.approved,checked_at=excluded.checked_at,provider_updated_at=excluded.provider_updated_at,connection_sealed=excluded.connection_sealed,number_campaign_sid=excluded.number_campaign_sid,phone_number_sid=excluded.phone_number_sid,number_configured_at=excluded.number_configured_at,number_status=excluded.number_status,number_status_at=excluded.number_status_at,number_event_id=excluded.number_event_id`,
   version + 1, env.TWILIO_ACCOUNT_SID, service, campaign, env.TWILIO_FROM, result.status, Number(result.registered), Number(approved), c.now, result.updatedAt, sealed,numberCampaignSid,result.phoneNumberSid,configuredAt,numberStatus,changed?null:saved!.number_status_at,changed?null:saved!.number_event_id),
  event(c, action, 'sms-registration', campaign, null, { messagingServiceSid: service, campaignStatus: result.status, senderRegistered: result.registered, approved, numberStatus }),
 ])
 return smsRegistrationState(c)
}

export async function smsRegistrationCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'sms.registration.refresh') return undefined
 managers(c)
 return refresh(c, sid(p.messagingServiceSid, 'MG', 'Messaging Service SID'), sid(p.campaignSid, 'QE', 'A2P campaign SID'), integer(Number(p.version), 'Registration version', 0), command,sid(p.numberCampaignSid,'CM','Number event campaign SID'))
}

/** Include in the recipient claim transaction immediately before submission. */
export function registrationGuard(from: string, version?: number): Stmt {
 return guard(`EXISTS(SELECT 1 FROM cf_sms_registration r WHERE r.id=1 AND r.approved=1 AND r.campaign_status='VERIFIED' AND r.sender_registered=1 AND r.number_status='registered' AND r.sender=? AND r.connection_sealed IS (SELECT sealed FROM cf_giving_connections WHERE name='twilio')${version === undefined ? '' : ' AND r.version=?'})`,
  'SMS_REGISTRATION_REQUIRED', 'Verify the registered Twilio sender in Settings before sending texts.', from, ...(version === undefined ? [] : [version]))
}

/** Always checks Twilio again; saved approval never masks an unavailable provider. */
export async function requireSmsRegistration(c: Context, from: string): Promise<Row> {
 const saved = await smsRegistrationState(c), { env } = await configured(c)
 if (!saved.version || !saved.approved || saved.sender !== from || env.TWILIO_FROM !== from || saved.account_sid !== env.TWILIO_ACCOUNT_SID) fail('SMS_REGISTRATION_REQUIRED', 'Verify this Twilio account and sender in Settings before sending texts.', 409)
 const current = await providerState(env, saved.messaging_service_sid, saved.campaign_sid)
 if (!current.approved || current.phoneNumberSid !== saved.phone_number_sid || saved.number_status !== 'registered') fail('SMS_REGISTRATION_REQUIRED', 'Twilio has not confirmed this campaign and the individual number registration. Review registration in Settings before sending texts.', 409)
 // The recipient claim fences this snapshot's version. A read-only provider
 // check lets independent approved runs compete on their actual outreach caps;
 // a concurrent configuration change or signed status event still fences both.
 return saved
}
