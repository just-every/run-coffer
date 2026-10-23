import { ackCommand, batchLetters, currentLetterGifts, letterHash } from './acknowledgements'
import { ackMailPieces } from './ack-mail-pieces'
import { requireGrant } from './agent-grants'
import { all, commit, event, fail, guard, id, integer, newId, one, sql, today, type Context, type Row, type Stmt } from './db'
import { deliveryCommand } from './letter-delivery'
import { settings } from './settings'

/** Scope closure for native rendering: household and organization addressees,
 * recognition of another donor's gift and relationship wording need a person. */
const giftScope = `NOT EXISTS(SELECT 1 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id IN(SELECT value FROM json_each(?)) AND (
 d.id NOT IN(SELECT value FROM json_each(?)) OR d.erased_at IS NOT NULL OR d.household_id IS NOT NULL OR d.constituent_kind<>'person' OR d.constituent_status<>'active'
 OR EXISTS(SELECT 1 FROM cf_soft_credits sc WHERE sc.donor_id=d.id)
 OR EXISTS(SELECT 1 FROM cf_relationships r WHERE r.donor_id=d.id OR r.related_donor_id=d.id)))`
const allowedInput = (p:Row,keys:string[]) => {if(Object.keys(p).some(k=>!keys.includes(k)))fail('GRANT_FORBIDDEN','This grant does not allow additional preparation or delivery options.',403)}
function extend(c:Context,checks:Stmt[]):Context {
 return {...c,authority:{sql:`(${c.authority.sql}) AND ${checks.map(s=>`(${s.check!.condition})`).join(' AND ')}`,params:[...c.authority.params,...checks.flatMap(s=>s.params)]}}
}
export async function executeGranted(c: Context, command: string, p: Row): Promise<Row> {
 const grant=await requireGrant(c,command)
 if(command==='ack.prepare') {
  allowedInput(p,['giftIds'])
  if(!Array.isArray(p.giftIds)||!p.giftIds.length||p.giftIds.length>8)fail('GRANT_SCOPE','Select 1–8 explicit gifts from the granted donors.',400)
  const ids=[...new Set(p.giftIds.map((x:unknown)=>id(x,'Gift')))],payload=JSON.stringify(ids)
  const checks=[guard('(SELECT count(*) FROM cf_gifts WHERE id IN(SELECT value FROM json_each(?)))=?','GRANT_SCOPE','A selected gift is unavailable.',payload,ids.length),guard(giftScope,'GRANT_SCOPE','These gifts require a person to prepare related or household records.',payload,grant.donor_ids)]
  for(const check of checks)if(!(await one(c,`SELECT (${check.check!.condition}) AS ok`,...check.params))?.ok)fail(check.check!.code,check.check!.message,403)
  // All rendering and the native freeze recheck the same immutable grant version.
  return (await ackCommand(extend(c,checks),'ack.prepare',{giftIds:ids}))!
 }
 if(command!=='ack.send')fail('GRANT_FORBIDDEN','This named grant does not support this command.',403)
 allowedInput(p,['batchId','version'])
 const batchId=id(p.batchId,'Batch'),version=integer(Number(p.version),'Version',1)
 const batch=await one(c,'SELECT * FROM cf_ack_batches WHERE id=?',batchId),letters=await batchLetters(c,batchId)
 if(!batch||!letters.length)fail('NOT_FOUND','That receipt batch is unavailable.',404)
 if(batch.version!==version)fail('VERSION','This batch changed. Refresh.')
 if(batch.kind!=='gift' || batch.prepared_by_id!==c.actor.id || !await one(c,"SELECT id FROM cf_events WHERE action='ack.prepare' AND subject_id=? AND actor_id=? AND json_extract(detail,'$.grantId')=? AND json_extract(detail,'$.grantVersion')=?",batchId,c.actor.id,grant.id,grant.version))fail('GRANT_SCOPE','Standing approval only covers this grant’s own standard receipt batches.',403)
 if(!['prepared','approved'].includes(batch.status)||letters.some(l=>l.route!=='pending'||l.void_reason))fail('ALREADY_SENT','This batch has already been dispatched or needs human review.')
 const gifts=JSON.stringify(letters.map(l=>l.gift_id))
 const checks=[guard(giftScope,'GRANT_SCOPE','Receipt records moved outside the grant.',gifts,grant.donor_ids),
  guard(`EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?) AND (SELECT COALESCE(SUM(version),0) FROM cf_letter_templates)=?
   AND NOT EXISTS(SELECT 1 FROM cf_acks a WHERE a.batch_id=? AND (a.donor_id NOT IN(SELECT value FROM json_each(?)) OR a.merge_blanks<>'[]' OR a.template_version<>CASE WHEN a.template_id IS NULL THEN ? ELSE COALESCE((SELECT t.version FROM cf_letter_templates t WHERE t.id=a.template_id AND t.active=1),-1) END))`, 'TEMPLATES_CHANGED','The standing-approved template revision changed or needs merge review.',grant.settings_version,grant.template_revision,batchId,grant.donor_ids,grant.settings_version)]
 if(batch.settings_version!==grant.settings_version)fail('TEMPLATES_CHANGED','This receipt uses a different settings revision.')
 for(const check of checks)if(!(await one(c,`SELECT (${check.check!.condition}) AS ok`,...check.params))?.ok)fail(check.check!.code,check.check!.message)
 if(await letterHash(batch.settings_version,letters,await ackMailPieces(c,batchId))!==batch.content_hash)fail('CONTENT_CHANGED','Receipt content changed. Prepare again.')
 const scoped=extend(c,checks),day=today((await settings(c)).timezone,new Date(c.now))
 const reserve=[guard('NOT EXISTS(SELECT 1 FROM cf_agent_grant_dispatches WHERE batch_id=?)','DISPATCH_CLAIMED','This dispatch was already claimed. A person must investigate an interrupted send.',batchId),
  guard('COALESCE((SELECT reserved FROM cf_agent_grant_usage WHERE grant_id=? AND day=?),0)+?<=?','DAILY_LIMIT','The grant’s daily receipt limit has been reached.',grant.id,day,letters.length,grant.daily_limit),
  guard("EXISTS(SELECT 1 FROM cf_ack_batches WHERE id=? AND version=? AND status IN ('prepared','approved'))",'VERSION','This batch changed.',batchId,version),currentLetterGifts(batchId),
  sql('INSERT INTO cf_agent_grant_usage VALUES(?,?,?) ON CONFLICT(grant_id,day) DO UPDATE SET reserved=reserved+excluded.reserved',grant.id,day,letters.length),
  sql('INSERT INTO cf_agent_grant_dispatches VALUES(?,?,?,?,?)',batchId,grant.id,grant.version,letters.length,c.now)]
 if(batch.status==='prepared')reserve.push(
  sql('INSERT INTO cf_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?)',newId(),'acknowledgements',batchId,batch.content_hash,batch.prepared_by_id,batch.prepared_by_name,batch.prepared_by_role,grant.approved_by_id,grant.approved_by_name,grant.approved_by_role,c.now),
  sql("UPDATE cf_ack_batches SET status='approved',version=version+1 WHERE id=?",batchId),event(c,'ack.standingApproval','acknowledgements',batchId,null,{approvedById:grant.approved_by_id,contentHash:batch.content_hash,settingsVersion:grant.settings_version,templateRevision:grant.template_revision}))
 reserve.push(event(c,'agentGrant.reserve','acknowledgements',batchId,null,{day,letters:letters.length}))
 // The daily reservation and approval are atomic. The same current grant,
 // template and scope checks guard every native per-letter submission claim.
 await commit(scoped,reserve)
 return (await deliveryCommand(scoped,'ack.send',{batchId,version:version+(batch.status==='prepared'?1:0)}))!
}
