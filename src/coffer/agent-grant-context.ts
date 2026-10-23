import { commit, fail, one, type Context } from './db'

/** Delegation uses the key's real identity and the same live predicates as a
 * bearer request. No token is recovered and no operator role is borrowed. */
export async function storedAgentContext(c: Context, keyId: string): Promise<Context> {
 const key=await one(c,`SELECT k.id,k.label,k.grant_id,g.version AS grant_version,control.version AS control_version
 FROM cf_agent_keys k JOIN cf_agent_grants g ON g.id=k.grant_id CROSS JOIN cf_agent_grant_control control WHERE k.id=?`,keyId)
 if(!key)fail('GRANT_REQUIRED','Select an active key with a named standing receipt grant.',403)
 const authority={sql:`(${c.authority.sql}) AND EXISTS(
 SELECT 1 FROM cf_agent_keys k JOIN oa_operators creator ON creator.id=k.created_by
 JOIN cf_agent_grants g ON g.id=k.grant_id JOIN oa_operators approver ON approver.id=g.approved_by_id
 WHERE k.id=? AND k.grant_id=? AND k.revoked_at IS NULL AND k.expires_at>MAX(?,unixepoch('now')*1000)
 AND creator.status='active' AND creator.version=k.creator_version AND creator.role IN ('owner','admin')
 AND g.version=? AND g.enabled=1 AND approver.status='active' AND approver.version=g.approver_version AND approver.role IN ('owner','admin'))
 AND EXISTS(SELECT 1 FROM cf_agent_grant_control WHERE id=1 AND version=? AND enabled=1)`,params:[...c.authority.params,key.id,key.grant_id,Date.now(),key.grant_version,key.control_version]}
 const delegated:Context={...c,actor:{id:key.id,name:key.label,role:'agent',grant:{id:key.grant_id,version:key.grant_version}},authority}
 await commit(delegated,[])
 return delegated
}
