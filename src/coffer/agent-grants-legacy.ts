import { manager } from './auth'
import { commit, event, fail, guard, id, integer, one, sql, today, type Context, type Row } from './db'
import { settings } from './settings'

/** Fixed AGENT-001 compatibility grant: all existing record reads and only
 * acknowledgment/appeal preparation. An explicit named grant replaces it. */
export async function reservePreparationGrant(c:Context,kind:'read'|'prepare') {
 const identity=c.actor.preparationGrant
 if(!identity)return
 const grant=await one(c,'SELECT * FROM cf_agent_preparation_grants WHERE id=? AND version=? AND enabled=1',identity.id,identity.version)
 if(!grant)fail('GRANT_FORBIDDEN','This preparation grant was disabled or changed.',403)
 const day=today((await settings(c)).timezone,new Date(c.now)),column=kind==='read'?'reads':'preparations',limit=kind==='read'?grant.read_limit:grant.prepare_limit
 await commit(c,[guard(`COALESCE((SELECT ${column} FROM cf_agent_preparation_usage WHERE grant_id=? AND day=?),0)+1<=?`,'DAILY_LIMIT',`The preparation grant’s daily ${kind==='read'?'request':'preparation'} limit has been reached.`,grant.id,day,limit),
  sql(`INSERT INTO cf_agent_preparation_usage(grant_id,day,${column}) VALUES(?,?,1) ON CONFLICT(grant_id,day) DO UPDATE SET ${column}=${column}+1`,grant.id,day),
  event(c,'agentGrant.reservePreparation','agent_grant',grant.id,null,{kind,day},'cf_access_events')])
}
export async function preparationGrantLimits(c:Context,p:Row) {
 if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin manages preparation grants.',403)
 const grantId=id(p.id,'Preparation grant'),version=integer(Number(p.version),'Version',1),readLimit=integer(Number(p.readLimit),'Daily request limit',1,1000000),prepareLimit=integer(Number(p.prepareLimit),'Daily preparation limit',1,10000)
 const enabled=p.enabled===false||p.enabled==='no'?0:1
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_agent_preparation_grants WHERE id=? AND version=?)','VERSION','This preparation grant changed. Refresh.',grantId,version),
  sql('UPDATE cf_agent_preparation_grants SET version=version+1,enabled=?,read_limit=?,prepare_limit=? WHERE id=?',enabled,readLimit,prepareLimit,grantId),event(c,'agentGrant.legacyLimits','agent_grant',grantId,null,{grantId,grantVersion:version+1,readLimit,prepareLimit,enabled})])
 return {id:grantId,version:version+1}
}
