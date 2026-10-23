import { receiptStatementRecovery } from './receipt-autonomy-statements'
import { manager } from '../auth'
import { requireGrant } from '../agent-grants'
import { storedAgentContext } from '../agent-grant-context'
import { amount } from '../money'
import { all, commit, date, event, fail, guard, id, integer, one, sql, type Context, type Row } from '../db'

export const receiptPolicy = (c: {db:D1Database}) => one(c,'SELECT p.*,control.receipt_key_id AS selected_key_id FROM cf_receipt_autonomy p CROSS JOIN cf_agent_grant_control control WHERE p.id=1 AND control.id=1') as Promise<Row>
export async function receiptAutonomyState(c:Context):Promise<Row> {
 if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin manages receipt autonomy.',403)
 return {...await receiptPolicy(c),statements:await receiptStatementRecovery(c),reviews:await all(c,`SELECT r.*,g.donor_id,d.name AS donor_name,g.amount_cents FROM cf_receipt_reviews r JOIN cf_gifts g ON g.id=r.gift_id JOIN cf_donors d ON d.id=g.donor_id LEFT JOIN cf_ack_batches b ON b.id=r.batch_id WHERE d.erased_at IS NULL AND g.received_on>=COALESCE((SELECT acknowledge_from FROM cf_receipt_autonomy WHERE id=1),'0001-01-01') AND NOT EXISTS(SELECT 1 FROM cf_prior_acknowledgements prior WHERE prior.gift_id=g.id) AND (r.batch_id IS NULL OR b.status<>'discarded') AND NOT EXISTS(SELECT 1 FROM cf_gifts reversal WHERE reversal.reverses=g.id) AND NOT EXISTS(SELECT 1 FROM cf_gift_acknowledgments k WHERE k.gift_id=g.id AND k.status<>'not acknowledged') ORDER BY r.updated_at DESC LIMIT 500`),keys:await all(c,`SELECT k.id,k.label,k.expires_at,g.name AS grant_name FROM cf_agent_keys k JOIN cf_agent_grants g ON g.id=k.grant_id WHERE k.revoked_at IS NULL AND g.enabled=1 AND EXISTS(SELECT 1 FROM json_each(g.permissions) WHERE value='ack.send') ORDER BY k.label`)}
}
export async function saveReceiptAutonomy(c:Context,p:Row) {
 if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin manages receipt autonomy.',403)
 const version=integer(Number(p.version),'Version',1),keyId=p.keyId?id(p.keyId,'Agent key'):null
 const cutoff=p.acknowledgeFrom?date(p.acknowledgeFrom,'Acknowledge from'):null
 const maximum=amount(p,'maxStandardAmount','Largest standard gift')
 if(keyId) {
  if(p.standingApproval!==true&&p.standingApproval!=='yes')fail('STANDING_APPROVAL','Explicitly select standing receipt sending under the named grant.',400)
  const agent=await storedAgentContext(c,keyId)
  await requireGrant(agent,'ack.prepare');const g=await requireGrant(agent,'ack.send')
  const s=await one(c,'SELECT version FROM cf_settings WHERE id=1'),revision=await one(c,'SELECT COALESCE(SUM(version),0) AS n FROM cf_letter_templates')
  if(g.settings_version!==s?.version||g.template_revision!==revision?.n)fail('TEMPLATES_CHANGED','Renew the named grant for the current reviewed template first.')
  c={...c,authority:agent.authority}
 }
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_receipt_autonomy WHERE id=1 AND version=?)','VERSION','Receipt policy changed. Refresh.',version),
  sql('UPDATE cf_receipt_autonomy SET version=version+1,acknowledge_from=?,max_standard_cents=?,updated_at=?,updated_by=? WHERE id=1',cutoff,maximum,c.now,c.actor.id),sql('UPDATE cf_agent_grant_control SET receipt_key_id=? WHERE id=1',keyId),
  event(c,'agent.receipts.policy','receipt_autonomy','1',null,{version:version+1,keyId,acknowledgeFrom:cutoff,maxStandardCents:maximum})])
 return {version:version+1}
}

/** Human review reasons are facts, never an implicit approval. */
export function receiptReasons(g:Row,maximum:number) {
 const reasons:string[]=[]
 if(g.goods==='unknown')reasons.push('Goods or services value unknown')
 if(!g.address_line1||!g.city||!g.postal_code)reasons.push('Postal address missing')
 if(g.amount_cents>maximum)reasons.push('Large gift: above the standard receipt limit')
 if(g.constituent_status!=='active'||g.constituent_kind!=='person'||g.household_id||g.related_records)reasons.push('Related, household or inactive recipient needs human review')
 if(g.merge_blanks&&g.merge_blanks!=='[]')reasons.push('Template fields need human review')
 if(!g.email)reasons.push('Email address missing: print and mailing need a person')
 if(g.failed_email)reasons.push('Failed email address needs correction or mailing')
 if(g.net_cents<=g.goods_cents)reasons.push('Gift benefit leaves no deductible receipt amount')
 return reasons
}
