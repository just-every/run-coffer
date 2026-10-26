import { requireRole } from '../auth'
import { ACCESS, execute } from '../commands'
import { commit, fail, guard, object, sql, type Context, type Row } from '../db'
import { giftCommand } from '../gifts'
import { donorCommand } from '../donors'
import { solicitationWriteStatements } from '../solicitation'
import { createCampaign } from '../giving/campaigns'
import type { ApiScope } from './keys'

/** Full means only these reviewed local operations. Never forward arbitrary
 * commands, provider sends, exports, erasure, merges or credential changes. */
export const API_WRITE_ROUTES:Record<string,string>={
 'POST /donors':'donor.create',
 'POST /campaigns':'campaign.create',
 'POST /gifts':'gift.record',
 'POST /pledges':'pledge.create',
 'POST /interactions':'interaction.record',
 'POST /tasks':'task.create',
 'POST /opportunities':'prospect.save',
 'POST /funds':'fund.define',
 'POST /soft-credits':'softCredit.record',
}
export type WriteOperation={command:string;input:Row}
export function writeOperation(method:string,path:string,input:Row):WriteOperation|null{
 const direct=API_WRITE_ROUTES[method+' '+path]
 if(direct)return {command:direct,input}
 const donorPath=path.match(/^\/donors\/([^/]+)$/)
 if(donorPath&&method==='PUT')return {command:'donor.update',input:{...input,donorId:decodeURIComponent(donorPath[1])}}
 let match=path.match(/^\/donors\/([^/]+)\/(solicitation|status|consents)$/)
 if(match){
  const donorId=decodeURIComponent(match[1]),kind=match[2]
  if(kind==='solicitation'&&method==='PUT')return {command:'solicitation.set',input:{...input,donorId}}
  if(kind==='status'&&method==='PUT')return {command:'donor.profile',input:{donorId,version:input.version,constituentStatus:input.constituentStatus,statusReason:input.statusReason,deceasedOn:input.deceasedOn}}
  if(kind==='consents'&&method==='POST')return {command:'consent.record',input:{...input,donorIds:undefined,donorId}}
 }
 match=path.match(/^\/(gifts|soft-credits)\/([^/]+)\/acknowledgment$/)
 if(match&&method==='PUT'){
  const prefix=match[1]==='gifts'?'gift':'softCredit',field=prefix==='gift'?'giftId':'softCreditId'
  const action=input.status==='acknowledged'?'acknowledge':input.status==='not acknowledged'?'resetAcknowledgment':input.status==='do not acknowledge'?'doNotAcknowledge':null
  if(!action)fail('INPUT','Choose acknowledged, not acknowledged or do not acknowledge.',400)
  return {command:prefix+'.'+action,input:{...input,[field]:decodeURIComponent(match[2])}}
 }
 match=path.match(/^\/tasks\/([^/]+)\/(assignment|snooze|completion)$/)
 if(match&&method==='PUT')return {command:'task.'+({assignment:'assign',snooze:'snooze',completion:'complete'} as const)[match[2] as 'assignment'|'snooze'|'completion'],input:{...input,taskId:decodeURIComponent(match[1])}}
 match=path.match(/^\/opportunities\/([^/]+)$/)
 if(match&&method==='PUT')return {command:'prospect.save',input:{...input,id:decodeURIComponent(match[1])}}
 return null
}

export function writeScope(scope:ApiScope,operation:WriteOperation){
 if(scope==='read-only'||scope==='gift-entry'&&operation.command!=='gift.record')fail('SCOPE_FORBIDDEN','This API key does not permit this operation.',403)
}

export async function prepareWrite(c:Context,operation:WriteOperation):Promise<string>{
 if(!c.transactionPlan)fail('ATOMIC_WRITE_REQUIRED','Public API preparation requires an atomic transaction plan.',409)
 const {command,input}=operation,p=object(input)
 const allowed=command==='campaign.create'?['owner','admin'] as const:ACCESS[command]
 if(!allowed)fail('FORBIDDEN','This operation is unavailable.',403)
 requireRole(c.actor,[...allowed],'run '+command)
 for(const field of ['donorId','relatedDonorId','employerDonorId'])if(typeof p[field]==='string'&&p[field])c.transactionPlan.statements.push(guard('EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))','DONOR_CHANGED','Choose a current donor who has not been merged or erased.',p[field]))
 if(command==='interaction.record'&&!['call','meeting','email'].includes(p.kind))fail('INPUT','The public interaction API records calls, meetings and email interactions.',400)
 let result:Row|null|undefined
 if(command==='gift.record'){
  // Published rules may notify a provider after the ledger commits. A replay
  // must not conceal that missing or uncertain side effect or repeat the gift.
  c.transactionPlan.statements.push(guard('NOT EXISTS(SELECT 1 FROM cf_gift_rules WHERE published_at IS NOT NULL)','API_GIFT_RULES','Use native gift entry while published gift rules are active.'))
  result=await giftCommand(c,command,p)
 }else if(command==='solicitation.set'){
  const write=await solicitationWriteStatements(c,p)
  await commit(c,write.statements)
  return write.donorId
 }else if(command==='campaign.create'){
  result=await createCampaign(c,p)
  // The public API creates an inactive draft. Public visibility, checkout and
  // provider operations remain at their native, separately reviewed doors.
  c.transactionPlan!.statements.push(sql('UPDATE cf_campaigns SET active=0 WHERE id=?',result.id))
 }else if(command.startsWith('donor.')){
  result=await execute(c,command,p)
 }else if(command==='consent.record'){
  if(p.channel==='email')fail('API_PROVIDER_EFFECT','Email consent needs the native preference synchronization door.',409)
  result=await donorCommand(c,command,p)
 }else{
  // Reviewed commands above have no network effects. Their existing authority,
  // donor, solicitation and version guards remain in the final transaction.
  result=await execute(c,command,p)
 }
 if(command==='pledge.create'&&result?.id)c.transactionPlan!.statements.push(sql('UPDATE cf_pledges SET api_review_required=1 WHERE id=?',result.id))
 // A few native commands read their projection after committing; that read is
 // intentionally not used while staging. Their audited identifier is stable.
 const audited=c.transactionPlan?.statements.findLast(s=>s.sql.startsWith('INSERT INTO cf_events(')&&s.params[4]===command)
 const resultId=result?.id??(command==='fund.define'?result?.name:undefined)??audited?.params[6]??p.donorId
 if(typeof resultId!=='string'||!resultId)fail('ATOMIC_WRITE_REQUIRED','This operation did not produce an identifier.',409)
 return resultId
}
