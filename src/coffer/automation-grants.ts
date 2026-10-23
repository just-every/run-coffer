import { manager } from './auth'
import { all, commit, event, fail, guard, id, integer, one, sql, today, type Context, type Row } from './db'
import type { Bindings } from '../auth.server'
import { settings } from './settings'

type Automation = Row & { id: string; version: number; donor_ids: string | null; commands: string; daily_limit: number }
type Automated = Context & { automation: Automation }
export const automated = (c: Context): c is Automated => 'automation' in c

/** Existing scheduled capabilities gain revocable authority, rather than sql=1. */
export async function automationContext(env: Bindings, grantId: string, at = new Date().toISOString()): Promise<Automated | null> {
 const base = { db: env.DB }, g = await one<Automation>(base,'SELECT * FROM cf_automation_grants WHERE id=? AND enabled=1',grantId)
 const control = await one(base,'SELECT * FROM cf_agent_grant_control WHERE id=1 AND enabled=1')
 if (!g || !control) return null
 const actor = { id:'coffer-automation:'+g.id, name:g.name as string, role:'agent' as const, grant:{id:'automation:'+g.id,version:g.version} }
 const authority = {sql:'EXISTS(SELECT 1 FROM cf_automation_grants WHERE id=? AND version=? AND enabled=1) AND EXISTS(SELECT 1 FROM cf_agent_grant_control WHERE id=1 AND version=? AND enabled=1)',params:[g.id,g.version,control.version]}
 return {db:env.DB,env,now:at,actor,authority,automation:g}
}

/** SQL is selected by code, never supplied by a request. Scope remains guarded
 * by the grant version in the same transaction as every effect. */
export function automationRecords(c: Context, column: string) {
 return automated(c) && c.automation.donor_ids !== null ? {sql:`${column} IN (SELECT value FROM json_each(?))`,params:[c.automation.donor_ids]} : {sql:'1',params:[] as unknown[]}
}
export function automationAllows(c: Context, donorId: string) {
 return !automated(c) || c.automation.donor_ids === null || JSON.parse(c.automation.donor_ids).includes(donorId)
}
export async function claimAutomation(c: Context, command: string, count = 1, donorId: string | null = null) {
 if (!automated(c)) return
 if (!JSON.parse(c.automation.commands).includes(command) || (donorId && !automationAllows(c,donorId))) fail('GRANT_SCOPE','This automation grant does not allow this action.',403)
 const g=c.automation,day=today((await settings(c)).timezone,new Date(c.now))
 await commit(c,[guard('COALESCE((SELECT reserved FROM cf_automation_usage WHERE grant_id=? AND day=?),0)+?<=?','DAILY_LIMIT','The automation grant daily limit is reached.',g.id,day,count,g.daily_limit),
  sql('INSERT INTO cf_automation_usage VALUES(?,?,?) ON CONFLICT(grant_id,day) DO UPDATE SET reserved=reserved+excluded.reserved',g.id,day,count),
  event(c,'automation.claim','automation_grant',g.id,donorId,{grantId:'automation:'+g.id,grantVersion:g.version,command,count,day})])
}
export async function automationGrants(c: Context) {
 if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin manages background grants.',403)
 return all(c,'SELECT * FROM cf_automation_grants ORDER BY name')
}
export async function saveAutomationGrant(c: Context,p:Row) {
 if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin manages background grants.',403)
 const key=id(p.id,'Grant'),version=integer(Number(p.version),'Version',1),current=await one(c,'SELECT * FROM cf_automation_grants WHERE id=?',key)
 if(!current)fail('NOT_FOUND','That background grant does not exist.',404)
 const daily=integer(Number(p.dailyLimit),'Daily action limit',1,10000),enabled=p.enabled===true||p.enabled==='yes'?1:0
 let donors:string[]|null=null
 if(p.scope==='selected') {
  donors=String(p.donorIds??'').split(/[\s,]+/).filter(Boolean).map(x=>id(x,'Donor identifier'))
  if(!donors.length || donors.length>500)fail('INPUT','Select 1–500 donors.',400)
  if(['reconciliation','statements'].includes(key))fail('INPUT','This background grant requires the complete ledger; stop it to remove that authority.',400)
 }
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_automation_grants WHERE id=? AND version=?)','VERSION','This background grant changed. Refresh.',key,version),
  ...(donors?[guard('(SELECT count(*) FROM cf_donors WHERE id IN(SELECT value FROM json_each(?)) AND erased_at IS NULL)=?','GRANT_SCOPE','Choose current donors.',JSON.stringify([...new Set(donors)]),new Set(donors).size)]:[]),
  sql('UPDATE cf_automation_grants SET version=version+1,enabled=?,donor_ids=?,daily_limit=? WHERE id=?',enabled,donors?JSON.stringify([...new Set(donors)]):null,daily,key),event(c,'automation.grant','automation_grant',key,null,{grantId:'automation:'+key,grantVersion:version+1,enabled,scope:donors?'selected':'all',dailyLimit:daily})])
 return {id:key,version:version+1}
}
