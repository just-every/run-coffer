import type { ParsedImport } from './types'
import type { SourceRow } from './source-rows'

/** Historical source records are neither native billing nor outbound authority. */
export function lglSourceHistory(r:SourceRow,out:ParsedImport,kind:'membership'|'mailing'){
 const prefix=kind==='membership'?'membership':'mailing'
 const sourceId=r.required(prefix+'Id'),donorExternalId=r.required('donorId'),label=r.required(prefix+'Name'),occurredOn=r.date(prefix+'Date'),status=(kind==='membership'?r.get(prefix+'Status'):r.required(prefix+'Status'))||'unknown',notes=r.get(prefix+'Notes')||(kind==='membership'?r.get('note'):'')
 if(label.length>200||status.length>100||notes.length>4000)r.error('SOURCE_HISTORY','Keep the source name, status and notes within 200, 100 and 4000 characters respectively.')
 let payload:Record<string,string|number|null>,details:string
 if(kind==='membership'){
  const expiresOn=r.peek('membershipEnd')?r.date('membershipEnd'):null
  if(expiresOn&&expiresOn<occurredOn)r.error('MEMBERSHIP_DATES','Membership end cannot precede its source start date.','membershipEnd')
  payload={level:label,status,startsOn:occurredOn,expiresOn,notes}
  details=`Source status: ${status}. Starts ${occurredOn}; ends ${expiresOn??'unknown'}. Historical membership only; no renewal billing or new benefit entitlement.${notes?' '+notes:''}`
 }else{
  const channel=r.required('mailingChannel').toLowerCase()
  if(!['email','mail'].includes(channel))r.error('MAILING_CHANNEL','Export mail or email history separately from other source activities.','mailingChannel')
  payload={channel,status,notes}
  details=`Source-reported ${channel} status: ${status}. Historical record only; no message is submitted and no permission is granted.${notes?' '+notes:''}`
 }
 if(sourceId&&donorExternalId&&label&&occurredOn&&status)(out.sourceHistory??=[]).push({externalId:JSON.stringify(kind==='mailing'?[kind,payload.channel,sourceId,donorExternalId]:[kind,sourceId]),sourceId,donorExternalId,kind,label,occurredOn,details,payload,location:r.location})
}
