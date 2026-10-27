import { communicationReasons } from './preference-rules'
import { customAllowed, customMerge } from '../custom-fields'
import { LETTER, checkTemplate, longDate, goodsStatement } from '../settings'
import { recipientMergeFields, renderTemplate } from '../template-fields'
import { giftFacts } from '../merge-facts'
import { letterRecipient } from '../organizations'
import { usd } from '../money'
import { listMembers } from '../list-members'
import { prepareSolicitationRun, solicitationReason } from '../solicitation'
import { emailConnection } from './connection'
import type { Bindings } from '../../auth.server'
import { requireRole } from '../auth'
import { all, choice, commit, event, fail, guard, integer, longText, newId, one, sql, text, type Context, type Row, type Stmt } from '../db'
import { submitMessage } from './outbound'
import { settings } from '../settings'
import { today } from '../db'
import { journeyLinks } from '../agent/journey-results'

const liveDonor = `d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`
const sendable = `${liveDonor} AND d.constituent_status='active'`
const consent = `(SELECT k.status FROM cf_consents k WHERE k.donor_id=d.id AND k.channel='email' ORDER BY k.id DESC LIMIT 1)='granted'`
// Any second recorded gift stops the journey, including one subsequently
// reversed. A correction must never reactivate a second-gift solicitation.
const gaveAgain = `EXISTS(SELECT 1 FROM cf_gifts g WHERE g.donor_id=e.donor_id AND g.kind='gift' AND g.id<>e.first_gift_id)`
const firstStillValid = `EXISTS(SELECT 1 FROM cf_gift_balances g WHERE g.id=e.first_gift_id AND g.donor_id=e.donor_id AND g.net_cents>0)`
const allowed = `EXISTS(SELECT 1 FROM cf_welcome_enrollments e JOIN cf_donors d ON d.id=e.donor_id
 WHERE e.donor_id=cf_welcome_steps.donor_id AND e.status='active' AND ${sendable} AND ${consent}
 AND ${firstStillValid} AND NOT ${gaveAgain})`
const stepNames = ['thank', 'impact', 'ask'] as const

export const WELCOME_FIELDS=[...LETTER,'last_gift']
async function content(c:Context,value:unknown,label:string,body=false){
 const valueText=body?longText(value,label):text(value,label,200)
 if(!body&&/[\r\n]/.test(valueText))fail('INPUT',`${label} must be one line.`,400)
 checkTemplate(valueText,label,await customAllowed(c,WELCOME_FIELDS),[])
 return valueText
}
async function stepMessage(c:Context,step:Row,options:{emailType?:string}={}){
 const d=await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL',step.donor_id)
 if(!d)fail('DONOR_CHANGED','The welcome recipient is no longer available.')
 const [recipient,s,gift]=await Promise.all([letterRecipient(c,d,options),settings(c),one(c,'SELECT * FROM cf_gift_balances WHERE id=? AND donor_id=? AND net_cents>0',step.first_gift_id,d.id)])
 const giftFields:Row={}
 if(gift){gift.merge_fields=await customMerge(c,'gift',gift.id);await giftFacts(c,[gift]);Object.assign(giftFields,gift.merge_fields,{amount:usd(gift.net_cents),gift_date:longDate(gift.received_on),fund:gift.fund})
  if(gift.goods!=='unknown'&&gift.goods_cents<=gift.net_cents)Object.assign(giftFields,{goods_statement:goodsStatement(s,{...gift,amount_cents:gift.net_cents}),deductible_amount:usd(gift.net_cents-gift.goods_cents)})}
 const fields={...giftFields,...recipientMergeFields(recipient),date:longDate(today(s.timezone,new Date(c.now))),donor_name:recipient.letter_salutation??d.name,organization:s.organisation,ein:s.ein,last_gift:recipient.merge_fields?.last_gift_date||'No gift recorded'}
 return {recipient,version:d.version,...renderTemplate({subject:step.subject,body:step.body},fields)}
}

export async function welcomeCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['welcome.publish', 'welcome.run','list.welcome'].includes(command)) return undefined
 requireRole(c.actor, ['owner', 'admin'], 'manage the welcome series')
 if (command === 'welcome.run') return run(c,{emailType:p.emailType?choice(p.emailType,['personal','work','other'],'email contact type'):undefined})
 if(command==='list.welcome'){
  if(p.confirm!=='yes')fail('CONSENT','Confirm enrollment in the published welcome series. Its previously approved messages may submit on a later run.',400)
  const listId=text(p.listId,'Saved list',100),list=await one(c,'SELECT version FROM cf_saved_lists WHERE id=?',listId)
  if(!list||list.version!==Number(p.version))fail('VERSION','The saved list changed.')
  const members=await listMembers(c,listId)
  if(members.ids.length>100)fail('INPUT','Narrow the live list to at most 100 constituents.',400)
  if(!await one(c,"SELECT id FROM cf_welcome WHERE id='welcome'"))fail('WELCOME_MISSING','Publish and review the welcome messages first.',409)
  await enroll(c,members.ids,[...members.guards,guard('EXISTS(SELECT 1 FROM cf_saved_lists WHERE id=? AND version=?)','VERSION','The list changed.',listId,list.version),guard(`(WITH ${members.selection.ctes} SELECT (SELECT COUNT(*) FROM members)=? AND NOT EXISTS(SELECT 1 FROM members WHERE id NOT IN(SELECT value FROM json_each(?))))`,'LIST_CHANGED','Live membership changed.',...members.selection.params,members.ids.length,JSON.stringify(members.ids)),event(c,command,'saved_list',listId,null,{members:members.ids.length,publication:'welcome',explicitConsent:true})])
  const enrolled=await one(c,"SELECT COUNT(*) AS n FROM cf_welcome_enrollments WHERE status='active' AND donor_id IN(SELECT value FROM json_each(?))",JSON.stringify(members.ids))
  return {listId,active:enrolled!.n,excluded:members.ids.length-enrolled!.n,submitted:0}
 }
 const thankSubject = await content(c,p.thankSubject, 'Thank-you subject'), thankBody = await content(c,p.thankBody, 'Thank-you message', true)
 const impactSubject = await content(c,p.impactSubject, 'Impact subject'), impactBody = await content(c,p.impactBody, 'Impact message', true)
 const askSubject = await content(c,p.askSubject, 'Second-ask subject'), askBody = await content(c,p.askBody, 'Second-ask message', true)
 const impactDays = integer(Number(p.impactDays), 'Impact days after first gift', 1, 365)
 const askDays = integer(Number(p.askDays), 'Second-ask days after first gift', impactDays + 1, 730)
 const publicationId = newId()
 const messages = { thank: { subject: thankSubject, body: thankBody }, impact: { subject: impactSubject, body: impactBody }, ask: { subject: askSubject, body: askBody } }
 const publications = stepNames.map(step => {
  const code = `WELCOME-${publicationId}-${step}`, message = messages[step]
  return { step, code, subject: message.subject, body: journeyLinks(message.body, code, c.env!.AUTH_ORIGIN), list: `Coffer welcome · ${step} · ${publicationId}` }
 })
 await commit(c, [
  guard("NOT EXISTS(SELECT 1 FROM cf_welcome_enrollments WHERE status='active')", 'WELCOME_ACTIVE', 'Finish the active welcome series before changing its saved messages.'),
  guard("COALESCE((SELECT published_at FROM cf_welcome WHERE id='welcome'),'')=?", 'WELCOME_CHANGED', 'The welcome series changed. Refresh before publishing.', typeof p.publishedAt === 'string' ? p.publishedAt : ''),
  guard("COALESCE((SELECT publication_id FROM cf_welcome WHERE id='welcome'),'')=?", 'WELCOME_CHANGED', 'The welcome series changed. Refresh before publishing.', typeof p.publicationId === 'string' ? p.publicationId : ''),
  ...publications.flatMap(v => [
   sql("INSERT INTO cf_appeal_codes(code,name,origin,created_at) VALUES(?,?,'staff',?)", v.code, `Welcome · ${v.step}`, c.now),
   sql('INSERT INTO cf_journey_step_publications(code,publication_id,step,subject,body,list_name,published_at) VALUES(?,?,?,?,?,?,?)', v.code, publicationId, v.step, v.subject, v.body, v.list, c.now),
  ]),
  sql(`INSERT INTO cf_welcome(id,published_at,published_by,thank_subject,thank_body,impact_subject,impact_body,ask_subject,ask_body,impact_days,ask_days,publication_id)
   VALUES('welcome',?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET published_by=excluded.published_by,publication_id=excluded.publication_id,
   thank_subject=excluded.thank_subject,thank_body=excluded.thank_body,impact_subject=excluded.impact_subject,impact_body=excluded.impact_body,
   ask_subject=excluded.ask_subject,ask_body=excluded.ask_body,impact_days=excluded.impact_days,ask_days=excluded.ask_days`,
   c.now, c.actor.name, thankSubject, thankBody, impactSubject, impactBody, askSubject, askBody, impactDays, askDays, publicationId),
  event(c, command, 'welcome', 'welcome', null, { impactDays, askDays, publicationId }),
 ])
 return { id: 'welcome', published: true, publicationId, steps: publications.map(v => ({ step: v.step, code: v.code, body: v.body })) }
}

/** Reconcile first-time gifts and materialize all three steps in one batch.
 * Creation time is the arrival clock; received_on can be backdated. Historical
 * gifts, even reversed gifts, prevent an existing donor becoming first-time.
 * Later edits preserve the original launch boundary and cannot affect an active
 * journey because publish refuses while an enrollment remains active. */
async function enroll(c: Context,donorIds?:string[],checks:Stmt[]=[]) {
 const published=await one(c,"SELECT published_at FROM cf_welcome WHERE id='welcome'")
 if(!published)return
 const publishedDay=today((await settings(c)).timezone,new Date(published.published_at))
 await commit(c, [...checks,
  sql(`INSERT OR IGNORE INTO cf_welcome_enrollments(donor_id,first_gift_id,enrolled_at,status,stopped_at)
   SELECT d.id,g.id,?,'active',NULL FROM cf_gift_balances g JOIN cf_donors d ON d.id=g.donor_id
   JOIN cf_welcome w ON w.id='welcome'
   WHERE (? IS NULL OR d.id IN(SELECT value FROM json_each(?))) AND g.net_cents>0 AND ${sendable} AND (?=0 OR (${consent} AND NOT EXISTS(SELECT 1 FROM cf_gifts another WHERE another.donor_id=d.id AND another.kind='gift' AND another.id<>g.id))) AND julianday(g.created_at)>julianday(w.published_at)
   AND julianday(g.created_at)<=julianday(?) AND g.received_on>=? AND NOT EXISTS(SELECT 1 FROM cf_gifts prior
    WHERE prior.donor_id=d.id AND prior.kind='gift' AND (julianday(prior.created_at)<julianday(g.created_at)
     OR (julianday(prior.created_at)=julianday(g.created_at) AND prior.id<g.id)))`,c.now,donorIds?JSON.stringify(donorIds):null,donorIds?JSON.stringify(donorIds):null,donorIds?1:0,c.now,publishedDay),
  ...stepNames.map(step => sql(`INSERT OR IGNORE INTO cf_welcome_steps(id,donor_id,step,due_at,status,message_key,note,response_code)
   SELECT 'welcome:'||e.donor_id||':${step}',e.donor_id,'${step}',
   strftime('%Y-%m-%dT%H:%M:%fZ',g.created_at, '+'||${step === 'thank' ? '0' : `w.${step}_days`}||' days'),
   'pending','welcome:'||e.donor_id||':${step}',NULL,v.code
   FROM cf_welcome_enrollments e JOIN cf_gifts g ON g.id=e.first_gift_id JOIN cf_welcome w ON w.id='welcome'
   LEFT JOIN cf_journey_step_publications v ON v.publication_id=w.publication_id AND v.step='${step}' WHERE e.status='active' AND (? IS NULL OR e.donor_id IN(SELECT value FROM json_each(?)))`,donorIds?JSON.stringify(donorIds):null,donorIds?JSON.stringify(donorIds):null)),
 ])
}

async function stop(c: Context) {
 await commit(c, [
  // A deceased or inactive constituent leaves the journey with that reason, before any consent reasoning.
  sql(`UPDATE cf_welcome_enrollments AS e SET status=(SELECT d.constituent_status FROM cf_donors d WHERE d.id=e.donor_id),stopped_at=? WHERE e.status='active'
   AND EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=e.donor_id AND d.constituent_status<>'active')`, c.now),
  sql(`UPDATE cf_welcome_enrollments AS e SET status='unsubscribed',stopped_at=? WHERE e.status='active'
   AND NOT EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=e.donor_id AND ${sendable} AND ${consent})`, c.now),
  sql(`UPDATE cf_welcome_enrollments AS e SET status='gave',stopped_at=? WHERE e.status='active' AND ${gaveAgain}`, c.now),
  sql(`UPDATE cf_welcome_enrollments AS e SET status='completed',stopped_at=? WHERE e.status='active' AND NOT ${firstStillValid}`, c.now),
  sql(`UPDATE cf_welcome_steps SET status='cancelled',note='The welcome series stopped before submission.' WHERE status='pending'
   AND EXISTS(SELECT 1 FROM cf_welcome_enrollments e WHERE e.donor_id=cf_welcome_steps.donor_id AND e.status<>'active')`),
 ])
}

async function run(c: Context,options:{emailType?:string}={}): Promise<Row> {
 const {unavailable}=await emailConnection(c); if(unavailable) return {unavailable,submitted:0}
 if (!await one(c, "SELECT id FROM cf_welcome WHERE id='welcome'")) return { published: false, submitted: 0, uncertain: 0, cancelled: 0 }
 await enroll(c)
 await stop(c)
 const due = await all(c, `SELECT s.id FROM cf_welcome_steps s JOIN cf_welcome_enrollments e ON e.donor_id=s.donor_id
  WHERE s.status='pending' AND e.status='active' AND julianday(s.due_at)<=julianday(?)
  ORDER BY COALESCE(s.merge_checked_at,''),julianday(s.due_at),CASE s.step WHEN 'thank' THEN 0 WHEN 'impact' THEN 1 ELSE 2 END,s.id LIMIT 24`, c.now)
 let submitted = 0, uncertain = 0, cancelled = 0;const held:Row[]=[]
 for (const row of due) {
  const queued=await one(c,`SELECT s.*,e.first_gift_id,COALESCE(v.subject,CASE s.step WHEN 'thank' THEN w.thank_subject WHEN 'impact' THEN w.impact_subject ELSE w.ask_subject END) AS subject,COALESCE(v.body,CASE s.step WHEN 'thank' THEN w.thank_body WHEN 'impact' THEN w.impact_body ELSE w.ask_body END) AS body FROM cf_welcome_steps s JOIN cf_welcome_enrollments e ON e.donor_id=s.donor_id JOIN cf_welcome w ON w.id='welcome' LEFT JOIN cf_journey_step_publications v ON v.code=s.response_code WHERE s.id=?`,row.id)
  if(!queued)continue
  const preference=queued.step==='ask'?(await communicationReasons(c,[queued.donor_id],'email')).get(queued.donor_id):null
  const restricted=queued.step==='ask'?(await solicitationReason(c,queued.donor_id,'email',c.now)??(preference?{reason:preference,lastAskOn:null}:null)):null
  if(restricted){await commit(c,[sql("UPDATE cf_welcome_steps SET status='cancelled',note=? WHERE id=? AND status='pending'",restricted.reason+(restricted.reason==='solicitation limit'&&restricted.lastAskOn?' · Last ask '+restricted.lastAskOn:''),row.id),event(c,'welcome.askSkipped','welcome',row.id,queued.donor_id,restricted)]);cancelled++;continue}
  const rendered=await stepMessage(c,queued,options),blanks:string[]=JSON.parse(rendered.merge_blanks)
  if(!rendered.recipient.email&&!blanks.includes('email'))blanks.push('email')
  rendered.merge_blanks=JSON.stringify(blanks)
  if(blanks.length){await commit(c,[sql("UPDATE cf_welcome_steps SET merge_blanks=?,merge_checked_at=?,note=? WHERE id=? AND status='pending'",rendered.merge_blanks,c.now,'Missing merge fields: '+blanks.join(', ')+'. No provider handoff; fill the values before running again.',row.id)]);held.push({donorId:queued.donor_id,stepId:queued.id,fields:blanks});continue}
  if(!await one(c,'SELECT 1 FROM cf_solicitation_runs WHERE kind=? AND run_id=?','welcome',row.id)){
   const classification=await prepareSolicitationRun(c,{kind:'welcome',id:row.id,channel:'email',isAsk:queued.step==='ask',donorIds:[queued.donor_id]})
   await commit(c,classification.statements)
  }
  const claim = `Submission claim ${newId()}. Interrupted submissions are not retried automatically.`
  // 'uncertain' is the durable pre-send claim. Only this unique claim holder
  // may submit; a crashed Worker leaves visible uncertainty, never a retry.
  await commit(c, [sql(`UPDATE cf_welcome_steps SET status='uncertain',note=?,merge_blanks='[]',merge_checked_at=? WHERE id=? AND status='pending'
   AND EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.version=? AND (d.email=? OR EXISTS(SELECT 1 FROM cf_contact_points p WHERE p.donor_id=d.id AND p.id=? AND p.version=? AND p.active=1 AND p.kind='email' AND p.value=?))) AND julianday(due_at)<=julianday(?) AND ${allowed}
   AND NOT EXISTS(SELECT 1 FROM cf_welcome_steps prior WHERE prior.donor_id=cf_welcome_steps.donor_id
    AND prior.status='pending' AND CASE prior.step WHEN 'thank' THEN 0 WHEN 'impact' THEN 1 ELSE 2 END
     <CASE cf_welcome_steps.step WHEN 'thank' THEN 0 WHEN 'impact' THEN 1 ELSE 2 END)`, claim,c.now,row.id,queued.donor_id,rendered.version,rendered.recipient.email,rendered.recipient.selected_email_contact_id,rendered.recipient.selected_email_contact_version,rendered.recipient.email,c.now)])
  const step = await one(c, `SELECT s.*,
   COALESCE(v.subject,CASE s.step WHEN 'thank' THEN w.thank_subject WHEN 'impact' THEN w.impact_subject ELSE w.ask_subject END) AS subject,
   COALESCE(v.body,CASE s.step WHEN 'thank' THEN w.thank_body WHEN 'impact' THEN w.impact_body ELSE w.ask_body END) AS body,v.list_name
   FROM cf_welcome_steps s JOIN cf_welcome w ON w.id='welcome' LEFT JOIN cf_journey_step_publications v ON v.code=s.response_code
   WHERE s.id=? AND s.status='uncertain' AND s.note=?`, row.id, claim)
  if (!step) continue
  await stop(c)
  if (!await one(c, `SELECT id FROM cf_welcome_steps WHERE id=? AND status='uncertain' AND note=? AND ${allowed}`, step.id, claim)) {
   await outcome(c, step.id, claim, 'cancelled', 'The welcome series stopped before submission.')
   cancelled++
   continue
  }
  let state = 'uncertain', note = 'Submission could not be confirmed. Check the message history before contacting this donor. No automatic resend.'
  try {
   const result = await submitMessage(c, { key: step.message_key, donorId: step.donor_id, subject: step.subject, body: step.body, sourceKind: 'welcome', sourceId: step.id, rendered, expectedEmail:rendered.recipient.email,emailType:options.emailType,expectedContactId:rendered.recipient.selected_email_contact_id,expectedContactVersion:rendered.recipient.selected_email_contact_version, listName: step.list_name ?? `Coffer welcome · ${step.step === 'thank' ? '1 Thank you' : step.step === 'impact' ? '2 Impact' : '3 Next gift'}` })
   state = ['submitted', 'listed'].includes(result.status) ? 'submitted' : result.status === 'suppressed' ? 'cancelled' : 'uncertain'
   note = state === 'submitted' ? 'Submitted; delivery is not confirmed.' : state === 'cancelled' ? 'Message suppressed; no email was sent.' : note
  } catch (error) {
   const message=await one(c,'SELECT id FROM cf_communications WHERE message_key=?',step.message_key)
   await outcome(c, step.id, claim, message?state:'pending',message?note:'Submission did not start. Check the provider connection before running due steps again.')
   // Keep authorization and infrastructure failures visible to the caller.
   throw error
  }
  await outcome(c, step.id, claim, state, note)
  if (state === 'submitted') submitted++
  else if (state === 'cancelled') cancelled++
  else uncertain++
 }
 await stop(c)
 await commit(c, [sql(`UPDATE cf_welcome_enrollments SET status='completed',stopped_at=? WHERE status='active'
  AND NOT EXISTS(SELECT 1 FROM cf_welcome_steps s WHERE s.donor_id=cf_welcome_enrollments.donor_id AND s.status='pending')`, c.now)])
 return { published: true, submitted, uncertain, cancelled, held }
}

async function outcome(c: Context, stepId: string, claim: string, state: string, note: string) {
 // The prior authorized claim owns its result even if the session was revoked
 // while the provider responded. It can update only that exact claim.
 await c.db.prepare("UPDATE cf_welcome_steps SET status=?,note=? WHERE id=? AND status='uncertain' AND note=?").bind(state, note, stepId, claim).run()
}

export async function runWelcome(env: Bindings, at: Date): Promise<Row> {
 return run({ db: env.DB, env, now: at.toISOString(), actor: { id: 'coffer-scheduler', name: 'Welcome scheduler', role: 'owner' },
  authority: { sql: 'EXISTS(SELECT 1 FROM cf_settings WHERE id=1)', params: [] } })
}

export async function welcomeState(c: Context): Promise<Row> {
 const [journey, enrollments, steps, counts, publications, held] = await Promise.all([
  one(c, "SELECT * FROM cf_welcome WHERE id='welcome'"),
  all(c, `SELECT e.*,d.name,d.email FROM cf_welcome_enrollments e JOIN cf_donors d ON d.id=e.donor_id
   WHERE ${liveDonor} ORDER BY e.enrolled_at DESC,e.donor_id LIMIT 100`),
  all(c, `SELECT s.* FROM cf_welcome_steps s JOIN cf_donors d ON d.id=s.donor_id WHERE ${liveDonor}
   AND s.donor_id IN (SELECT donor_id FROM cf_welcome_enrollments ORDER BY enrolled_at DESC,donor_id LIMIT 100)
   ORDER BY s.due_at,CASE s.step WHEN 'thank' THEN 0 WHEN 'impact' THEN 1 ELSE 2 END`),
  one(c, "SELECT COUNT(*) AS active FROM cf_welcome_enrollments WHERE status='active'"),
  all(c, 'SELECT v.* FROM cf_journey_step_publications v JOIN cf_welcome w ON w.publication_id=v.publication_id ORDER BY CASE v.step WHEN \'thank\' THEN 0 WHEN \'impact\' THEN 1 ELSE 2 END'),
  all(c,`SELECT s.id,s.donor_id,s.merge_blanks,d.name FROM cf_welcome_steps s JOIN cf_donors d ON d.id=s.donor_id WHERE ${liveDonor} AND s.status='pending' AND s.merge_blanks IS NOT NULL AND s.merge_blanks<>'[]' ORDER BY lower(d.name),s.due_at,s.id`),
 ])
 return { journey,publications,mergeReview:held.map(s=>({donorId:s.donor_id,recipientName:s.name,stepId:s.id,fields:JSON.parse(s.merge_blanks)})),activeCount: counts?.active ?? 0, enrollments: enrollments.map(e => ({ ...e, steps: steps.filter(s => s.donor_id === e.donor_id) })) }
}
