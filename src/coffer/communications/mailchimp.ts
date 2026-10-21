import { createHash } from 'node:crypto'
import { fail, type Row } from '../db'
import { personNames } from '../person-names'
import type { Connection } from './connection'

const address = (value: unknown): string => {
 if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) fail('MAILCHIMP_ADDRESS', 'Mailchimp needs a valid email address.', 400)
 return value.trim().toLowerCase()
}
const hash = (value: string) => createHash('md5').update(address(value)).digest('hex')
const part = (value: unknown): string => {
 if (typeof value !== 'string' || !value || value === '.' || value === '..') fail('MAILCHIMP_RESPONSE', 'Mailchimp did not return a valid identifier.', 502)
 return encodeURIComponent(value)
}
/** The datacenter is the key's suffix, for example us21. */
export function mailchimpOrigin(key: string) {
 const match = /^[A-Za-z0-9]+-(us[1-9][0-9]*)$/.exec(key.trim())
 if (!match) fail('INPUT', 'A Mailchimp API key ends with a dash and its datacenter, for example …-us21. Copy it again from Mailchimp.', 400)
 return `https://${match![1]}.api.mailchimp.com/3.0`
}
function connection(conn: Connection) {
 if (!conn.listId) fail('MAILCHIMP_UNAVAILABLE', 'Choose the Mailchimp audience to finish connecting.', 409)
 return { origin: mailchimpOrigin(conn.credential), key: conn.credential, list: conn.listId! }
}
function sender(conn: Connection) {
 if (!conn.fromName?.trim()) fail('MAILCHIMP_CONFIG', 'Set the sender name on the Connect Mailchimp page.', 400)
 return {from_name:conn.fromName!.trim(),reply_to:address(conn.fromEmail),use_conversation:false,auto_footer:true}
}
/** Audiences for the picker; also proves the key works. */
export async function mailchimpLists(key: string): Promise<{ id: string; name: string; members: number }[]> {
 const data = await request({ provider: 'mailchimp', credential: key, listId: '-', origin: null, listName: null, fromName: null, fromEmail: null, checkedAt: null, checkNote: null }, '/lists?count=100&fields=lists.id,lists.name,lists.stats.member_count')
 if (!Array.isArray(data?.lists)) fail('MAILCHIMP_RESPONSE', 'Mailchimp did not list your audiences.', 502)
 return data!.lists.map((l: Row) => ({ id: String(l.id), name: String(l.name), members: Number(l.stats?.member_count ?? 0) }))
}
async function request(conn: Connection, path: string, method = 'GET', body?: unknown, missing = false): Promise<Row | null> {
 const target = { origin: mailchimpOrigin(conn.credential), key: conn.credential }
 let response: Response
 try {
  response = await fetch(target.origin + path, {method,redirect:'manual',signal:AbortSignal.timeout(20_000),
   headers:{authorization:`Bearer ${target.key}`,accept:'application/json',...(body === undefined ? {} : {'content-type':'application/json'})},
   ...(body === undefined ? {} : {body:JSON.stringify(body)})})
 } catch { return fail('MAILCHIMP_UNREACHABLE', 'Mailchimp could not confirm the request. Review the saved campaign before submitting again.', 502) }
 if (missing && response.status === 404) return null
 if (response.status === 401) fail('MAILCHIMP_KEY', 'Mailchimp does not accept this API key. Create a new key in Mailchimp (Profile → Extras → API keys) and save it on the Connect Mailchimp page.', 502, {providerStatus:401})
 if (!response.ok) fail('MAILCHIMP_REFUSED', `Mailchimp refused this request (HTTP ${response.status}). Review it in Mailchimp.`, 502, {providerStatus:response.status})
 if (response.status === 204) return {}
 try {
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
  return data as Row
 } catch { return fail('MAILCHIMP_RESPONSE', 'Mailchimp returned an unreadable response.', 502) }
}
const listPath = (conn: Connection) => `/lists/${part(connection(conn).list)}`
function contact(data: Row, expected: string): Row {
 if (typeof data.id !== 'string' || !data.id || typeof data.email_address !== 'string' || data.email_address.toLowerCase() !== address(expected) || !['subscribed','unsubscribed','cleaned','pending','transactional','archived'].includes(data.status)) fail('MAILCHIMP_RESPONSE', 'Mailchimp did not confirm the contact’s subscription state.', 502)
 return {id:data.id,email:data.email_address.toLowerCase(),emailStatus:data.status}
}
export async function mailchimpContact(conn: Connection, email: string): Promise<Row | null> {
 const data = await request(conn, `${listPath(conn)}/members/${hash(email)}`, 'GET', undefined, true)
 return data ? contact(data, email) : null
}
export async function suppressMailchimp(conn: Connection, email: string): Promise<void> {
 // PUT also records an opt-out for an address not yet present in the audience.
 await request(conn, `${listPath(conn)}/members/${hash(email)}`, 'PUT', {email_address:address(email),status_if_new:'unsubscribed',status:'unsubscribed'})
 if ((await mailchimpContact(conn, email))?.emailStatus !== 'unsubscribed') fail('MAILCHIMP_PREFERENCE', 'Mailchimp has not confirmed this opt-out. Refresh preferences before sending.', 502)
}
// Mailchimp audience fields must exist before member values can use their tags.
// These private text fields do not change the audience's signup form.
// https://mailchimp.com/developer/marketing/concepts/audiences/merge-fields/
const NAME_FIELDS = [
 ['CF_INFORM', 'Coffer informal salutation', 'informal'],
 ['CF_FORMAL', 'Coffer formal salutation', 'formal'],
 ['CF_ENVELOP', 'Coffer envelope name', 'envelope'],
 ['CF_PREFIX','Coffer prefix','prefix'], ['CF_FIRST','Coffer first name','first_name'], ['CF_MIDDLE','Coffer middle name','middle_name'], ['CF_LAST','Coffer last name','last_name'], ['CF_SUFFIX','Coffer suffix','suffix'], ['CF_NICK','Coffer nickname','nickname'],
] as const
async function nameMergeFields(conn: Connection, donor: Row) {
 const path = `${listPath(conn)}/merge-fields`
 const data = await request(conn, `${path}?count=1000`)
 if (!Array.isArray(data?.merge_fields) || !Number.isSafeInteger(data.total_items) || data.total_items !== data.merge_fields.length) fail('MAILCHIMP_RESPONSE', 'Mailchimp did not return the complete audience field definitions.', 502)
 // Refuse incompatible fields before creating any missing ones; never replace
 // an existing definition that another integration could be using.
 for (const [tag] of NAME_FIELDS) {
  const field = data.merge_fields.find((f: Row) => f.tag === tag)
  if (field && field.type !== 'text') fail('MAILCHIMP_FIELDS', `Mailchimp audience field ${tag} must be a text field. Review it in Mailchimp before syncing names.`, 409)
 }
 for (const [tag, name] of NAME_FIELDS) {
  if (data.merge_fields.some((f: Row) => f.tag === tag)) continue
  const field = await request(conn, path, 'POST', { tag, name, type:'text', required:false, public:false })
  if (field?.tag !== tag || field.type !== 'text') fail('MAILCHIMP_RESPONSE', 'Mailchimp did not confirm the audience name field.', 502)
 }
 const names = {...(donor.letter_names ?? personNames(donor)),...(donor.letter_name?{envelope:donor.letter_name}:{})}
 return Object.fromEntries(NAME_FIELDS.map(([tag, , key]) => [tag, key in names ? names[key as keyof typeof names] : donor[key] ?? '']))
}
/** A merge-only PATCH preserves a concurrent unsubscribe and never creates a member. */
export async function syncMailchimpNames(conn: Connection, donor: Row): Promise<Row> {
 const merge_fields = await nameMergeFields(conn, donor)
 const data = await request(conn, `${listPath(conn)}/members/${hash(donor.email)}`, 'PATCH', { merge_fields })
 return contact(data!, donor.email)
}
export async function captureMailchimpConsent(conn: Connection, donor: Row, _organisation: string): Promise<Row | null> {
 const existing = await mailchimpContact(conn, donor.email)
 if (existing) return existing
 // Omit status even after a missing-contact read: a concurrent unsubscribe must
 // survive the upsert. Mailchimp sends its double opt-in confirmation for pending.
 const merge_fields = await nameMergeFields(conn, donor)
 const data = await request(conn, `${listPath(conn)}/members/${hash(donor.email)}`, 'PUT', {email_address:address(donor.email),status_if_new:'pending',merge_fields})
 return contact(data!, donor.email)
}
async function verifyRecipient(conn: Connection, segmentId: string, email: string): Promise<void> {
 const members = await request(conn, `${listPath(conn)}/segments/${part(segmentId)}/members?count=2&include_cleaned=true&include_transactional=true&include_unsubscribed=true`)
 if (members?.total_items !== 1 || !Array.isArray(members.members) || members.members.length !== 1 || contact(members.members[0], email).emailStatus !== 'subscribed') fail('MAILCHIMP_RECIPIENT', 'Mailchimp did not confirm exactly one subscribed recipient. Review the saved campaign.', 409)
}
export async function createMailchimpCampaign(conn: Connection, row: Row): Promise<Row> {
 const settings = sender(conn), email = address(row.email)
 if ((await mailchimpContact(conn, email))?.emailStatus !== 'subscribed') fail('MAILCHIMP_PREFERENCE', 'Mailchimp requires a confirmed subscription before sending.', 409)
 const segment = await request(conn, `${listPath(conn)}/segments`, 'POST', {name:`Coffer ${row.id}`,static_segment:[email]})
 if (!Number.isSafeInteger(segment?.id) || segment!.id <= 0 || segment!.type !== 'static' || segment!.member_count !== 1) fail('MAILCHIMP_RECIPIENT', 'Mailchimp did not confirm a one-recipient static segment.', 502)
 const revisionId = String(segment!.id)
 await verifyRecipient(conn, revisionId, email)
 const campaign = await request(conn, '/campaigns', 'POST', {type:'regular',recipients:{list_id:connection(conn).list,segment_opts:{saved_segment_id:segment!.id}},settings:{...settings,title:`Coffer ${row.id}`,subject_line:row.subject},tracking:{opens:false,html_clicks:false,text_clicks:false}})
 part(campaign?.id)
 return {campaignId:campaign!.id,revisionId}
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export async function composeMailchimpCampaign(conn: Connection, row: Row, draft: Row): Promise<void> {
 const settings = sender(conn), path = `/campaigns/${part(draft.campaignId)}`
 const saved = await request(conn, path)
 const recipients = saved?.recipients, segment = recipients?.segment_opts
 if (saved?.status !== 'save' || saved.type !== 'regular' || recipients?.list_id !== connection(conn).list || recipients.recipient_count !== 1 || String(segment?.saved_segment_id) !== draft.revisionId || segment.prebuilt_segment_id || segment.conditions?.length) fail('MAILCHIMP_CAMPAIGN', 'The saved Mailchimp campaign changed. Review it before sending.', 409)
 if (typeof row.subject !== 'string' || !row.subject.trim() || /[\r\n]/.test(row.subject) || typeof row.body !== 'string' || !row.body.trim()) fail('MAILCHIMP_CONTENT', 'Mailchimp needs a subject and message body.', 400)
 const html = row.body.split(/\n\s*\n/).map((p: string) => `<p>${escape(p).replaceAll('\n','<br>')}</p>`).join('')
 const footer = '<hr><p>*|LIST:DESCRIPTION|*</p><p>*|HTML:LIST_ADDRESS_HTML|*</p><p><a href="*|UNSUB|*">Unsubscribe</a> · <a href="*|UPDATE_PROFILE|*">Update your preferences</a></p>*|IF:REWARDS|* *|HTML:REWARDS|* *|END:IF|*'
 await request(conn, path, 'PATCH', {settings:{...settings,subject_line:row.subject}})
 await request(conn, `${path}/content`, 'PUT', {html:html+footer,plain_text:`${row.body}\n\n*|LIST:DESCRIPTION|*\n*|LIST:ADDRESS|*\nUnsubscribe: *|UNSUB|*\nUpdate your preferences: *|UPDATE_PROFILE|*\n*|IF:REWARDS|* *|REWARDS|* *|END:IF|*`})
 await verifyRecipient(conn, draft.revisionId, row.email)
 // A single send action. The caller persists the draft and owns the send claim;
 // timeout/refusal is uncertain and must never trigger an automatic resend.
 await request(conn, `${path}/actions/send`, 'POST')
}
export async function mailchimpResults(conn: Connection, row: Row): Promise<Row> {
 const campaignId = part(row.campaign_id)
 const campaign = await request(conn, `/campaigns/${campaignId}`)
 if (campaign?.status !== 'sent') return {rows:[],state:campaign?.status??'unknown'}
 const report = await request(conn, `/reports/${campaignId}/sent-to?count=2`)
 if (!Array.isArray(report?.sent_to) || !Number.isSafeInteger(report.total_items) || report.total_items > 1 || report.sent_to.length !== report.total_items) fail('MAILCHIMP_RESPONSE', 'Mailchimp did not confirm the campaign recipient results.', 502)
 return {state:campaign.status,rows:report.sent_to.map((recipient: Row) => {
  if (typeof recipient.email_address !== 'string' || !['sent','hard','soft'].includes(recipient.status)) fail('MAILCHIMP_RESPONSE', 'Mailchimp returned an unknown send result.', 502)
  return {destination:address(recipient.email_address),disposition:recipient.status === 'sent' ? 'sent' : 'bounced'}
 })}
}
