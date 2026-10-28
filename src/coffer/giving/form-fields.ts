import { customValue } from '../custom-fields'
import { fail, guard, integer, object, one, optional, sql, type Row, type Stmt } from '../db'
import { getGivingForm, type GivingForm } from './form-configuration'

export type GivingFormSnapshot = { form: GivingForm; fund: string; employer: string | null; comment: string | null; answers: { key: string; value: string }[] }

function readAnswers(p: Row): Row {
 const entries = Object.entries(p).filter(([key])=>key.startsWith('answer.'))
 if (p.answers !== undefined && entries.length) fail('INPUT','Provide custom answers once.',400)
 return p.answers === undefined ? Object.fromEntries(entries.map(([key,value])=>[key.slice(7),value])) : object(p.answers,'Custom answers')
}
function capture(form: GivingForm, p: Row): GivingFormSnapshot {
 const version = integer(Number(p.formVersion??0),'Form version',0)
 if (version !== form.version) fail('form_changed','This giving form changed. Reload before giving.',409)
 const fund = optional(p.designation,'Designation',100) ?? form.designations[0]
 if (!form.designations.includes(fund)) fail('INPUT','Choose an available fund designation.',400)
 const employer = optional(p.employer,'Employer',200), comment = optional(p.comment,'Gift comment',2000)
 if (employer && !form.employerEnabled || comment && !form.commentEnabled) fail('INPUT','That field is not available on this giving form.',400)
 const input = readAnswers(p), allowed = new Set(form.questions.map(q=>q.key))
 if (Object.keys(input).some(key=>!allowed.has(key))) fail('INPUT','Only answer questions on this giving form.',400)
 const answers: GivingFormSnapshot['answers'] = []
 for (const q of form.questions) {
  const v = Object.hasOwn(input,q.key) ? input[q.key] : undefined, empty = v === undefined || v === null || v === '' || Array.isArray(v) && !v.length
  if (empty) { if (q.required) fail('INPUT','Answer '+q.label+'.',400); continue }
  let value = v
  // Native checkbox and select controls submit scalar strings. Multi-select answers
  // use repeated answer.<key> names, collected as arrays by the public route.
  if (q.entry === 'pick-many' && typeof value === 'string') value = [value]
  answers.push({key:q.key,value:customValue({...q,choices:JSON.stringify(q.choices)},value)})
 }
 return {form,fund,employer,comment,answers}
}

/** Append these statements after the parent intent insert, in the same batch.
 * Saved captures are the only source for paid answers; caller copies are never
 * trusted on replay. A field or configuration edit during checkout aborts the batch. */
export async function prepareGivingForm(db: D1Database, campaign: Row, p: Row, prior?: Row | null): Promise<{ fund: string; snapshot: GivingFormSnapshot; statements: Stmt[] }> {
 const id = p.requestId
 const saved = await one({db},'SELECT * FROM cf_giving_form_intents WHERE intent_id=?',id)
 if (await one({db},'SELECT intent_id FROM cf_giving_form_redactions WHERE intent_id=?',id)) fail('donor_unavailable','This checkout is no longer available.',409)
 if (saved && saved.campaign_id !== campaign.id) fail('checkout_changed','Reload before changing the campaign.',409)
 if (prior && !saved) fail('checkout_changed','Reload the giving form to start a new checkout.',409)
 const previous: GivingFormSnapshot | null = saved ? JSON.parse(saved.snapshot) : null
 const form = previous?.form ?? await getGivingForm({db},campaign)
 // The campaign fund stays the default regardless of picker order.
 if (!previous) form.designations = [campaign.fund,...form.designations.filter(f=>f!==campaign.fund)]
 const snapshot = capture(form,p), payload = JSON.stringify(snapshot)
 if (saved && saved.snapshot !== payload) fail('checkout_changed','Reload before changing the answers or designation for this gift.',409)
 const statements: Stmt[] = [
  guard('NOT EXISTS(SELECT 1 FROM cf_giving_form_redactions WHERE intent_id=?)','ERASED','This checkout is no longer available.',id),
  guard('EXISTS(SELECT 1 FROM cf_giving_intents i WHERE i.id=? AND i.campaign_id=? AND (i.donor_id IS NULL OR EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=i.donor_id AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))))','DONOR_CHANGED','The checkout identity changed.',id,campaign.id),
  ...(!saved?[
   guard('COALESCE((SELECT version FROM cf_giving_forms WHERE campaign_id=?),0)=?','FORM_CHANGED','The giving form changed. Reload before giving.',campaign.id,form.version),
   guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND fund=?)','FORM_CHANGED','The campaign changed. Reload before giving.',campaign.id,campaign.fund),
   ...form.questions.map(q=>guard('EXISTS(SELECT 1 FROM cf_custom_fields WHERE key=? AND version=?)','FIELD_CHANGED','A question changed. Reload before giving.',q.key,q.version)),
  ]:[]),
  sql('INSERT OR IGNORE INTO cf_giving_form_intents(intent_id,campaign_id,form_version,fund,snapshot) VALUES(?,?,?,?,?)',id,campaign.id,form.version,snapshot.fund,payload),
  guard('EXISTS(SELECT 1 FROM cf_giving_form_intents WHERE intent_id=? AND snapshot=?)','CHECKOUT_CHANGED','This checkout’s answers changed.',id,payload),
 ]
 return {fund:snapshot.fund,snapshot,statements}
}

/** Contact history is read before native erasure removes it. Abandoned captures
 * have no donor reference, so follow every known email and retain opaque fences. */
export function givingFormErasureStatements(donorId: string, emails: string[]): Stmt[] {
 return [
  sql(`INSERT OR IGNORE INTO cf_giving_form_redactions SELECT id FROM cf_giving_intents
   WHERE donor_id=? OR lower(email) IN (SELECT lower(value) FROM json_each(?))`,donorId,JSON.stringify(emails)),
  sql('INSERT OR IGNORE INTO cf_giving_form_redactions SELECT intent_id FROM cf_giving_form_gifts WHERE gift_id IN (SELECT id FROM cf_gifts WHERE donor_id=?)',donorId),
  sql('DELETE FROM cf_giving_form_gifts WHERE intent_id IN (SELECT intent_id FROM cf_giving_form_redactions)'),
  sql('DELETE FROM cf_giving_form_intents WHERE intent_id IN (SELECT intent_id FROM cf_giving_form_redactions)'),
 ]
}
