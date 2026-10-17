import { createHash } from 'node:crypto'
import type { Bindings } from '../../auth.server'
import { fail, type Row } from '../db'

type MailchimpBindings = Bindings & {
 MAILCHIMP_API_KEY?: string
 MAILCHIMP_LIST_ID?: string
 MAILCHIMP_FROM_NAME?: string
 MAILCHIMP_FROM_EMAIL?: string
}
const address = (value: unknown): string => {
 if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) fail('MAILCHIMP_ADDRESS', 'Mailchimp needs a valid email address.', 400)
 return value.trim().toLowerCase()
}
const hash = (value: string) => createHash('md5').update(address(value)).digest('hex')
const part = (value: unknown): string => {
 if (typeof value !== 'string' || !value || value === '.' || value === '..') fail('MAILCHIMP_RESPONSE', 'Mailchimp did not return a valid identifier.', 502)
 return encodeURIComponent(value)
}

export function mailchimpUnavailable(env?: Bindings): string | null {
 if (env?.RER_INSTALLATION_ID || env?.RER_MANAGEMENT_ORIGIN) return 'Email marketing is not available yet on RER Managed.'
 const config = env as MailchimpBindings | undefined
 if (!config?.MAILCHIMP_API_KEY || !config.MAILCHIMP_LIST_ID || !config.MAILCHIMP_FROM_NAME || !config.MAILCHIMP_FROM_EMAIL || !config.COFFER_REPLY_ADDRESS) return 'Connect Mailchimp with its API key, audience, sender, and Coffer reply address.'
 return null
}
function connection(env?: Bindings) {
 const unavailable = mailchimpUnavailable(env)
 if (unavailable) fail('MAILCHIMP_UNAVAILABLE', unavailable, 503)
 const config = env as MailchimpBindings, key = config.MAILCHIMP_API_KEY!
 const match = /^[A-Za-z0-9]+-(us[1-9][0-9]*)$/.exec(key)
 if (!match || !config.MAILCHIMP_LIST_ID!.trim() || /[\r\n]/.test(config.MAILCHIMP_FROM_NAME!)) fail('MAILCHIMP_CONFIG', 'Check the Mailchimp connection settings.', 400)
 return { origin:`https://${match[1]}.api.mailchimp.com/3.0`, key, list:config.MAILCHIMP_LIST_ID!.trim() }
}
function sender(env?: Bindings) {
 connection(env)
 const config = env as MailchimpBindings
 const from = address(config.MAILCHIMP_FROM_EMAIL), replyTo = address(config.COFFER_REPLY_ADDRESS)
 // The Marketing API documents reply_to, not an independent from_email field.
 // Require one address so replies reach the configured Coffer inbound route.
 if (from !== replyTo) fail('MAILCHIMP_REPLY', 'Use the Coffer reply address as the Mailchimp sender address, and route it to this Worker.', 409)
 if (!config.MAILCHIMP_FROM_NAME?.trim()) fail('MAILCHIMP_CONFIG', 'Set the Mailchimp sender name.', 400)
 return {from_name:config.MAILCHIMP_FROM_NAME.trim(),reply_to:replyTo,use_conversation:false,auto_footer:true}
}
async function request(env: Bindings | undefined, path: string, method = 'GET', body?: unknown, missing = false): Promise<Row | null> {
 const conn = connection(env)
 let response: Response
 try {
  response = await fetch(conn.origin + path, {method,redirect:'manual',signal:AbortSignal.timeout(20_000),
   headers:{authorization:`Bearer ${conn.key}`,accept:'application/json',...(body === undefined ? {} : {'content-type':'application/json'})},
   ...(body === undefined ? {} : {body:JSON.stringify(body)})})
 } catch { return fail('MAILCHIMP_UNREACHABLE', 'Mailchimp could not confirm the request. Review the saved campaign before submitting again.', 502) }
 if (missing && response.status === 404) return null
 if (!response.ok) fail('MAILCHIMP_REFUSED', `Mailchimp refused this request (HTTP ${response.status}). Review it in Mailchimp.`, 502, {providerStatus:response.status})
 if (response.status === 204) return {}
 try {
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
  return data as Row
 } catch { return fail('MAILCHIMP_RESPONSE', 'Mailchimp returned an unreadable response.', 502) }
}
const listPath = (env?: Bindings) => `/lists/${part(connection(env).list)}`
function contact(data: Row, expected: string): Row {
 if (typeof data.id !== 'string' || !data.id || typeof data.email_address !== 'string' || data.email_address.toLowerCase() !== address(expected) || !['subscribed','unsubscribed','cleaned','pending','transactional','archived'].includes(data.status)) fail('MAILCHIMP_RESPONSE', 'Mailchimp did not confirm the contact’s subscription state.', 502)
 return {id:data.id,email:data.email_address.toLowerCase(),emailStatus:data.status}
}
export async function mailchimpContact(env: Bindings | undefined, email: string): Promise<Row | null> {
 const data = await request(env, `${listPath(env)}/members/${hash(email)}`, 'GET', undefined, true)
 return data ? contact(data, email) : null
}
export async function suppressMailchimp(env: Bindings | undefined, email: string): Promise<void> {
 // PUT also records an opt-out for an address not yet present in the audience.
 await request(env, `${listPath(env)}/members/${hash(email)}`, 'PUT', {email_address:address(email),status_if_new:'unsubscribed',status:'unsubscribed'})
 if ((await mailchimpContact(env, email))?.emailStatus !== 'unsubscribed') fail('MAILCHIMP_PREFERENCE', 'Mailchimp has not confirmed this opt-out. Refresh preferences before sending.', 502)
}
export async function captureMailchimpConsent(env: Bindings | undefined, donor: Row, _organisation: string): Promise<Row | null> {
 const existing = await mailchimpContact(env, donor.email)
 if (existing) return existing
 // Omit status even after a missing-contact read: a concurrent unsubscribe must
 // survive the upsert. Mailchimp sends its double opt-in confirmation for pending.
 const data = await request(env, `${listPath(env)}/members/${hash(donor.email)}`, 'PUT', {email_address:address(donor.email),status_if_new:'pending'})
 return contact(data!, donor.email)
}
async function verifyRecipient(env: Bindings | undefined, segmentId: string, email: string): Promise<void> {
 const members = await request(env, `${listPath(env)}/segments/${part(segmentId)}/members?count=2&include_cleaned=true&include_transactional=true&include_unsubscribed=true`)
 if (members?.total_items !== 1 || !Array.isArray(members.members) || members.members.length !== 1 || contact(members.members[0], email).emailStatus !== 'subscribed') fail('MAILCHIMP_RECIPIENT', 'Mailchimp did not confirm exactly one subscribed recipient. Review the saved campaign.', 409)
}
export async function createMailchimpCampaign(env: Bindings | undefined, row: Row): Promise<Row> {
 const settings = sender(env), email = address(row.email)
 if ((await mailchimpContact(env, email))?.emailStatus !== 'subscribed') fail('MAILCHIMP_PREFERENCE', 'Mailchimp requires a confirmed subscription before sending.', 409)
 const segment = await request(env, `${listPath(env)}/segments`, 'POST', {name:`Coffer ${row.id}`,static_segment:[email]})
 if (!Number.isSafeInteger(segment?.id) || segment!.id <= 0 || segment!.type !== 'static' || segment!.member_count !== 1) fail('MAILCHIMP_RECIPIENT', 'Mailchimp did not confirm a one-recipient static segment.', 502)
 const revisionId = String(segment!.id)
 await verifyRecipient(env, revisionId, email)
 const campaign = await request(env, '/campaigns', 'POST', {type:'regular',recipients:{list_id:connection(env).list,segment_opts:{saved_segment_id:segment!.id}},settings:{...settings,title:`Coffer ${row.id}`,subject_line:row.subject},tracking:{opens:false,html_clicks:false,text_clicks:false}})
 part(campaign?.id)
 return {campaignId:campaign!.id,revisionId}
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export async function composeMailchimpCampaign(env: Bindings | undefined, row: Row, draft: Row): Promise<void> {
 const settings = sender(env), path = `/campaigns/${part(draft.campaignId)}`
 const saved = await request(env, path)
 const recipients = saved?.recipients, segment = recipients?.segment_opts
 if (saved?.status !== 'save' || saved.type !== 'regular' || recipients?.list_id !== connection(env).list || recipients.recipient_count !== 1 || String(segment?.saved_segment_id) !== draft.revisionId || segment.prebuilt_segment_id || segment.conditions?.length) fail('MAILCHIMP_CAMPAIGN', 'The saved Mailchimp campaign changed. Review it before sending.', 409)
 if (typeof row.subject !== 'string' || !row.subject.trim() || /[\r\n]/.test(row.subject) || typeof row.body !== 'string' || !row.body.trim()) fail('MAILCHIMP_CONTENT', 'Mailchimp needs a subject and message body.', 400)
 const html = row.body.split(/\n\s*\n/).map((p: string) => `<p>${escape(p).replaceAll('\n','<br>')}</p>`).join('')
 const footer = '<hr><p>*|LIST:DESCRIPTION|*</p><p>*|HTML:LIST_ADDRESS_HTML|*</p><p><a href="*|UNSUB|*">Unsubscribe</a> · <a href="*|UPDATE_PROFILE|*">Update your preferences</a></p>*|IF:REWARDS|* *|HTML:REWARDS|* *|END:IF|*'
 await request(env, path, 'PATCH', {settings:{...settings,subject_line:row.subject}})
 await request(env, `${path}/content`, 'PUT', {html:html+footer,plain_text:`${row.body}\n\n*|LIST:DESCRIPTION|*\n*|LIST:ADDRESS|*\nUnsubscribe: *|UNSUB|*\nUpdate your preferences: *|UPDATE_PROFILE|*\n*|IF:REWARDS|* *|REWARDS|* *|END:IF|*`})
 await verifyRecipient(env, draft.revisionId, row.email)
 // A single send action. The caller persists the draft and owns the send claim;
 // timeout/refusal is uncertain and must never trigger an automatic resend.
 await request(env, `${path}/actions/send`, 'POST')
}
export async function mailchimpResults(env: Bindings | undefined, row: Row): Promise<Row> {
 const campaignId = part(row.campaign_id)
 const campaign = await request(env, `/campaigns/${campaignId}`)
 if (campaign?.status !== 'sent') return {rows:[],state:campaign?.status??'unknown'}
 const report = await request(env, `/reports/${campaignId}/sent-to?count=2`)
 if (!Array.isArray(report?.sent_to) || !Number.isSafeInteger(report.total_items) || report.total_items > 1 || report.sent_to.length !== report.total_items) fail('MAILCHIMP_RESPONSE', 'Mailchimp did not confirm the campaign recipient results.', 502)
 return {rows:report.sent_to.map((recipient: Row) => {
  if (typeof recipient.email_address !== 'string' || !['sent','hard','soft'].includes(recipient.status)) fail('MAILCHIMP_RESPONSE', 'Mailchimp returned an unknown send result.', 502)
  return {destination:address(recipient.email_address),disposition:recipient.status === 'sent' ? 'sent' : 'bounced'}
 })}
}
