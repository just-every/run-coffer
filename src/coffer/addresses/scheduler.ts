import type { Bindings } from '../../auth.server'
import { all, commit, event, guard, one, sql, today, type Context, type Row, type Stmt } from '../db'
import { stageAddressMove } from '../address-history'
import { settings } from '../settings'
import { runMelissaSmartMover } from './providers/melissa.server'
import { verifySmartyAddress } from './providers/smarty.server'
import { addressFingerprint, addressProcessing, checkStatement, postalAddress } from './state'

const isLive=(id:string,version:number)=>guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','ADDRESS_CHANGED','A donor changed during the address pass. Prepare a new pass.',id,version,id)
async function finish(c:Context,runId:string,state:string,reason:string) {
 await commit(c,[sql("UPDATE cf_ncoa_runs SET state=?,reason=?,completed_at=? WHERE id=? AND state IN('queued','processing')",state,reason,c.now,runId),event(c,'address.ncoaOutcome','ncoa_run',runId,null,{state,reason})])
}
/** Cron processes one real licensee batch per tick. An interrupted claim is
 * held uncertain after five minutes; it is never submitted a second time. */
export async function advanceNcoa(env:Bindings,at:Date) {
 const c:Context={db:env.DB,env,now:at.toISOString(),actor:{id:'coffer-scheduler',name:'Address scheduler',role:'owner'},authority:{sql:'EXISTS(SELECT 1 FROM cf_address_processing WHERE id=1 AND enabled=1)',params:[]}}
 const connection=await addressProcessing(c)
 if(!connection.enabled)return {processed:0}
 const interrupted=await all(c,"SELECT id FROM cf_ncoa_runs WHERE state='processing' AND claimed_at<?",new Date(at.getTime()-5*60000).toISOString())
 for(const job of interrupted)await finish(c,job.id,'uncertain','A provider request was interrupted. Review the licensee job before preparing another pass.')
 const run=await one(c,"SELECT * FROM cf_ncoa_runs WHERE state='queued' ORDER BY created_at,id LIMIT 1")
 if(!run)return {processed:0}
 if(run.connection_version!==connection.version){await finish(c,run.id,'cancelled','Address processing changed.');return {processed:0}}
 const members=await all(c,`SELECT m.*,d.* FROM cf_ncoa_members m JOIN cf_donors d ON d.id=m.donor_id WHERE m.run_id=? AND m.ordinal>=? AND m.ordinal<? ORDER BY m.ordinal,d.id`,run.id,run.processed,run.processed+100)
 if(!members.length){await finish(c,run.id,'failed','The address list is no longer complete.');return {processed:0}}
 const fingerprints=await Promise.all(members.map(addressFingerprint))
 if(members.some((m,i)=>m.erased_at||m.fingerprint!==fingerprints[i]||m.constituent_status!=='active')||await one(c,'SELECT 1 FROM cf_donor_merges WHERE donor_id IN (SELECT donor_id FROM cf_ncoa_members WHERE run_id=?) LIMIT 1',run.id)){
  await finish(c,run.id,'failed','A donor or address changed after the pass was prepared. Prepare a new pass.');return {processed:0}
 }
 const unique=new Map<number,Row>()
 for(const member of members)if(!unique.has(member.ordinal))unique.set(member.ordinal,member)
 try{await commit(c,[guard("EXISTS(SELECT 1 FROM cf_ncoa_runs WHERE id=? AND state='queued' AND processed=? AND connection_version=?)",'NCOA_CLAIMED','Another scheduler already claimed this batch.',run.id,run.processed,connection.version),...members.map(m=>isLive(m.id,m.version)),sql("UPDATE cf_ncoa_runs SET state='processing',claimed_at=? WHERE id=?",c.now,run.id)])}catch{return {processed:0}}
 const result=await runMelissaSmartMover({records:[...unique.values()].map(d=>({identity:{id:d.id,name:d.name,kind:d.constituent_kind},address:postalAddress(d)})),customerId:env.MELISSA_SMARTMOVER_KEY??'',jobId:run.id,executionId:`${run.id}-${run.processed}`,transmissionReference:`${run.id}-${run.processed}`,pafConfirmed:Boolean(connection.paf_reference),listSize:run.total})
 if(result.status==='error'&&result.reason==='paf_required'){
  await commit(c,[sql("UPDATE cf_ncoa_runs SET state='failed',reason='paf_required',completed_at=? WHERE id=?",c.now,run.id),sql('UPDATE cf_address_processing SET enabled=0,version=version+1 WHERE id=1'),sql("UPDATE cf_ncoa_runs SET state='cancelled',reason='paf_required' WHERE state IN('queued','processing')"),event(c,'address.pafRefused','address_processing','1',null,{runId:run.id,reason:'paf_required'})])
  return {processed:0}
 }
 if(result.status==='error'){await finish(c,run.id,'failed',`The NCOA licensee ${({not_configured:'needs its private account credentials checked',invalid_request:'could not process this list',network_error:'could not be reached',http_error:'refused or could not complete the request',invalid_response:'returned an incomplete or mismatched result',provider_error:'reported a processing error',paf_required:'requires a current signed PAF',list_too_small:'requires at least 100 genuine unique names and addresses'} as Record<string,string>)[result.reason]}. No address in this batch changed.`);return {processed:0}}
 const byId=new Map(result.results.map(r=>[r.id,r])),day=today((await settings(c)).timezone,at),statements:Stmt[]=[]
 for(const [ordinal,representative] of unique){
  const r=byId.get(representative.id)!,group=members.filter(m=>m.ordinal===ordinal)
  let verified
  if(r.status!=='undeliverable'&&r.status!=='needs_review')verified=await verifySmartyAddress({address:r.address??postalAddress(representative),identity:{id:representative.id,name:representative.name,kind:representative.constituent_kind},authId:env.SMARTY_AUTH_ID??'',authToken:env.SMARTY_AUTH_TOKEN??''})
  if(verified?.status==='error'){await finish(c,run.id,'failed','Smarty could not confirm the licensee batch. No address in this batch changed.');return {processed:0}}
  for(const d of group){
   statements.push(isLive(d.id,d.version))
   const address=verified?.status==='verified'?verified.address:undefined
   const updated=address?{...d,address_line1:address.street,address_line2:address.street2??null,city:address.city,region:address.state,postal_code:address.postalCode,country:address.country}:d
   if(address&&await addressFingerprint(updated)!==await addressFingerprint(d))statements.push(...stageAddressMove(d.id,day,'ncoa'),sql('UPDATE cf_donors SET version=version+1,address_line1=?,address_line2=?,city=?,region=?,postal_code=?,country=? WHERE id=?',updated.address_line1,updated.address_line2,updated.city,updated.region,updated.postal_code,updated.country,d.id),sql('DELETE FROM cf_address_moves WHERE donor_id=?',d.id))
   const check=r.status==='undeliverable'?{status:'undeliverable' as const,reason:'no_match' as const,providerCodes:r.providerCodes}:verified??{status:'unverified' as const,reason:'incomplete_confirmation' as const,providerCodes:r.providerCodes}
   statements.push(checkStatement(d.id,await addressFingerprint(updated),check,c.now,'ncoa',r.moveEffectiveMonth??null),sql('UPDATE cf_ncoa_members SET processed_at=?,result=?,fingerprint=? WHERE run_id=? AND donor_id=?',c.now,r.status,await addressFingerprint(updated),run.id,d.id),event(c,'address.ncoa','donor',d.id,d.id,{result:r.status,source:'ncoa',moveEffectiveMonth:r.moveEffectiveMonth??null,observedOn:day}))
  }
 }
 const processed=run.processed+unique.size,completed=processed===run.total
 try{await commit(c,[guard("EXISTS(SELECT 1 FROM cf_address_processing WHERE id=1 AND enabled=1 AND version=?) AND EXISTS(SELECT 1 FROM cf_ncoa_runs WHERE id=? AND state='processing' AND processed=?)",'ADDRESS_CONNECTION_CHANGED','Address processing changed while the provider worked.',connection.version,run.id,run.processed),...statements,sql("UPDATE cf_ncoa_runs SET processed=?,state=?,completed_at=?,claimed_at=NULL WHERE id=?",processed,completed?'completed':'queued',completed?c.now:null,run.id),event(c,'address.ncoaBatch','ncoa_run',run.id,null,{processed:unique.size,completed})])}catch{await finish(c,run.id,'failed','A donor changed while the provider worked. No address in this batch changed.');return {processed:0}}
 return {processed:unique.size,completed}
}
