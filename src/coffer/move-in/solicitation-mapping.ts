import { normalizeLabel } from './source-columns'
import type { SourceRow } from './source-rows'
import type { ParsedImport, ParseInput, ParsedSolicitation, ParsedWithdrawal, SolicitCodeRule } from './types'

const channels = ['email','mail','phone','sms']
const known:Record<string,SolicitCodeRule> = {
 donotsolicit:{type:'stop'}, nosolicitation:{type:'stop'}, nosolicitations:{type:'stop'}, nosolicit:{type:'stop'},
 donotmail:{type:'withdraw',channels:['mail']}, nomail:{type:'withdraw',channels:['mail']}, donotcall:{type:'withdraw',channels:['phone']}, nocalls:{type:'withdraw',channels:['phone']},
 donotemail:{type:'withdraw',channels:['email']}, noemail:{type:'withdraw',channels:['email']}, donottext:{type:'withdraw',channels:['sms']}, nosms:{type:'withdraw',channels:['sms']},
}
const same = (a:unknown,b:unknown) => JSON.stringify(a)===JSON.stringify(b)

/** Known incumbent communication restrictions have exact meanings. NXT's
 * organization-defined codes always require a reviewed explicit dictionary. */
export function sourceRestrictions(r:SourceRow,out:ParsedImport,input:ParseInput) {
 const raw=r.get('communicationRestrictions'), donorExternalId=r.get('donorId')
 if(!raw)return
 if(!donorExternalId){r.error('SOLICITATION_DONOR','Restriction needs a constituent ID.','donorId');return}
 const sourceOn=r.peek('restrictionDate')?r.date('restrictionDate'):''
 const codes=[...new Set((input.solicitCodes&&Object.hasOwn(input.solicitCodes,raw)?[raw]:raw.split(/[;,|\r\n]+/)).map(s=>s.trim()).filter(Boolean))].sort()
 let stop=false,limit:number|null=null
 const restricted=new Set<string>(),withdrawals=new Set<'email'|'mail'|'phone'|'sms'>()
 const configured=input.solicitCodes??{}
 if(typeof configured!=='object'||Array.isArray(configured)){r.error('SOLICITATION_MAPPING','Supply an explicit solicit-code mapping object.');return}
 if(Object.keys(configured).length>200){r.error('SOLICITATION_MAPPING','Use at most 200 configured solicit codes.');return}
 for(const code of codes) {
  const key=normalizeLabel(code)
  const mapping=Object.hasOwn(configured,code)?configured[code]:out.source!=='re-nxt'&&Object.hasOwn(known,key)?known[key]:undefined
  if(!mapping) {
   r.error('SOLICITATION_CODE',`Map communication code “${code}” explicitly before importing; its restriction cannot be guessed.`,'communicationRestrictions');continue
  }
  if(typeof mapping!=='object'||mapping===null){r.error('SOLICITATION_MAPPING',`Invalid mapping for “${code}”.`);continue}
  out.solicitCodes??={};out.solicitCodes[code]=mapping
  if(mapping.type==='withdraw') {
   if(!Array.isArray(mapping.channels)||!mapping.channels.length||mapping.channels.some(c=>!channels.includes(c)))r.error('SOLICITATION_MAPPING',`Choose valid withdrawal channels for “${code}”.`)
   else mapping.channels.forEach(c=>withdrawals.add(c))
   continue
  }
  if(mapping.type==='tag') {
   if(typeof mapping.tag!=='string'||!mapping.tag.trim()||mapping.tag.length>100)r.error('SOLICITATION_MAPPING',`Choose a tag of at most 100 characters for “${code}”.`)
   else {
    out.codeTags??=[]
    const tag=mapping.tag.trim(),externalId=JSON.stringify(['tag',donorExternalId,tag])
    if(!out.codeTags.some(t=>t.externalId===externalId))out.codeTags.push({location:r.location,externalId,donorExternalId,tag,codes:[code]})
   }
   continue
  }
  if(!['stop','channels','limit','ignore'].includes(mapping.type)){r.error('SOLICITATION_MAPPING',`Invalid mapping for “${code}”.`);continue}
  if(mapping.type==='stop')stop=true
  if(mapping.type==='channels') {
   if(!Array.isArray(mapping.channels)||!mapping.channels.length||mapping.channels.some(c=>!channels.includes(c)))r.error('SOLICITATION_MAPPING',`Choose valid restricted channels for “${code}”.`)
   else mapping.channels.forEach(c=>restricted.add(c))
  }
  if(mapping.type==='limit') {
   if(!Number.isSafeInteger(mapping.maxAsks)||mapping.maxAsks!<1||mapping.maxAsks!>10000)r.error('SOLICITATION_MAPPING',`Rolling 12-month limit for “${code}” must be a positive whole number up to 10,000.`)
   else limit=limit===null?mapping.maxAsks!:Math.min(limit,mapping.maxAsks!)
  }
 }
 if(!stop&&restricted.size&&limit!==null){r.error('SOLICITATION_COMBINATION','A channel restriction plus a rolling 12-month limit needs a staff review; one must not silently replace the other.');return}
 out.solicitations??=[];out.channelWithdrawals??=[]
 if(stop||restricted.size||limit!==null) {
  const row:ParsedSolicitation={location:r.location,externalId:`solicitation:${donorExternalId}`,donorExternalId,type:stop?'stop':restricted.size?'channels':'limit',channels:stop?[]:[...restricted].sort(),maxAsks:stop||restricted.size?null:limit,sourceOn,codes}
  const prior=out.solicitations.find(s=>s.externalId===row.externalId)
  if(prior&&!same({...prior,location:null},{...row,location:null}))r.error('SOLICITATION_CONFLICT',`Constituent ${donorExternalId} has conflicting restriction rows.`)
  else if(!prior)out.solicitations.push(row)
 }
 for(const channel of withdrawals) {
  const row:ParsedWithdrawal={location:r.location,externalId:`withdrawal:${channel}:${donorExternalId}`,donorExternalId,channel,sourceOn,codes}
  const prior=out.channelWithdrawals.find(s=>s.externalId===row.externalId)
  if(prior&&!same({...prior,location:null},{...row,location:null}))r.error('SOLICITATION_CONFLICT',`Constituent ${donorExternalId} has conflicting ${channel} withdrawal rows.`)
  else if(!prior)out.channelWithdrawals.push(row)
 }
}
