import { event, fail, guard, one, sha256, sql, type Context, type Row, type Stmt } from '../db'
import type { ParseInput } from './types'

export async function neonIdentityPreview(c:Context,input:ParseInput) {
 const organizationId=input.neon?.organizationId
 if(typeof organizationId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(organizationId))fail('NEON_CONNECTION','Supply the Neon organization ID.',400)
 const organizationHash=await sha256(organizationId),current=await one(c,'SELECT organization_hash FROM cf_neon_source_identity WHERE singleton=1')
 if(current&&current.organization_hash!==organizationHash)fail('NEON_ORGANIZATION','This installation already holds history from a different Neon organization. Its source IDs must remain separate; no records were changed.',409)
 const legacy=!current&&!!await one(c,"SELECT 1 FROM cf_move_in_records WHERE source='neon' LIMIT 1")
 return {organizationId,organizationHash,requiresLegacyConfirmation:legacy}
}

export function neonIdentityOf(job:Row) {
 const coverage=JSON.parse(job.report).sourceCoverage
 if(!coverage?.organizationHash||!coverage.organizationId)fail('NEON_ORGANIZATION','Read Neon again: this older review did not record its source organization.',409)
 return coverage
}

export async function neonIdentityWrites(c:Context,job:Row,confirmed:unknown):Promise<Stmt[]> {
 if(job.source!=='neon')return []
 const identity=neonIdentityOf(job),current=await one(c,'SELECT organization_hash FROM cf_neon_source_identity WHERE singleton=1')
 if(current&&current.organization_hash!==identity.organizationHash)fail('NEON_ORGANIZATION','Another Neon organization was approved after this preview. No records were changed.',409)
 if(!current&&await one(c,"SELECT 1 FROM cf_move_in_records WHERE source='neon' LIMIT 1")){
  if(c.actor.role!=='owner'||c.actor.apiKey)fail('FORBIDDEN','The current native owner must review the organization of older Neon history.',403)
  if(confirmed!==true&&confirmed!=='yes')fail('NEON_ORGANIZATION_REVIEW','Confirm that this exact Neon organization supplied the existing imported records before matching its source IDs.',409)
 }
 return [guard('NOT EXISTS(SELECT 1 FROM cf_neon_source_identity) OR EXISTS(SELECT 1 FROM cf_neon_source_identity WHERE singleton=1 AND organization_hash=?)','NEON_ORGANIZATION','The source organization changed after review.',identity.organizationHash),
  ...(!current?[sql('INSERT OR IGNORE INTO cf_neon_source_identity VALUES(1,?,?,?,?)',identity.organizationHash,identity.organizationId,c.now,c.actor.id),event(c,'move-in.neonIdentity','move-in',job.id,null,{organizationId:identity.organizationId,legacyConfirmation:confirmed===true||confirmed==='yes'})]:[])]
}

export async function requireNeonIdentity(c:Context,job:Row) {
 if(job.source!=='neon')return
 const identity=neonIdentityOf(job)
 if(!await one(c,'SELECT 1 FROM cf_neon_source_identity WHERE singleton=1 AND organization_hash=?',identity.organizationHash))fail('NEON_ORGANIZATION','This review has no matching approved Neon organization. Read and review Neon again.',409)
}
