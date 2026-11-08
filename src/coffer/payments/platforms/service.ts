import { manager } from '../../auth'
import { all, commit, event, fail, guard, id, integer, one, sha256, sql, today, type Context, type Row, type Stmt } from '../../db'
import { erasureHash } from '../../imports/snapshots'
import { settings } from '../../settings'
import { currentDonors, emailCandidates, donorMatchView, matchGuards } from '../donor-match'
import { parseBenevity } from './benevity'

const installation=(c:Context)=>c.env?.RER_INSTALLATION_ID||c.env?.AUTH_ORIGIN
function authorize(c:Context){if(!manager(c.actor))fail('manager_required','Only the owner or an admin reviews disbursements.',403)}
const candidateGuard=(mail:string,candidates:Row[])=>guard(`(SELECT json_group_array(json_object('id',id,'version',version)) FROM (${currentDonors}))=?`,'MATCH_CHANGED','Matching donors changed.',mail,JSON.stringify(candidates))
const batchGuard=(batch:Row)=>guard(`EXISTS(SELECT 1 FROM cf_platform_batches WHERE id=? AND version=? AND fingerprint=? AND state='review' AND installation_id=?)`,'BATCH_CHANGED','This batch changed. Refresh its exact review.',batch.id,batch.version,batch.fingerprint,batch.installation_id)
export async function platformBatch(c:Context,batchId:string):Promise<Row>{
 authorize(c)
 const batch=await one(c,'SELECT * FROM cf_platform_batches WHERE id=?',batchId)
 if(!batch)fail('NOT_FOUND','That disbursement is unavailable.',404)
 const rows=await all(c,'SELECT * FROM cf_platform_sources WHERE batch_id=? ORDER BY row_number',batchId)
 return {...batch,mapping:JSON.parse(batch.mapping),controls:JSON.parse(batch.controls),issues:JSON.parse(batch.issues),rows:await Promise.all(rows.map(async row=>({...row,review:await donorMatchView(c,row.source_id)})))}
}
export async function platformBatches(c:Context){authorize(c);return {batches:await all(c,'SELECT id,state,created_at FROM cf_platform_batches ORDER BY created_at DESC,id')}}
export async function previewPlatform(c:Context,input:Row){
 authorize(c)
 const parsed=await parseBenevity(input),key='benevity-batch-'+await sha256(parsed.fingerprint),home=installation(c)
 const replay=await one(c,'SELECT * FROM cf_platform_batches WHERE id=?',key)
 if(replay){await commit(c,[]);return platformBatch(c,key)}
 const issues=[...parsed.issues],s=await settings(c)
 for(const row of parsed.records){
  if(row.facts.date>today(s.timezone,new Date(c.now)))issues.push(`Row ${row.rowNumber}: The contribution date is in the future.`)
  if(!await one(c,'SELECT name FROM cf_funds WHERE name=?',row.facts.fund))issues.push(`Row ${row.rowNumber}: Choose an existing fund from the source.`)
  if(row.facts.campaign&&!await one(c,'SELECT id FROM cf_campaigns WHERE id=? AND fund=?',row.facts.campaign,row.facts.fund))issues.push(`Row ${row.rowNumber}: The campaign does not exist on this fund.`)
 }
 const existing=await one(c,'SELECT * FROM cf_platform_batches WHERE source_key=?',parsed.batchKey)
 if(existing){
  // Byte-identical upload with changed interpretation is never a new batch.
  if(existing.fingerprint!==parsed.fingerprint)fail('SOURCE_CONFLICT','This disbursement already has different source facts or column mapping. Changed disbursements remain held.')
  return platformBatch(c,existing.id)
 }
 const statements:Stmt[]=[guard('NOT EXISTS(SELECT 1 FROM cf_platform_batches WHERE id=? OR source_key=?)','SOURCE_CONFLICT','This upload was reviewed concurrently. Open its saved review.',key,parsed.batchKey)]
 if(!issues.length){
  for(const row of parsed.records){
   const prior=await one(c,'SELECT * FROM cf_platform_sources WHERE source_id=?',row.id)
   if(prior)fail('SOURCE_CONFLICT','A transaction already belongs to an uploaded disbursement. No money was changed.')
   const erased=await one(c,'SELECT hash FROM cf_erasures WHERE hash=?',erasureHash(row.facts.email))
   if(erased)issues.push(`Row ${row.rowNumber}: Source identity was erased and cannot be imported.`)
   row.candidates=await emailCandidates(c,row.facts.email)
  }
 }
 const valid=issues.length===0
 statements.push(sql(`INSERT INTO cf_platform_batches(id,installation_id,provider,fingerprint,file_hash,source_key,state,source_csv,mapping,controls,issues,created_at)
 VALUES(?,?,'benevity',?,?,?,?,?,?,?,?,?)`,key,home,parsed.fingerprint,parsed.fileHash,valid?parsed.batchKey:null,valid?'review':'held',valid?parsed.csv:null,JSON.stringify(parsed.mapping),JSON.stringify(parsed.controls),JSON.stringify(issues),c.now))
 if(valid)for(const row of parsed.records){
  statements.push(
   guard('NOT EXISTS(SELECT 1 FROM cf_platform_sources WHERE source_id=?)','SOURCE_CONFLICT','This source transaction already exists.',row.id),
   sql(`INSERT INTO cf_payment_donor_matches(charge_id,installation_id,account_id,state,email,facts,candidates,created_at,updated_at,provider)
    VALUES(?,?,?,'held',?,?,?,?,?,'benevity')`,row.id,home,parsed.batchKey,row.facts.email,JSON.stringify(row.facts),JSON.stringify(row.candidates),c.now,c.now),
   sql('INSERT INTO cf_platform_sources(source_id,batch_id,facts_hash,row_number,evidence) VALUES(?,?,?,?,?)',row.id,key,row.factsHash,row.rowNumber,row.evidence))
 }
 statements.push(event(c,'payments.platformPreview','platformBatch',key,null,{rows:parsed.records.length,held:!valid}))
 await commit(c,statements)
 return platformBatch(c,key)
}
export async function refreshPlatformMatch(c:Context,sourceId:string){
 authorize(c)
 const row=await one(c,"SELECT * FROM cf_payment_donor_matches WHERE charge_id=? AND provider='benevity'",sourceId)
 if(!row||row.state==='erased')fail('MATCH_CHANGED','This source cannot be assigned.')
 if(row.state==='resolved')return donorMatchView(c,sourceId)
 if(row.installation_id!==installation(c))fail('MATCH_ACCOUNT_CHANGED','Restore preserves evidence; a different installation cannot approve this source.')
 const candidates=await emailCandidates(c,row.email)
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_payment_donor_matches WHERE charge_id=? AND version=?)','MATCH_CHANGED','This review changed.',sourceId,row.version),
  sql('UPDATE cf_platform_batches SET version=version+1 WHERE id=(SELECT batch_id FROM cf_platform_sources WHERE source_id=?)',sourceId),
  sql("UPDATE cf_payment_donor_matches SET state='held',version=version+1,candidates=?,donor_id=NULL,donor_version=NULL,approved_by=NULL,approved_actor_version=NULL,approved_version=NULL,approved_at=NULL,updated_at=? WHERE charge_id=?",JSON.stringify(candidates),c.now,sourceId)])
 return donorMatchView(c,sourceId)
}
export async function selectPlatformDonor(c:Context,sourceId:string,input:Row){
 authorize(c)
 const row=await one(c,"SELECT * FROM cf_payment_donor_matches WHERE charge_id=? AND provider='benevity'",sourceId)
 if(!row||row.state==='erased')fail('MATCH_CHANGED','This source cannot be assigned.')
 const version=integer(Number(input.version),'Review version',1),donorId=id(input.donorId,'Donor'),donorVersion=integer(Number(input.donorVersion),'Donor version',1)
 if(input.confirm!=='yes')fail('confirmation_required','Confirm this exact donor assignment.',400)
 if(row.installation_id!==installation(c))fail('MATCH_ACCOUNT_CHANGED','This source belongs to another installation.')
 const candidates=await emailCandidates(c,row.email)
 if(row.candidates!==JSON.stringify(candidates)||!candidates.some(d=>d.id===donorId&&d.version===donorVersion))fail('MATCH_CHANGED','Donor identities changed. Refresh and select a current candidate.')
 if(row.state==='resolved'||row.state==='approved'){
  if(row.donor_id!==donorId||row.approved_version!==version)fail('MATCH_CHANGED','This source already has another decision.')
  await commit(c,matchGuards({...row,state:'approved'}).filter(()=>row.state==='approved'))
  return donorMatchView(c,sourceId)
 }
 const approver=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id)
 await commit(c,[guard("EXISTS(SELECT 1 FROM cf_payment_donor_matches WHERE charge_id=? AND version=? AND state='held')",'MATCH_CHANGED','This source review changed.',sourceId,version),
  candidateGuard(row.email,candidates),
  sql('UPDATE cf_platform_batches SET version=version+1 WHERE id=(SELECT batch_id FROM cf_platform_sources WHERE source_id=?)',sourceId),
  guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','MATCH_CHANGED','The donor changed.',donorId,donorVersion,donorId),
  sql("UPDATE cf_payment_donor_matches SET state='approved',donor_id=?,donor_version=?,approved_version=?,approved_by=?,approved_actor_version=?,approved_at=?,version=version+1,updated_at=? WHERE charge_id=?",donorId,donorVersion,version,c.actor.id,approver?.version,c.now,c.now,sourceId),
  event(c,'payments.donorMatchApproved','payment',sourceId,donorId,{provider:'benevity',reviewVersion:version})])
 return donorMatchView(c,sourceId)
}
export async function approvePlatformBatch(c:Context,batchId:string,input:Row){
 authorize(c)
 const batch=await platformBatch(c,batchId)
 if(batch.installation_id!==installation(c))fail('BATCH_CHANGED','This source belongs to another installation.')
 if(input.confirm!=='yes'||input.fingerprint!==batch.fingerprint||Number(input.version)!==batch.version)fail('BATCH_CHANGED','Approve the exact current batch and fingerprint.')
 if(batch.state==='recorded'){await commit(c,[]);return batch}
 if(batch.state!=='review'||batch.issues.length||!batch.rows.length)fail('BATCH_HELD','Correct the held source facts before approval.')
 const statements:Stmt[]=[batchGuard(batch)],payoutId='benevity-payout-'+await sha256(batch.source_key)
 const totals={gross:0,fee:0,net:0}
 for(const source of batch.rows){
  const row=(await one(c,'SELECT * FROM cf_payment_donor_matches WHERE charge_id=?',source.source_id))!,facts=JSON.parse(row.facts),giftId='platform-gift-'+source.source_id,entryId='platform-entry-'+source.source_id
  if(row.provider!=='benevity'||row.state!=='approved'||!row.donor_id||source.facts_hash!==await sha256(JSON.stringify(facts)))fail('BATCH_HELD','Every source needs its exact current donor selection before money is recorded.')
  if(row.candidates!==JSON.stringify(await emailCandidates(c,row.email)))fail('MATCH_CHANGED','Matching donors changed. Refresh the source selection.')
  statements.push(...matchGuards(row),candidateGuard(row.email,JSON.parse(row.candidates)),guard('EXISTS(SELECT 1 FROM cf_platform_sources WHERE source_id=? AND batch_id=? AND facts_hash=? AND gift_id IS NULL)','SOURCE_CONFLICT','This source changed or was recorded.',source.source_id,batch.id,source.facts_hash),
   guard('EXISTS(SELECT 1 FROM cf_funds WHERE name=?)','PROVENANCE','The source fund is unavailable.',facts.fund),
   sql(`INSERT INTO cf_gifts(id,version,donor_id,kind,received_on,amount_cents,method,reference,fund,goods,goods_cents,source,created_at,created_by)
   VALUES(?,1,?,'gift',?,?,'bank transfer',?,?,'none',0,'benevity',?,?)`,giftId,row.donor_id,facts.date,facts.amount,source.source_id,facts.fund,c.now,c.actor.name),
   sql(`INSERT INTO cf_payment_entries(id,source_id,charge_id,kind,amount_cents,fee_cents,net_cents,fund,gift_id,currency,received_on,created_at)
   VALUES(?,?,NULL,'charge',?,?,?,?,?,'usd',?,?)`,entryId,source.source_id,facts.amount,facts.fee,facts.net,facts.fund,giftId,facts.date,c.now),
   sql('UPDATE cf_platform_sources SET gift_id=? WHERE source_id=?',giftId,source.source_id),
   sql("UPDATE cf_payment_donor_matches SET state='resolved',version=version+1 WHERE charge_id=?",source.source_id),
   event(c,'payments.platformGift','gift',giftId,row.donor_id,{provider:'benevity',batchId:batch.id,amountCents:facts.amount,feeCents:facts.fee}))
  if(facts.campaign)statements.push(guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND fund=?)','PROVENANCE','The source campaign changed.',facts.campaign,facts.fund),sql('INSERT INTO cf_campaign_gifts(gift_id,campaign_id) VALUES(?,?)',giftId,facts.campaign))
  if(facts.acknowledged!=='unknown')statements.push(sql(`INSERT INTO cf_gift_acknowledgments(gift_id,status,acknowledged_on,method,source,updated_at,updated_by,updated_by_id,updated_by_role)
   VALUES(?,?,?,?,'Benevity source report',?,?,?,?)`,giftId,facts.acknowledged,facts.ackDate,facts.ackMethod,c.now,c.actor.name,c.actor.id,c.actor.role))
  totals.gross+=facts.amount;totals.fee+=facts.fee;totals.net+=facts.net
 }
 if(totals.gross!==batch.controls.gross||totals.fee!==batch.controls.fee||totals.net!==batch.controls.net)fail('BATCH_HELD','The exact source control totals do not reconcile.')
 statements.push(sql("INSERT INTO cf_payouts(id,status,arrival_on,amount_cents,currency,automatic,complete,updated_at) VALUES(?,'paid',?,?,'usd',0,1,?)",payoutId,batch.controls.arrivalOn,totals.net,c.now))
 for(const source of batch.rows)statements.push(sql('INSERT INTO cf_payout_entries(entry_id,payout_id) VALUES(?,?)','platform-entry-'+source.source_id,payoutId))
 statements.push(sql("UPDATE cf_platform_batches SET state='recorded',payout_id=?,approved_by=?,approved_at=? WHERE id=?",payoutId,c.actor.id,c.now,batch.id),event(c,'payments.platformBatchApproved','platformBatch',batch.id,null,{...totals,payoutId}))
 await commit(c,statements)
 return platformBatch(c,batchId)
}
