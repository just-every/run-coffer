import { communicationReasons } from './communications/preference-rules'
import { customAllowed } from './custom-fields'
import { recipientMergeFields, renderTemplate, templateTokens } from './template-fields'
import { LETTER, checkTemplate, longDate } from './settings'
import { mailContactRows } from './mail-contacts'
import { appealPieces, householdPieceGuard, prepareAppealPieces } from './mail-pieces'
import { listMembers } from './list-members'
import { mailPreflight, mailEligibility, mailSnapshot, mailRunGuards, mailAddressChanged } from './addresses/mail'
import { deliberateInclusionGuards, solicitationReasons, solicitationState, prepareSolicitationRun, solicitationRunGuards, solicitationAskStatements } from './solicitation'
import { frozenNameFields } from './person-names'
import { letterRecipient } from './organizations'
import { all, choice, commit, date, event, fail, guard, id, integer, newId, one, sha256, sql, text, today, longText, type Context, type Row } from './db'
import { amount } from './money'
import { settings } from './settings'
import { csv } from './csv'
import { appealResults } from './appeal-results'
import { annualLapses } from './annual-lapses'
import { countReason } from './status'

const MAX_RECIPIENTS = 10000
const CONSENT = `(SELECT k.id FROM cf_consents k WHERE k.donor_id=r.donor_id AND k.channel=? ORDER BY k.id DESC LIMIT 1)`
// Every frozen recipient still has the exact consent answer that admitted them.
const CHANGED = `(${CONSENT} IS NOT r.consent_id OR (SELECT constituent_status FROM cf_donors WHERE id=r.donor_id)<>'active' OR (r.email_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_contact_points p WHERE p.id=r.email_contact_id AND p.donor_id=r.donor_id AND p.kind='email' AND p.active=1 AND p.version=r.email_contact_version AND p.value=r.email)))`
const UNCHANGED = `NOT EXISTS(SELECT 1 FROM cf_appeal_recipients r WHERE r.appeal_id=? AND ${CHANGED})`
export const hashOf = (name: string, channel: string, recipients: Row[], message?: Row | null,pieces?:Row[]) => sha256(JSON.stringify([name, channel, recipients.map(r => [r.donor_id, r.consent_id, r.name, r.email, r.address, ...(r.name_fields ? [r.name_fields] : []),...(r.email_contact_id?[r.email_contact_id,r.email_contact_version]:[]),...(r.merge_fields?[r.merge_fields,r.merge_blanks,r.rendered_subject,r.rendered_body]:[]), ...(message ? [r.total_cents,r.gift_count,r.last_gift] : [])]), ...(message ? [message.subject,message.body] : []),...(pieces?.length?[pieces.map(p=>[p.id,p.name,p.address,p.names,p.members,p.household_id,p.household_version,p.snapshot,...(p.response_code?[p.response_code,p.ask_cents]:[])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]:[])]))
const postal = (d: Row) => d.address_line1 && d.city && d.postal_code

/** Splits the segment into consenting recipients and counted exclusions. */
export async function audience(c: { db: D1Database; now?:string }, channel: 'email' | 'mail', segment: { givenSince: string | null; minTotalCents: number; fund?: string | null; donorIds?: string[]; isAsk?: boolean; includeIds?: string[];addressType?:string;emailType?:string }) {
 const rawRows = await all(c, `SELECT d.*,k.id AS consent_id,k.status AS consent,
  (SELECT COALESCE(SUM(amount_cents),0) FROM cf_monetary_contributions g WHERE g.donor_id=d.id) AS total_cents,
  (SELECT COUNT(*) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS gift_count,
  (SELECT MAX(received_on) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS last_gift FROM cf_donors d
  LEFT JOIN cf_consents k ON k.id=(SELECT id FROM cf_consents WHERE donor_id=d.id AND channel=? ORDER BY id DESC LIMIT 1)
  WHERE d.erased_at IS NULL AND (? IS NULL OR (SELECT COALESCE(SUM(amount_cents),0) FROM cf_gifts g WHERE g.donor_id=d.id AND g.received_on>=?)>=?)
  AND (? IS NULL OR EXISTS(SELECT 1 FROM cf_fund_ledger g WHERE g.donor_id=d.id AND g.fund=? GROUP BY g.fund HAVING SUM(g.amount_cents)>0))
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
  ORDER BY lower(d.name),d.id`, channel, segment.givenSince, segment.givenSince, Math.max(1, segment.minTotalCents), segment.fund??null,segment.fund??null)
 const rows=await mailContactRows(c,rawRows,{addressType:segment.addressType,emailType:segment.emailType})
 const excluded: Record<string, number> = { 'no consent recorded': 0, 'consent withdrawn': 0, 'no email address': 0, 'no postal address': 0 }
 const sharedEmails=new Set<string>()
 const recipients: Row[] = [], lastAskDates:Record<string,number> = {}
 const addressHolds=channel==='mail'?await mailEligibility(c,rows):new Map()
 const donorIds=segment.donorIds?new Set(segment.donorIds):null,includeIds=new Set(segment.includeIds??[])
 const preferences=await communicationReasons(c,rows.filter(d=>!donorIds||donorIds.has(d.id)).map(d=>d.id),channel,segment.isAsk===false?'newsletter':'appeals')
 const reasons=segment.isAsk===false?new Map():await solicitationReasons(c,rows.filter(d=>!donorIds||donorIds.has(d.id)).map(d=>d.id),channel,c.now)
 for (const d of rows) {
  if (donorIds && !donorIds.has(d.id)) continue
  const restricted=reasons.get(d.id)
  if (d.constituent_status !== 'active') countReason(excluded, d.constituent_status)
  else if (restricted&&!includeIds.has(d.id)) {countReason(excluded,restricted.reason);if(restricted.reason==='solicitation limit'&&restricted.lastAskOn)countReason(lastAskDates,restricted.lastAskOn)}
  else if(preferences.get(d.id))countReason(excluded,preferences.get(d.id)!)
  else if (!d.consent) excluded['no consent recorded']++
  else if (d.consent !== 'granted') excluded['consent withdrawn']++
  else if (channel === 'email' && !d.email) excluded['no email address']++
  else if (channel === 'mail' && !postal(d)) excluded['no postal address']++
  else if (channel === 'mail' && addressHolds.has(d.id)) countReason(excluded,addressHolds.get(d.id).reason)
  else if(channel==='email'&&sharedEmails.has(String(d.email).toLowerCase()))countReason(excluded,'shared email duplicate')
  else {if(channel==='email')sharedEmails.add(String(d.email).toLowerCase());recipients.push({ donor_id: d.id,donor_version:d.version, consent_id: d.consent_id, name: d.name, name_fields:frozenNameFields(await letterRecipient(c,d,{emailType:channel==='email'?segment.emailType:undefined})), total_cents:d.total_cents,gift_count:d.gift_count,last_gift:d.last_gift, email: channel === 'email' ? d.email : null,email_contact_id:channel==='email'?d.selected_email_contact_id:null,email_contact_version:channel==='email'?d.selected_email_contact_version:null, address: channel === 'mail' ? JSON.stringify({ line1: d.address_line1, line2: d.address_line2, city: d.city, region: d.region, postalCode: d.postal_code, country: d.country,addressContactId:d.selected_address_contact_id,addressContactVersion:d.selected_address_contact_version }) : null })}
 }
 return { recipients, excluded, lastAskDates }
}

export async function appealCommand(c: Context, command: string, p: Row, selection?: {donorIds:string[];resendOf:string}): Promise<Row | undefined> {
 if (command === 'appeal.prepare') {
  const purpose=choice(p.purpose??'appeal',['appeal','newsletter'] as const,'run purpose'),isAsk=purpose==='appeal'
  const includes: {donorId:string;reason:string}[] = p.includeDonorId ? [{donorId:id(p.includeDonorId,'Included donor'),reason:text(p.includeReason,'Reason for including this donor',1000)}] : Array.isArray(p.includes)?p.includes.map((x:Row)=>({donorId:id(x.donorId,'Included donor'),reason:text(x.reason,'Reason for including this donor',1000)})):[]
  if(c.actor.role==='member'&&!includes.length)fail('FORBIDDEN','Prepare a one-run inclusion from an assigned donor record.',403)
  await deliberateInclusionGuards(c,includes.map(x=>x.donorId))
  const name = text(p.name, 'Appeal name', 200), channel = choice(p.channel, ['email', 'mail'] as const, 'channel')
  if(p.emailType)choice(p.emailType,['personal','work','other'],'email contact type')
  const givenSince = p.givenSince ? date(p.givenSince, 'Gave since') : null
  const minTotalCents = givenSince && (p.minTotal || p.minTotalCents) ? amount(p, 'minTotal', 'Minimum given') : 0
  if (givenSince && givenSince > today((await settings(c)).timezone)) fail('INPUT', 'Gave since cannot be in the future.', 400)
  const fund = p.fund ? text(p.fund,'Fund',100) : null
  const annualList = p.annualList ? choice(p.annualList, ['lybunt','sybunt'] as const, 'annual giving list') : null
  const annual = annualList ? await annualLapses(c, p.listYear ? Number(p.listYear) : undefined) : null
  const saved=p.listId?await listMembers(c,id(p.listId,'Saved list')):null
  const donorIds = saved?.ids ?? annual?.groups.find(g=>g.kind===annualList)!.rows.map(r=>r.donorId)
  const written = channel === 'email' && Boolean(String(p.subject ?? '').trim() || String(p.body ?? '').trim())
 if (written && !String(p.subject ?? '').trim()) fail('INPUT', 'Add an email subject. Donors see it in their inbox before they open the appeal.', 400)
 if (written && !String(p.body ?? '').trim()) fail('INPUT', 'Write the email message donors will receive, or clear the subject to export the list instead.', 400)
 const message = written ? {subject:text(p.subject,'Email subject',250),body:longText(p.body,'Email message',12000)} : null
  if(message){const fields=await customAllowed(c,[...LETTER,'last_gift']);checkTemplate(message.subject,'Appeal subject',fields,[]);checkTemplate(message.body,'Appeal message',fields,[])}
  if(message&&templateTokens(message.subject+'\n'+message.body).some(t=>t.field.startsWith('custom.'))&&!['owner','admin'].includes(c.actor.role))fail('FORBIDDEN','Only an owner or admin chooses custom-data fields for a new appeal. Use an owner-reviewed template door for approved custom wording.',403)
  const addressPass=channel==='mail'?await mailPreflight(c,p.addressType||''):null
  const { recipients, excluded, lastAskDates } = await audience(c, channel, { givenSince, minTotalCents, fund, donorIds: c.actor.role==='member'?includes.map(x=>x.donorId):selection?.donorIds ?? donorIds, isAsk,addressType:p.addressType||'',emailType:channel==='email'?p.emailType||'':undefined, includeIds:includes.map(x=>x.donorId) })
  if (!recipients.length) fail('NO_RECIPIENTS', 'No donor in this segment has current consent for this channel.', 409, excluded)
  if (recipients.length > MAX_RECIPIENTS) fail('TOO_MANY', `An appeal holds at most ${MAX_RECIPIENTS} recipients. Narrow the segment.`, 400)
  if(message){const s=await settings(c),used=[...new Set(templateTokens(message.subject+'\n'+message.body).map(t=>t.field))];for(const r of recipients){const d=await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL',r.donor_id);if(!d)fail('DONOR_CHANGED','A recipient changed. Prepare again.',409);const recipient=await letterRecipient(c,d,{emailType:p.emailType||undefined}),fields:Record<string,string>={...recipientMergeFields(recipient),date:longDate(today(s.timezone,new Date(c.now))),donor_name:recipient.letter_salutation??d.name,organization:s.organisation,ein:s.ein,last_gift:r.last_gift||'No gift recorded'},selected=Object.fromEntries(used.map(key=>[key,fields[key]??''])),rendered=renderTemplate(message,selected);Object.assign(r,{merge_fields:JSON.stringify(selected),merge_blanks:rendered.merge_blanks,rendered_subject:rendered.subject,rendered_body:rendered.body})}}
  const appealId = newId(), code = 'RUN-' + appealId, costCents = p.cost || p.costCents ? amount(p, 'cost', 'Appeal cost', {allowZero:true}) : 0, grouping=channel==='mail'?await prepareAppealPieces(c,appealId,recipients,p.onePiecePer,{addressType:p.addressType||'',isAsk}):null, hash = await hashOf(name, channel, recipients,message,grouping?.pieces), list = JSON.stringify(recipients)
  if(grouping&&!grouping.pieces.length)fail('NO_GIFTS','No positive-balance gifts were found for gift-based mail pieces. Choose constituent or household pieces.',409)
  const addressSnapshot=await mailSnapshot(c,appealId,addressPass,recipients)
  const restriction=await prepareSolicitationRun(c,{kind:'appeal',id:appealId,channel,isAsk,donorIds:recipients.map(r=>r.donor_id),includes})
  await commit(c, [...(saved?.guards??[]),...restriction.statements,
   ...(selection?[guard("NOT EXISTS(SELECT 1 FROM cf_appeals WHERE json_extract(segment,'$.resendOf')=? AND status<>'discarded')",'RESEND_EXISTS','A resend was prepared concurrently. Refresh to review it.',selection.resendOf)]:[]),
   guard(`NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE (SELECT k.id FROM cf_consents k WHERE k.donor_id=json_extract(j.value,'$.donor_id') AND k.channel=? ORDER BY k.id DESC LIMIT 1) IS NOT json_extract(j.value,'$.consent_id'))`, 'CONSENT_CHANGED', 'A donor’s consent changed while preparing. Prepare again.', list, channel),
   guard(`NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=json_extract(j.value,'$.donor_id') AND d.version=json_extract(j.value,'$.donor_version') AND d.erased_at IS NULL))`,'DONOR_CHANGED','A recipient changed during preparation. Prepare again.',list),
   guard(`NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$.email_contact_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_contact_points p WHERE p.id=json_extract(j.value,'$.email_contact_id') AND p.donor_id=json_extract(j.value,'$.donor_id') AND p.active=1 AND p.kind='email' AND p.version=json_extract(j.value,'$.email_contact_version') AND p.value=json_extract(j.value,'$.email')))`,'CONTACT_CHANGED','An email contact changed. Prepare the audience again.',list),
   sql("INSERT INTO cf_appeal_codes(code,name,origin,created_at) VALUES(?,?,'staff',?)",code,name,c.now),
   sql("INSERT INTO cf_appeals(id,version,name,channel,segment,excluded,status,content_hash,recipients,prepared_by_id,prepared_by_name,prepared_by_role,prepared_at) VALUES(?,1,?,?,?,?,'prepared',?,?,?,?,?,?)",
    appealId, name, channel, JSON.stringify({ ...(p.emailType&&channel==='email'?{emailType:p.emailType}:{}),...(p.addressType?{addressType:p.addressType}:{}),...(grouping?{onePiecePer:grouping.basis,pieceCount:grouping.pieces.length,postagePerPieceCents:p.postagePerPiece?amount(p,'postagePerPiece','Postage per piece',{allowZero:true}):null}:{}),...(saved?{listId:p.listId}:{}),givenSince, minTotalCents, fund, purpose, isAsk, lastAskDates, ...(selection ? {resendOf:selection.resendOf} : {}), ...(annual ? {annualList,listYear:annual.year,listThrough:annual.through} : {}) }), JSON.stringify(excluded), hash, recipients.length, c.actor.id, c.actor.name, c.actor.role, c.now),
   sql('INSERT INTO cf_appeal_runs(appeal_id,code,cost_cents) VALUES(?,?,?)',appealId,code,costCents),
   sql(`INSERT INTO cf_appeal_recipients(appeal_id,donor_id,consent_id,name,email,address,total_cents,gift_count,last_gift,name_fields,email_contact_id,email_contact_version,merge_fields,merge_blanks,rendered_subject,rendered_body) SELECT ?,json_extract(value,'$.donor_id'),json_extract(value,'$.consent_id'),json_extract(value,'$.name'),json_extract(value,'$.email'),json_extract(value,'$.address'),json_extract(value,'$.total_cents'),json_extract(value,'$.gift_count'),json_extract(value,'$.last_gift'),json_extract(value,'$.name_fields'),json_extract(value,'$.email_contact_id'),json_extract(value,'$.email_contact_version'),json_extract(value,'$.merge_fields'),json_extract(value,'$.merge_blanks'),json_extract(value,'$.rendered_subject'),json_extract(value,'$.rendered_body') FROM json_each(?)`, appealId, list),
   ...addressSnapshot,...(grouping?.statements??[]),
   ...(message ? [sql('INSERT INTO cf_appeal_messages VALUES(?,?,?)',appealId,message.subject,message.body)] : []),
   event(c, 'appeal.prepare', 'appeal', appealId, null, { channel, recipients: recipients.length, excluded })])
  return { id: appealId, code, costCents, version: 1, recipients: recipients.length, ...(grouping?{pieceCount:grouping.pieces.length}:{}),excluded, contentHash: hash }
 }
 if (!['appeal.approve', 'appeal.discard', 'appeal.export', 'appeal.markSent'].includes(command)) return undefined
 const appealId = id(p.appealId, 'Appeal'), version = integer(typeof p.version === 'string' ? Number(p.version) : p.version, 'Version', 1)
 const appeal = await one(c, 'SELECT * FROM cf_appeals WHERE id=?', appealId)
 if (!appeal) fail('NOT_FOUND', 'That appeal does not exist.', 404)
 if (appeal.version !== version) fail('VERSION', 'This appeal changed. Refresh before continuing.')
 const at = (statuses: string[]) => guard(`EXISTS(SELECT 1 FROM cf_appeals WHERE id=? AND version=? AND status IN (${statuses.map(() => '?').join(',')}))`, 'VERSION', 'This appeal changed. Refresh before continuing.', appealId, version, ...statuses)
 const consent = guard(UNCHANGED, 'CONSENT_CHANGED', 'A recipient’s consent or status changed, or their record was erased, since this audience was prepared. Discard the appeal and prepare it again.', appealId, appeal.channel)
 const bump = (status: string, extra = '', ...params: unknown[]) => sql(`UPDATE cf_appeals SET version=version+1,status=?${extra} WHERE id=?`, status, ...params, appealId)
 if (command === 'appeal.approve') {
  if (appeal.status !== 'prepared') fail('NOT_PREPARED', 'Only a prepared appeal can be approved.')
  if (await hashOf(appeal.name, appeal.channel, await recipientsOf(c, appealId),await one(c,'SELECT * FROM cf_appeal_messages WHERE appeal_id=?',appealId),(await appealPieces(c,appealId))) !== appeal.content_hash) fail('CONTENT_CHANGED', 'This audience no longer matches what was prepared. Discard it and prepare again.')
  await commit(c, [at(['prepared']), consent,householdPieceGuard(appealId), ...await mailRunGuards(c,appealId), ...await solicitationRunGuards(c,'appeal',appealId),
   sql('INSERT INTO cf_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?)', newId(), 'appeal', appealId, appeal.content_hash, appeal.prepared_by_id, appeal.prepared_by_name, appeal.prepared_by_role, c.actor.id, c.actor.name, c.actor.role, c.now),
   bump('approved'), event(c, 'appeal.approve', 'appeal', appealId, null, { recipients: appeal.recipients, preparedBy: appeal.prepared_by_role })])
  return { id: appealId, version: version + 1, status: 'approved' }
 }
 if (command === 'appeal.discard') {
  if(await one(c,"SELECT id FROM cf_communications WHERE source_kind='appeal' AND source_id=? LIMIT 1",appealId)) fail('SUBMISSION_EXISTS','This appeal has saved Mango submissions. Keep its history and cancel any scheduled campaign in Mango.',409)
  if (!['prepared', 'approved'].includes(appeal.status)) fail('ALREADY_EXPORTED', 'An exported audience is kept; record the appeal as sent instead.')
  await commit(c, [at(['prepared', 'approved']), bump('discarded', ',discarded_at=?', c.now), event(c, 'appeal.discard', 'appeal', appealId, null)])
  return { id: appealId, version: version + 1, status: 'discarded' }
 }
 if (command === 'appeal.export') {
  if (!['approved', 'exported', 'sent'].includes(appeal.status)) fail('NOT_APPROVED', 'A person must approve this audience before it is exported.')
  if (appeal.status !== 'approved') return { id: appealId, version, status: appeal.status, exportHash: appeal.export_hash }
  const hash = await sha256(recipientsCsv(appeal, await recipientsOf(c, appealId),await appealPieces(c,appealId)))
  await commit(c, [at(['approved']), consent,householdPieceGuard(appealId), ...await mailRunGuards(c,appealId), ...await solicitationAskStatements(c,'appeal',appealId), bump('exported', ',export_hash=?,exported_at=?,exported_by=?', hash, c.now, c.actor.name), event(c, 'appeal.export', 'appeal', appealId, null, { recipients: appeal.recipients })])
  return { id: appealId, version: version + 1, status: 'exported', exportHash: hash }
 }
 const sentOn = date(p.sentOn, 'Sent on')
 if (appeal.status !== 'exported') fail('NOT_EXPORTED', 'Export the approved audience before recording the appeal as sent.')
 const timezone = (await settings(c)).timezone
 // The export date is the organization's calendar day, like Sent on itself.
 if (sentOn > today(timezone) || sentOn < today(timezone, new Date(appeal.exported_at))) fail('INPUT', 'Sent on must be between the export date and today.', 400)
 await commit(c, [at(['exported']), bump('sent', ',sent_on=?,sent_recorded_by=?', sentOn, c.actor.name), event(c, 'appeal.markSent', 'appeal', appealId, null, { sentOn })])
 return { id: appealId, version: version + 1, status: 'sent' }
}

export const recipientsOf = (c: { db: D1Database }, appealId: string) => all(c, `SELECT r.*,(SELECT id FROM cf_communications m WHERE m.message_key='appeal:'||r.appeal_id||':'||r.donor_id) AS communication_id FROM cf_appeal_recipients r WHERE appeal_id=? ORDER BY lower(name),donor_id`, appealId)
export function recipientsCsv(appeal: Row, recipients: Row[],pieces:Row[]=[]) {
 if(pieces.length)recipients=pieces.map(p=>({...p,name_fields:p.names}))
 if (appeal.channel === 'email') return csv(['name', 'email'], recipients.map(r => [r.name, r.email]))
 return csv(['name', 'informal_salutation', 'formal_salutation', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'country', 'ask_amount', 'response_code'], recipients.map(r => { const a = r.address ? JSON.parse(r.address) : {}; const n=r.name_fields?JSON.parse(r.name_fields):{}; return [n.envelope_name??r.name, n.informal_salutation??r.name, n.formal_salutation??r.name, a.line1, a.line2, a.city, a.region, a.postalCode, a.country,r.ask_cents==null?'':(r.ask_cents/100).toFixed(2),r.response_code??''] }))
}
export async function appeals(c: { db: D1Database }) {
 return all(c, "SELECT * FROM cf_appeals ORDER BY CASE status WHEN 'prepared' THEN 0 WHEN 'approved' THEN 1 WHEN 'exported' THEN 2 ELSE 3 END, prepared_at DESC LIMIT 100")
}
export async function appealDetail(c: { db: D1Database }, appealId: string) {
 const appeal = await one(c, 'SELECT * FROM cf_appeals WHERE id=?', appealId)
 if (!appeal) fail('NOT_FOUND', 'That appeal does not exist.', 404)
 const [recipients, approval, changed] = await Promise.all([recipientsOf(c, appealId), one(c, "SELECT * FROM cf_approvals WHERE subject_kind='appeal' AND subject_id=?", appealId),
  one<{ n: number }>(c, `SELECT count(*) AS n FROM cf_appeal_recipients r WHERE r.appeal_id=? AND ${CHANGED}`, appealId, appeal.channel)])
 const inclusions=await all(c,'SELECT * FROM cf_solicitation_inclusions WHERE kind=? AND run_id=?','appeal',appealId)
 let restrictionChanged=0
 if(JSON.parse(appeal.segment).isAsk!==false){
  const donorIds=recipients.map(r=>r.donor_id),[states,reasons,frozen,submitted]=await Promise.all([
   solicitationState(c,donorIds),solicitationReasons(c,donorIds,appeal.channel),all(c,'SELECT * FROM cf_solicitation_recipients WHERE kind=? AND run_id=?','appeal',appealId),all(c,'SELECT donor_id FROM cf_solicitation_asks WHERE kind=? AND run_id=?','appeal',appealId),
  ])
  const versions=new Map(frozen.map(r=>[r.donor_id,r.restriction_version])),asked=new Set(submitted.map(r=>r.donor_id)),exceptions=new Map(inclusions.map(r=>[r.donor_id,r.restriction_version]))
  restrictionChanged=states.filter(state=>{
   return versions.get(state.donor_id)!==state.scope_version||reasons.get(state.donor_id)&&!asked.has(state.donor_id)&&exceptions.get(state.donor_id)!==state.scope_version
  }).length
 }
 const pieces=await appealPieces(c,appealId)
 return { appeal, recipients,mergeReview:recipients.flatMap(r=>{const fields=JSON.parse(r.merge_blanks??'[]');return fields.length?[{donorId:r.donor_id,recipientName:r.name,fields}]:[]}), mailPieces:pieces,pieceCount:pieces.length||recipients.length,approval, addressChanged:await mailAddressChanged(c,appealId), restrictionChanged, inclusions, results: await appealResults(c,appealId), message:await one(c,'SELECT * FROM cf_appeal_messages WHERE appeal_id=?',appealId),messages:await all(c,"SELECT m.*,d.name FROM cf_communications m JOIN cf_donors d ON d.id=m.donor_id WHERE m.source_kind='appeal' AND m.source_id=? ORDER BY m.created_at",appealId), consentChanged: changed?.n ?? 0 }
}
