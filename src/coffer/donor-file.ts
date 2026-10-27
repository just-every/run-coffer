import { all, choice, commit, date, event, fail, one, today, type Context, type Row } from './db'
import { manager } from './auth'
import { settings } from './settings'

/** DATA-003: one donor's own file, produced on their request.
 *
 * The file is built from the live schema, not a hand-kept list: every product
 * table with a donor reference joins it, and every table reached from one of
 * the donor's own records (gifts, pledges, prospects, grants, property, letters,
 * subscriptions, drafts, series and soft credits) follows. A later table that
 * names a donor or one of those records therefore joins the file when it ships.
 * Other people never appear: any donor, gift or record reference outside this
 * donor's own records becomes an opaque counterpart label. Confidential staff
 * notes (owner and admins only) never leave Coffer this way: the file leaves
 * them out and states how many were withheld. */

const DONOR_COLUMNS: Record<string, string[]> = {
 cf_donors: ['id'], cf_donor_merges: ['donor_id', 'into_id'], cf_donor_merge_journal: ['source_id', 'target_id'], cf_move_in_records: ['donor_id', 'related_id'],
}
// A column naming a parent record, and the table whose `id` it names.
const PARENTS: Record<string, string> = {
 intent_id:'cf_giving_intents', gift_id: 'cf_gifts', received_gift_id: 'cf_gifts', first_gift_id: 'cf_gifts', reverses: 'cf_gifts', pledge_id: 'cf_pledges', prospect_id: 'cf_prospects',
 in_kind_id: 'cf_in_kind_gifts', grant_id: 'cf_grants', subscription_id: 'cf_subscriptions', installment_id: 'cf_pledge_installments',
 communication_id: 'cf_communications', letter_id: 'cf_acks', series_id: 'cf_recurring_task_series', soft_credit_id: 'cf_soft_credits',
 draft_id: 'cf_stewardship_drafts', intention_id: 'cf_planned_gifts', charge_id: 'cf_stripe_charges', merge_id: 'cf_donor_merge_journal',
}
// Rows that reach a donor but are not records about them.
export const NOT_IN_FILE: Record<string, string> = {
 cf_auction_jobs: 'Complete source files contain other bidders and stay private.',
 cf_auction_donors: 'Internal undo snapshots contain complete imported contact records.',
 cf_development_report_donors: 'Internal board reports combine several constituents and their source facts remain available in their own records.',
 cf_hygiene_evidence: 'Private forwarded source evidence is withheld from donor files.',
 cf_hygiene_proposals: 'Internal review proposals can contain counterpart data and are withheld from donor files.',
 cf_task_notices: 'Internal staff reminders do not form part of a donor data request.',
 cf_development_followups: 'Internal commitment follow-up notes and approvals are withheld; native source records remain included.',
 cf_development_reminders: 'Internal reminder approval and staff recipient details are withheld.',
 cf_donor_tokens: 'Hashed one-time access tokens are credentials, not records about the donor.',
 cf_erased_stripe_customers: 'Only erased placeholders appear here.',
}
// Contact details of a third party the donor named (a tribute's notified person).
const THIRD_PARTY: Record<string, string[]> = { cf_gift_tributes: ['notified_name', 'notified_email', 'notified_address'], cf_giving_tributes:['notified_name','notified_email','notified_address'], cf_tribute_notifications:['recipient_name','recipient_email','recipient_address','body','contact_snapshot'] }
const LABELS: Record<string, string> = {
 event_registrations: 'Event registrations and recorded check-ins. A registration without a check-in is not attendance.',
 research_results: 'WealthEngine estimates from prospect research: provider ranges, never verified wealth or an exact appraisal.',
 donor_notes: 'Staff notes about this donor. Confidential staff notes are withheld from this file; `withheld` states how many.',
 donor_merge_rows: 'Earlier versions of this donor’s own contact record kept to undo a merge.',
}
export const REQUEST_METHODS: [string, string][] = [['email', 'Email'], ['letter', 'Letter'], ['phone', 'Phone'], ['in_person', 'In person'], ['other', 'Other']]
const METHODS = REQUEST_METHODS.map(([v]) => v)

type Table = { name: string; columns: string[]; donors: string[]; parents: string[] }

async function schema(c: Context): Promise<Table[]> {
 const names = (await all<{ name: string }>(c, "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'cf_*' ORDER BY name")).map(r => r.name)
 const infos = await c.db.batch(names.map(name => c.db.prepare(`PRAGMA table_info(${name})`)))
 return names.map((name, i) => {
  const columns = (infos[i].results as Row[]).map(r => String(r.name))
  return { name, columns, donors: DONOR_COLUMNS[name] ?? columns.filter(k => k === 'donor_id' || k.endsWith('_donor_id')), parents: columns.filter(k => PARENTS[k] && PARENTS[k] !== name) }
 })
}

/** The request's subject: a live, unmerged donor plus the records merged into them. */
async function subject(c: Context, donorId: string) {
 const donor = await one(c, 'SELECT id,erased_at FROM cf_donors WHERE id=?', donorId)
 if (!donor) fail('NOT_FOUND', 'That donor does not exist.', 404)
 if (donor.erased_at) fail('DONOR_ERASED', 'This donor was erased; Coffer holds no personal data for them.', 409)
 const merged = await one(c, 'SELECT into_id FROM cf_donor_merges WHERE donor_id=?', donorId)
 if (merged) fail('DONOR_MERGED', 'This record was merged into another donor. Produce the surviving donor’s file.', 409, { donorId: merged.into_id })
 return [donorId, ...(await all<{ donor_id: string }>(c, 'SELECT donor_id FROM cf_donor_merges WHERE into_id=?', donorId)).map(r => r.donor_id)]
}

export const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:#/-]{0,79}$/

export function requestInput(p: Row, timeZone: string, now: Date) {
 const requestedOn = date(p.requestedOn, 'Request date')
 if (requestedOn > today(timeZone, now)) fail('INPUT', 'The request date cannot be in the future.', 400)
 const method = choice(p.method, METHODS, 'request method')
 const reference = String(p.reference ?? '').trim()
 // The permanent audit row holds no free personal text: a reference is a ticket or letter number.
 if (reference && !REFERENCE.test(reference)) fail('INPUT', 'Use a ticket or letter number (letters, digits and . _ : # / -) as the reference, not names or notes.', 400)
 return { requestedOn, method, reference: reference || null }
}

/** Owner or admin only. Reads, then logs the request with the file's counts;
 * the file is returned to staff to review and send, never sent by Coffer. */
export async function donorFile(c: Context, donorId: string, input: Row) {
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin produces a donor’s data file.', 403)
 const s = await settings(c), request = requestInput(input, s.timezone, new Date(c.now))
 const ids = await subject(c, donorId), tables = await schema(c)
 const own = new Map<string, Set<string>>([['cf_donors', new Set(ids)]]), rows = new Map<string, Row[]>()
 // Parents first: repeat until no table gains rows. Each pass is one D1 batch.
 for (let changed = true, pass = 0; changed && pass < 8; pass++) {
  changed = false
  const reads: { t: Table; sql: string; params: string[] }[] = []
  for (const t of tables) {
   if (NOT_IN_FILE[t.name] || (!t.donors.length && !t.parents.length)) continue
   const terms: string[] = [], params: string[] = []
   for (const k of t.donors) { terms.push(`${k} IN (SELECT value FROM json_each(?))`); params.push(JSON.stringify(ids)) }
   for (const k of t.name==='cf_event_registrations'?[]:t.parents) { const p = own.get(PARENTS[k]); if (p?.size) { terms.push(`${k} IN (SELECT value FROM json_each(?))`); params.push(JSON.stringify([...p])) } }
   if (terms.length) reads.push({ t, sql: `SELECT * FROM ${t.name} WHERE ${terms.join(' OR ')}`, params })
  }
  const results = await c.db.batch(reads.map(r => c.db.prepare(r.sql).bind(...r.params)))
  reads.forEach(({ t }, i) => {
   const found = (results[i].results ?? []) as Row[]
   if (found.length === (rows.get(t.name)?.length ?? 0)) return
   rows.set(t.name, found); changed = true
   // A row is this donor's own when its donor reference is theirs, or, without one, when it hangs from their record.
   if (t.columns.includes('id')) own.set(t.name, new Set(found.filter(r => !t.donors.length || t.donors.some(k => ids.includes(r[k]))).map(r => String(r.id))))
  })
 }
 const mergeRows = rows.get('cf_donor_merge_rows')
 if (mergeRows) rows.set('cf_donor_merge_rows', mergeRows.filter(r => r.table_name === 'cf_donors' && ids.includes(JSON.parse(r.row_key)[0])))
 const counterparts = new Map<string, string>()
 const opaque = (value: unknown) => {
  const key = String(value)
  if (!counterparts.has(key)) counterparts.set(key, `counterpart-${counterparts.size + 1}`)
  return counterparts.get(key)
 }
 const ownsRef = (column: string, value: unknown) => value === null || value === undefined || value === '' || (own.get(PARENTS[column]) ?? new Set()).has(String(value))
 // Audit rows name records by id: any that is not one of this donor's own records becomes a counterpart.
 const mine = new Set([...own.values()].flatMap(set => [...set]))
 const foreign = (v: unknown) => typeof v === 'string' && v !== '' && !mine.has(v)
 const cleanDetail = (value: any): any => Array.isArray(value) ? value.map(cleanDetail) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /ids?$/i.test(k) && k !== 'fileId' ? (Array.isArray(v) ? v.map(x => foreign(x) ? opaque(x) : x) : foreign(v) ? opaque(v) : v) : cleanDetail(v)])) : value
 // Withheld after the walk, so their ids stay this donor's own and are never shown as a counterpart.
 const notes = rows.get('cf_donor_notes') ?? [], confidentialNotes = notes.filter(n => n.confidential === 1).length
 rows.set('cf_donor_notes', notes.filter(n => n.confidential !== 1))
 const privateNotes=new Set(notes.filter(n=>n.confidential===1).map(n=>n.id))
 for(const table of ['cf_custom_values','cf_custom_value_history'])rows.set(table,(rows.get(table)??[]).filter(value=>!privateNotes.has(value.record_id)))
 rows.set('cf_events',(rows.get('cf_events')??[]).filter(row=>row.subject_kind!=='custom_value'||!privateNotes.has(row.subject_id)))
 rows.set('cf_move_in_records',(rows.get('cf_move_in_records')??[]).filter(row=>row.kind!=='customValue'||!privateNotes.has(row.native_id)))
 const records: Record<string, Row[]> = {}
 for (const t of tables) {
  const found = rows.get(t.name); if (!found?.length) continue
  records[t.name.slice(3)] = found.map(r => {
   const out: Row = { ...r }
   if(t.name==='cf_auction_rows')for(const key of ['candidates','match_reason','gift_snapshot','property_snapshot','bidder_key','planned_donor_id'])delete out[key]
   if(out.name_fields){const names=JSON.parse(out.name_fields);if(names._attention&&!ids.includes(names._attention)){out.name_fields='[third party withheld]';if(t.name==='cf_communications'){out.subject='[third party withheld]';out.body='[third party withheld]'}if(t.name==='cf_appeal_recipients'){out.merge_fields='[third party withheld]';out.rendered_subject='[third party withheld]';out.rendered_body='[third party withheld]'}}}
   if(t.name==='cf_acks'||t.name==='cf_single_letters'||t.name==='cf_in_kind_acknowledgments') {
    const key=t.name==='cf_acks'||t.name==='cf_single_letters'?'address':'recipient_address'
    const address=out[key]?JSON.parse(out[key]):null
    if(address?.attentionDonorId&&!ids.includes(address.attentionDonorId)) {
     out[key]=JSON.stringify({...address,attention:'[third party withheld]',attentionDonorId:opaque(address.attentionDonorId),salutation:'[third party withheld]'})
     out.recipient_name='[third party withheld]';out.body='[third party withheld]'
    }
   }
   for (const k of t.donors) if (out[k] !== null && !ids.includes(out[k])) out[k] = opaque(out[k])
   for (const k of t.parents) if (!ownsRef(k, out[k])) out[k] = opaque(out[k])
   for (const k of THIRD_PARTY[t.name] ?? []) if (out[k] !== null) out[k] = '[third party withheld]'
   if (t.name.endsWith('events') && out.subject_kind !== 'route' && foreign(out.subject_id)) out.subject_id = opaque(out.subject_id)
   if (t.name.endsWith('events') && typeof out.detail === 'string') { try { out.detail = cleanDetail(JSON.parse(out.detail)) } catch { /* keep text */ } }
   return out
  })
 }
 const households = await all(c, 'SELECT id,name,created_at FROM cf_households WHERE id IN (SELECT household_id FROM cf_donors WHERE id IN (SELECT value FROM json_each(?)))', JSON.stringify(ids))
 if (households.length) records.households = households
 const docs=records.record_documents??[]
 for(const doc of docs){
  const object=await c.env!.FILES.get(doc.object_key)
  if(!object)fail('DOCUMENT_MISSING','A document file is missing. Restore the complete file before producing this donor’s data.',409)
  const bytes=new Uint8Array(await object.arrayBuffer());let binary=''
  for(const byte of bytes)binary+=String.fromCharCode(byte)
  doc.content_base64=btoa(binary)
 }
 const counts = Object.fromEntries(Object.entries(records).map(([k, v]) => [k, v.length]))
 const fileId = crypto.randomUUID()
 // Identifiers, date, method, counts and reference only; no names or note text.
 await commit(c, [event(c, 'donor.dataRequest', 'donor', donorId, donorId, { fileId, ...request, records: counts, confidentialNotesWithheld: confidentialNotes })])
 return {
  format: 'coffer.donor-file', version: 1, fileId, donorId, mergedRecordIds: ids.slice(1), generatedAt: c.now,
  generatedBy: { id: c.actor.id, role: c.actor.role }, request,
  delivery: 'Produced for staff to review and give to the donor. Coffer has not sent this file to anyone.',
  counterparts: 'Other donors and their records appear only as opaque counterpart labels; their names, contact details and gifts are not in this file.',
  labels: Object.fromEntries(Object.entries(LABELS).filter(([k]) => records[k])),
  withheld: { confidentialStaffNotes: confidentialNotes, statement: `${confidentialNotes} confidential staff notes withheld` },
  notIncluded: Object.entries(NOT_IN_FILE).map(([table, reason]) => ({ record: table.slice(3), reason })),
  records,
 }
}
