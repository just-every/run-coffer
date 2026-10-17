import { fail, id, integer, one, type Context, type Row } from '../db'
import { appealDetail } from '../appeals'
import { submitMessage, refreshMessages } from './outbound'
import { syncPreferences } from './preferences'
import { communicationsUnavailable } from './provider'
export async function marketingCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command==='marketing.sync')return syncPreferences(c)
 if(command==='marketing.refresh')return refreshMessages(c)
 if(command!=='appeal.send')return undefined
 const unavailable=communicationsUnavailable(c.env);if(unavailable)fail('MANGO_UNAVAILABLE',unavailable,503)
 const appealId=id(p.appealId,'Appeal'),version=integer(p.version,'Version',1)
 const {appeal,recipients,consentChanged}=await appealDetail(c,appealId)
 if(appeal.channel!=='email')fail('CHANNEL','Postal appeals use the mailing export.',409)
 if(appeal.version!==version)fail('VERSION','This appeal changed. Refresh before sending.',409)
 if(!['approved','exported','sent'].includes(appeal.status))fail('NOT_APPROVED','A person must approve the appeal before sending.',409)
 if(consentChanged)fail('CONSENT_CHANGED','A recipient’s consent changed. Prepare a new audience.',409)
 const message=await one(c,'SELECT * FROM cf_appeal_messages WHERE appeal_id=?',appealId)
 if(!message)fail('NO_MESSAGE','Prepare an appeal with a subject and message to send through Mango.',409)
 const pending=recipients.filter(r=>!r.communication_id).slice(0,8)
 let submitted=0,suppressed=0,uncertain=0
 for(const r of pending){
  const result=await submitMessage(c,{key:`appeal:${appealId}:${r.donor_id}`,donorId:r.donor_id,sourceKind:'appeal',sourceId:appealId,subject:message.subject,body:message.body,merge:r,expectedEmail:r.email})
  if(result.status==='submitted')submitted++;else if(result.status==='suppressed')suppressed++;else uncertain++
 }
 return {id:appealId,submitted,suppressed,uncertain,remaining:Math.max(0,pending.length===8?recipients.filter(r=>!r.communication_id).length-8:0)}
}
