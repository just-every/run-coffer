import { normalizeLabel } from './source-columns'
import type { SourceRow } from './source-rows'
import type { ImportSource, ParsedImport, ParseInput, ParsedSolicitation, ParsedWithdrawal, SolicitCodeRule } from './types'

const channels = ['email','mail','phone','sms']
const known:Record<string,SolicitCodeRule|{withdraw:'email'|'mail'|'phone'|'sms'}> = {
 donotsolicit:{type:'stop'}, nosolicitation:{type:'stop'}, nosolicitations:{type:'stop'}, nosolicit:{type:'stop'},
 donotmail:{withdraw:'mail'}, nomail:{withdraw:'mail'}, donotcall:{withdraw:'phone'}, nocalls:{withdraw:'phone'},
 donotemail:{withdraw:'email'}, noemail:{withdraw:'email'}, donottext:{withdraw:'sms'}, nosms:{withdraw:'sms'},
}
const same = (a:unknown,b:unknown) => JSON.stringify(a)===JSON.stringify(b)

export const restrictionCodes = (raw:string,configured:ParseInput['solicitCodes']) =>
 [...new Set((configured&&Object.hasOwn(configured,raw)?[raw]:raw.split(/[;,|\r\n]+/)).map(s=>s.trim()).filter(Boolean))].sort()

export function restrictionRule(code:string,source:ImportSource,configured:ParseInput['solicitCodes']) {
 const label=normalizeLabel(code)
 return configured&&Object.hasOwn(configured,code)?configured[code]:source!=='re-nxt'&&Object.hasOwn(known,label)?known[label]:undefined
}

/** Known incumbent communication restrictions have exact meanings. NXT's
 * organization-defined codes always require a reviewed explicit dictionary. */
export function sourceRestrictions(r:SourceRow,out:ParsedImport,input:ParseInput) {
 const raw=r.get('communicationRestrictions'), donorExternalId=r.get('donorId')
 if(!raw)return
 if(!donorExternalId){r.error('SOLICITATION_DONOR','Restriction needs a constituent ID.','donorId');return}
 const sourceOn=r.peek('restrictionDate')?r.date('restrictionDate'):''
 const codes=restrictionCodes(raw,input.solicitCodes)
 let stop=false,limit:number|null=null
 const restricted=new Set<string>(),withdrawals=new Set<'email'|'mail'|'phone'|'sms'>()
 const configured=input.solicitCodes??{}
 if(typeof configured!=='object'||Array.isArray(configured)){r.error('SOLICITATION_MAPPING','Supply an explicit solicit-code mapping object.');return}
 if(Object.keys(configured).length>200){r.error('SOLICITATION_MAPPING','Use at most 200 configured solicit codes.');return}
 for(const code of codes) {
  const mapping=restrictionRule(code,out.source,configured)
  if(!mapping) {
   r.error('SOLICITATION_CODE',`Map communication code “${code}” explicitly before importing; its restriction cannot be guessed.`,'communicationRestrictions');continue
  }
  if(typeof mapping!=='object'||mapping===null){r.error('SOLICITATION_MAPPING',`Invalid mapping for “${code}”.`);continue}
  if('withdraw' in mapping){withdrawals.add(mapping.withdraw);continue}
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
