import type { ParsedImport } from './types'
import type { SourceRow } from './source-rows'

/** Historical source records are neither native billing nor outbound authority. */
export function lglSourceHistory(r:SourceRow,out:ParsedImport,kind:'membership'|'mailing'){
 const prefix=kind==='membership'?'membership':'mailing'
 const sourceId=r.required(prefix+'Id'),donorExternalId=r.required('donorId'),subject=kind==='mailing'?r.get('mailingSubject'):'',label=kind==='mailing'?r.get('mailingName')||subject:r.required(prefix+'Name'),occurredOn=r.date(prefix+'Date'),status=(kind==='membership'?r.get(prefix+'Status'):r.required(prefix+'Status'))||'unknown',notes=r.get(prefix+'Notes')||(kind==='membership'?r.get('note'):'')
 if(!label)r.error('REQUIRED','Supply the source mailing name or subject.','mailingName')
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
  const content=r.verbatim('mailingContent'),template=r.get('mailingTemplate'),recipientName=r.verbatim('mailingRecipientName'),recipientEmail=r.get('mailingRecipientEmail'),recipientAddress=r.verbatim('mailingRecipientAddress'),sentOn=r.peek('mailingSentOn')?r.date('mailingSentOn'):null
  if(subject.length>200||template.length>200||content.length>16000||recipientName.length>200||recipientAddress.length>2000)r.error('MAILING_CONTENT','Mailing subject, template and recipient name hold up to 200 characters, address 2000 and content 16000. Export larger source documents separately.')
  if(recipientEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail))r.error('MAILING_RECIPIENT','Export one valid source recipient email. It remains historical evidence, never a current contact or permission.','mailingRecipientEmail')
  // Recipient snapshots and message content stay in the manager-only source
  // review, not in the ordinary staff timeline or the current contact set.
  if(subject||content||template||recipientName||recipientEmail||recipientAddress||sentOn){Object.assign(payload,{subject:subject||null,content:content||null,template:template||null,sentOn,recipientName:recipientName||null,recipientEmail:recipientEmail||null,recipientAddress:recipientAddress||null});details+=[subject&&`Subject: ${subject}`,template&&`Template: ${template}`,sentOn&&`Source sent date: ${sentOn}`].filter(Boolean).map(v=>' '+v).join('')}
 }
 if(sourceId&&donorExternalId&&label&&occurredOn&&status)(out.sourceHistory??=[]).push({externalId:JSON.stringify(kind==='mailing'?[kind,payload.channel,sourceId,donorExternalId]:[kind,sourceId]),sourceId,donorExternalId,kind,label,occurredOn,details,payload,location:r.location})
}
