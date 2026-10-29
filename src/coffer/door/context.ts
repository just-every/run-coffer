import type { ToolContext } from '../../modules/agent-door/index.ts'
import { ToolRefusal } from '../../modules/agent-door/index.ts'
import { identity } from '../auth'
import { CofferError, commit, one, type Context } from '../db'
import type { Bindings } from '../../auth.server'

/** Native account and grant predicates also fence each native transaction. */
export async function nativeContext(env: Bindings, ctx: ToolContext): Promise<Context> {
 const operator=await one({db:env.DB},'SELECT * FROM oa_operators WHERE id=? AND status=\'active\'',ctx.person.id)
 if(!operator)throw new ToolRefusal('unauthenticated')
 const restriction=await one({db:env.DB},'SELECT version,read_only FROM cf_team_access WHERE operator_id=?',operator.id)
 const state=await one({db:env.DB},'SELECT envelope,local_document,local_revision,local_paused FROM agent_door_state WHERE id=1')
 let c:Context={db:env.DB,env,now:new Date(ctx.now()).toISOString(),actor:{id:operator.id,name:ctx.actor.label,role:operator.role,teamAccess:{version:restriction?.version??0,readOnly:restriction?.read_only===1},doorAgent:{id:ctx.agent.id,name:ctx.agent.name,sponsorId:ctx.person.id,sponsorName:ctx.person.name,operationId:ctx.operationId,consent:ctx.consent,approvers:ctx.approvers.map(p=>({id:p.id,name:p.name}))}},authority:{sql:`EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active' AND role=?) AND COALESCE((SELECT version FROM cf_team_access WHERE operator_id=?),0)=? AND COALESCE((SELECT read_only FROM cf_team_access WHERE operator_id=?),0)=? AND EXISTS(SELECT 1 FROM agent_door_state WHERE id=1 AND envelope IS ? AND local_document IS ? AND local_revision=? AND local_paused=0) AND NOT EXISTS(SELECT 1 FROM agent_door_agents WHERE id=? AND revoked=1)`,params:[operator.id,operator.version,operator.role,operator.id,restriction?.version??0,operator.id,restriction?.read_only??0,state?.envelope??null,state?.local_document??null,state?.local_revision??0,ctx.agent.id]}}
 if(ctx.clientId?.startsWith('coffer-key:')) {
  const key=await one({db:env.DB},'SELECT * FROM cf_agent_keys WHERE id=? AND created_by=?',ctx.clientId.slice(11),operator.id)
  if(!key)throw new ToolRefusal('unauthenticated')
  // Reuse the exact native key/grant predicate without recovering a bearer.
  const current=await import('../agent-grant-context')
  if(key.grant_id)c=await current.storedAgentContext(c,key.id)
  else {
   const grant=await one({db:env.DB},'SELECT * FROM cf_agent_preparation_grants WHERE key_id=? AND enabled=1',key.id)
   if(!grant)throw new ToolRefusal('GRANT_FORBIDDEN')
   c={...c,actor:{...c.actor,id:key.id,role:'agent',preparationGrant:{id:grant.id,version:grant.version}},authority:{sql:`(${c.authority.sql}) AND EXISTS(SELECT 1 FROM cf_agent_keys k JOIN oa_operators o ON o.id=k.created_by WHERE k.id=? AND k.revoked_at IS NULL AND k.expires_at>MAX(?,unixepoch('now')*1000) AND o.version=k.creator_version AND o.status='active') AND EXISTS(SELECT 1 FROM cf_agent_preparation_grants WHERE id=? AND version=? AND enabled=1) AND EXISTS(SELECT 1 FROM cf_agent_grant_control WHERE id=1 AND enabled=1)`,params:[...c.authority.params,key.id,Date.now(),grant.id,grant.version]}}
  }
  c.actor={...c.actor,name:ctx.actor.label,teamAccess:{version:restriction?.version??0,readOnly:restriction?.read_only===1},doorAgent:{id:ctx.agent.id,name:ctx.agent.name,sponsorId:ctx.person.id,sponsorName:ctx.person.name,operationId:ctx.operationId,consent:ctx.consent,approvers:ctx.approvers.map(p=>({id:p.id,name:p.name}))}}
 }
 await commit(c,[])
 return c
}
export async function native<T>(run:()=>Promise<T>):Promise<T>{try{return await run()}catch(e){if(e instanceof CofferError)throw new ToolRefusal(e.code,e.message,{status:e.status});throw e}}

export async function localCredential(env:Bindings, request:Request){
 if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(request.headers.get('authorization')??''))return null
 const auth=await identity(request,env)
 await commit({db:env.DB,authority:auth.authority},[])
 const key=await one({db:env.DB},'SELECT created_by FROM cf_agent_keys WHERE id=?',auth.actor.id)
 if(!key)return null
 return {sponsor:{id:key.created_by},agent:{id:auth.actor.id,name:auth.actor.name,specialist:'development'},clientId:'coffer-key:'+auth.actor.id,scopes:await keyScopes(env,auth.actor.id)}
}
export async function keyScopes(env:Bindings,id:string){
 const key=await one({db:env.DB},`SELECT k.id,k.grant_id,g.permissions FROM cf_agent_keys k JOIN oa_operators o ON o.id=k.created_by LEFT JOIN cf_agent_grants g ON g.id=k.grant_id WHERE k.id=? AND k.revoked_at IS NULL AND k.expires_at>MAX(?,unixepoch('now')*1000) AND o.status='active' AND o.version=k.creator_version AND o.role IN ('owner','admin') AND EXISTS(SELECT 1 FROM cf_agent_grant_control WHERE id=1 AND enabled=1)`,id,Date.now())
 if(!key)return []
 const permissions:string[]=key.grant_id?JSON.parse(key.permissions??'[]'):['donors.list','donors.context','ack.prepare','appeal.prepare']
 return [...permissions.map(p=>'coffer:'+p),...(!key.grant_id?['coffer:native.read']:[])]
}
