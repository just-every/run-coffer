import { preparationGrantLimits } from './agent-grants-legacy'
import { manager } from './auth'
import { all, commit, event, fail, guard, id, integer, newId, one, sql, text, type Context, type Row } from './db'
import { settings } from './settings'
import { templateRevision } from './letter-templates'

export const GRANT_PERMISSIONS = ['donors.list','donors.context','ack.prepare','ack.send'] as const
export type AgentGrant = Row & { id: string; version: number; donor_ids: string; permissions: string }
const values = (value: unknown, label: string): string[] => {
 const list = typeof value === 'string' ? value.split(/[\s,]+/).filter(Boolean) : value
 if (!Array.isArray(list) || !list.length || list.length > 500) fail('INPUT', `Select 1–500 ${label}.`, 400)
 return [...new Set(list.map(v => id(v, label)))]
}
export async function agentGrantsState(c: Context) {
 if (!manager(c.actor)) fail('FORBIDDEN','Only an owner or admin manages agent grants.',403)
 return { preparationGrants:await all(c,'SELECT * FROM cf_agent_preparation_grants ORDER BY name,id'), grants: await all(c,'SELECT * FROM cf_agent_grants ORDER BY name,id'), keys: await all(c,'SELECT id,label,grant_id,revoked_at FROM cf_agent_keys ORDER BY created_at DESC'), control: await one(c,'SELECT * FROM cf_agent_grant_control WHERE id=1'), settingsVersion:(await settings(c)).version, templateRevision:await templateRevision(c) }
}
export async function agentGrantCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!command.startsWith('agentGrant.')) return undefined
 if (!manager(c.actor)) fail('FORBIDDEN','Only an owner or admin manages agent grants.',403)
 if(command==='agentGrant.legacyLimits')return preparationGrantLimits(c,p)
 if (command === 'agentGrant.kill') {
  const version=integer(Number(p.version),'Version',1), enabled=p.enabled===true||p.enabled==='yes'?1:0
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_agent_grant_control WHERE id=1 AND version=?)','VERSION','Grant controls changed. Refresh.',version),sql('UPDATE cf_agent_grant_control SET enabled=?,version=version+1 WHERE id=1',enabled),event(c,command,'agent_grants','control',null,{enabled})])
  return { enabled:!!enabled,version:version+1 }
 }
 if(command==='agentGrant.disable'){
  const grantId=id(p.id,'Grant'),version=integer(Number(p.version),'Version',1)
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_agent_grants WHERE id=? AND version=?)','VERSION','This grant changed. Refresh.',grantId,version),sql('UPDATE cf_agent_grants SET enabled=0,version=version+1,updated_at=? WHERE id=?',c.now,grantId),event(c,command,'agent_grant',grantId,null,{grantId,grantVersion:version+1})])
  return {id:grantId,version:version+1,enabled:false}
 }
 if (command === 'agentGrant.attach') {
  const keyId=id(p.keyId,'Key'),grantId=id(p.grantId,'Grant')
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_agent_grants WHERE id=? AND enabled=1)','GRANT_DISABLED','Choose an enabled grant.',grantId),guard('EXISTS(SELECT 1 FROM cf_agent_keys WHERE id=? AND revoked_at IS NULL)','NOT_FOUND','Choose an active key.',keyId),sql('UPDATE cf_agent_keys SET grant_id=? WHERE id=?',grantId,keyId),event(c,command,'agent',keyId,null,{grantId})])
  return { id:keyId,grantId }
 }
 if (command !== 'agentGrant.save') fail('COMMAND','Unknown grant command.',400)
 const grantId=p.id?id(p.id,'Grant'):newId(),version=p.id?integer(Number(p.version),'Version',1):0
 const name=text(p.name,'Grant name',100), donors=values(p.donorIds,'donor identifiers'),permissions=values(p.permissions,'permissions')
 if(permissions.some(x=>!GRANT_PERMISSIONS.includes(x as any)))fail('INPUT','Choose a supported grant permission.',400)
 if(permissions.includes('ack.send')&&!(p.standingApproval===true||p.standingApproval==='yes'))fail('STANDING_APPROVAL','Explicitly approve standing receipt sending under the current template revision.',400)
 const dailyLimit=integer(Number(p.dailyLimit),'Daily receipt limit',1,1000),s=await settings(c),revision=await templateRevision(c),enabled=p.enabled===false||p.enabled==='no'?0:1
 if(permissions.includes('ack.send')&&!s.reviewed_at)fail('SETTINGS_UNREVIEWED','Review organization settings before granting standing approval.')
 const approval=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id)
 await commit(c,[guard('(SELECT count(*) FROM cf_donors WHERE id IN(SELECT value FROM json_each(?)) AND erased_at IS NULL)=?','NOT_FOUND','A scoped donor is missing or erased.',JSON.stringify(donors),donors.length),
  guard('(?=0 AND NOT EXISTS(SELECT 1 FROM cf_agent_grants WHERE id=?)) OR EXISTS(SELECT 1 FROM cf_agent_grants WHERE id=? AND version=?)','VERSION','This grant changed. Refresh.',version,grantId,grantId,version),
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?) AND (SELECT COALESCE(SUM(version),0) FROM cf_letter_templates)=?','TEMPLATES_CHANGED','Templates changed. Review the grant again.',s.version,revision),
  sql(`INSERT INTO cf_agent_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,enabled=excluded.enabled,donor_ids=excluded.donor_ids,permissions=excluded.permissions,daily_limit=excluded.daily_limit,settings_version=excluded.settings_version,template_revision=excluded.template_revision,approved_by_id=excluded.approved_by_id,approved_by_name=excluded.approved_by_name,approved_by_role=excluded.approved_by_role,approver_version=excluded.approver_version,updated_at=excluded.updated_at`,grantId,name,version+1,enabled,JSON.stringify(donors),JSON.stringify(permissions),dailyLimit,permissions.includes('ack.send')?s.version:null,permissions.includes('ack.send')?revision:null,c.actor.id,c.actor.name,c.actor.role,approval!.version,c.now),
  event(c,command,'agent_grant',grantId,null,{grantId,grantVersion:version+1,permissions,donorIds:donors,dailyLimit,enabled,settingsVersion:s.version,templateRevision:revision,standingApproval:permissions.includes('ack.send')})])
 return { id:grantId,version:version+1 }
}
/** Snapshot plus a transactional authority check: narrowing never silently becomes legacy access. */
export async function requireGrant(c: Context, permission: string): Promise<AgentGrant> {
 const g=c.actor.grant
 if(!g)fail('GRANT_REQUIRED','This action requires a named grant.',403)
 const grant=await one<AgentGrant>(c,'SELECT * FROM cf_agent_grants WHERE id=? AND version=? AND enabled=1',g.id,g.version)
 if(!grant || !JSON.parse(grant.permissions).includes(permission))fail('GRANT_FORBIDDEN','The current grant does not allow this action.',403)
 await commit(c,[])
 return grant
}
export const scopedDonor = (grant: AgentGrant, donorId: string) => {
 if(!JSON.parse(grant.donor_ids).includes(donorId))fail('GRANT_SCOPE','This donor is outside the named grant.',403)
}
