import { fail, id, integer, one, type Context, type Row } from '../db'
import { appealDetail } from '../appeals'
import { submitMessage, refreshMessages } from './outbound'
import { syncPreferences } from './preferences'
import { requireConnection } from './connection'
import { connectCommand } from './connect'

/** Mango takes one request per donor, Mailchimp several; both stay within one Worker request's budget. */
export const sendBatch = (provider: string) => provider === 'mango' ? 40 : 8
export const appealListName = (appeal: Row) => `Coffer appeal · ${appeal.name} · ${String(appeal.prepared_at).slice(0, 10)}`

export async function marketingCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 const connected=await connectCommand(c,command,p);if(connected)return connected
 if(command==='marketing.sync')return syncPreferences(c)
 if(command==='marketing.refresh')return refreshMessages(c)
 if(command!=='appeal.send')return undefined
 const conn=await requireConnection(c)
 const appealId=id(p.appealId,'Appeal'),version=integer(Number(p.version),'Version',1)
 const {appeal,recipients,consentChanged}=await appealDetail(c,appealId)
 if(appeal.channel!=='email')fail('CHANNEL','Postal appeals use the mailing export.',409)
 if(appeal.version!==version)fail('VERSION','This appeal changed. Refresh before sending.',409)
 if(!['approved','exported','sent'].includes(appeal.status))fail('NOT_APPROVED','A person must approve the appeal before sending.',409)
 if(consentChanged)fail('CONSENT_CHANGED','A recipient’s consent changed. Prepare a new audience.',409)
 const message=await one(c,'SELECT * FROM cf_appeal_messages WHERE appeal_id=?',appealId)
 if(!message)fail('NO_MESSAGE','This appeal has no email subject and message. Prepare it again with both to send by email.',409)
 const waiting=recipients.filter(r=>!r.communication_id),pending=waiting.slice(0,sendBatch(conn.provider))
 let submitted=0,listed=0,suppressed=0,uncertain=0
 for(const r of pending){
  const result=await submitMessage(c,{key:`appeal:${appealId}:${r.donor_id}`,donorId:r.donor_id,sourceKind:'appeal',sourceId:appealId,listName:appealListName(appeal),subject:message.subject,body:message.body,merge:r,...(r.rendered_subject!==null&&r.rendered_subject!==undefined?{rendered:{subject:r.rendered_subject,body:r.rendered_body}}:{}),expectedEmail:r.email,emailType:JSON.parse(appeal.segment).emailType,expectedContactId:r.email_contact_id,expectedContactVersion:r.email_contact_version})
  if(result.status==='submitted')submitted++;else if(result.status==='listed')listed++;else if(result.status==='suppressed')suppressed++;else uncertain++
 }
 return {id:appealId,provider:conn.provider,submitted,listed,suppressed,uncertain,remaining:waiting.length-pending.length}
}
