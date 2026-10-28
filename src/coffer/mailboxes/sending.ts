import { commit, event, fail, guard, id, longText, one, sha256, sql, text, type Context, type Row } from '../db'
import { communicationGuards, communicationReasons } from '../communications/preference-rules'
import { prepareSolicitationRun, solicitationAskStatements, solicitationRunGuards } from '../solicitation'
import { mailboxAccess, mailboxRole, providerChoice } from './connection'
import { send } from './provider'
import { uniqueDonor } from './store'

const live=(row:Row)=>guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.version=? AND d.email=? AND d.erased_at IS NULL AND d.constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id) AND (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)='granted')`,'MAILBOX_RECIPIENT_CHANGED','The constituent, email permission or status changed. Prepare a new message.',row.donor_id,row.donor_version,row.recipient)
export async function preparePersonalMail(c:Context,p:Row) {
 mailboxRole(c)
 const provider=providerChoice(p.provider),auth=await mailboxAccess(c,provider),donorId=id(p.donorId,'Donor'),requestId=id(p.requestId,'Message request')
 const subject=text(p.subject,'Subject',400),body=longText(p.body,'Personal message',4000)
 if(/[\r\n]/.test(subject))fail('INPUT','The subject must be a single line.',400)
 if(!['appeals','newsletter'].includes(p.purpose))fail('INPUT','Classify this message as an ask or a non-ask newsletter or personal message.',400)
 const accountHash=await sha256(auth.row.account),requestKey=await sha256(c.actor.id+'\0'+requestId)
 const previous=await one(c,'SELECT * FROM cf_mailbox_messages WHERE request_key=?',requestKey)
 if(previous){if(previous.donor_id!==donorId||previous.subject!==subject||previous.excerpt!==body||previous.provider!==provider||previous.purpose!==p.purpose)fail('MAILBOX_REPLAY','That request already belongs to a different saved message.',409);return previous}
 const messageId=requestKey+'@'+new URL(c.env!.AUTH_ORIGIN).hostname,key=await sha256(accountHash+'\0'+messageId)
 if(await one(c,'SELECT id FROM cf_mailbox_seen WHERE id=?',key))fail('MAILBOX_REPLAY','That request was already captured or erased. Start a new draft.',409)
 const donor=await one(c,'SELECT * FROM cf_donors WHERE id=?',donorId)
 if(!donor?.email||(await uniqueDonor(c,[donor.email]))?.id!==donorId)fail('MAILBOX_IDENTITY','Personal sending needs one uniquely matched current email identity.',409)
 const row={id:key,donor_id:donorId,donor_version:donor.version,recipient:donor.email}
 await commit(c,[...auth.checks,live(row)])
 const reason=(await communicationReasons(c,[donorId],'email',p.purpose)).get(donorId)
 if(reason)fail('COMMUNICATION_RESTRICTED','This message is excluded: '+reason+'.',409)
 const classification=await prepareSolicitationRun(c,{kind:'mailbox',id:key,channel:'email',isAsk:p.purpose==='appeals',donorIds:[donorId]})
 if(!classification.recipients.length)fail('SOLICITATION_RESTRICTED','This message is excluded: '+(classification.excluded[0]?.reason??'do not solicit')+'.',409)
 await commit(c,[...auth.checks,live(row),...classification.statements,...await communicationGuards(c,[donorId],'email',p.purpose,{kind:'mailbox',id:key}),sql("INSERT INTO cf_mailbox_messages(id,donor_id,operator_id,provider,account_hash,direction,subject,excerpt,occurred_at,recorded_at,state,request_key,recipient,donor_version,purpose,connection_sealed,note) VALUES(?,?,?,?,?,'sent',?,?,?,?,'draft',?,?,?,?,?,'Awaiting your explicit submission.')",key,donorId,c.actor.id,provider,accountHash,subject,body,c.now,c.now,requestKey,donor.email,donor.version,p.purpose,auth.row.grant_id),event(c,'mailbox.prepared','mailbox',key,donorId,{purpose:p.purpose})])
 return (await one(c,'SELECT * FROM cf_mailbox_messages WHERE id=?',key))!
}
export async function submitPersonalMail(c:Context,p:Row) {
 mailboxRole(c)
 if(p.confirm!=='yes')fail('CONFIRMATION_REQUIRED','Confirm this exact personal message before submitting.',400)
 const key=id(p.messageId,'Saved message'),row=await one(c,'SELECT * FROM cf_mailbox_messages WHERE id=? AND operator_id=?',key,c.actor.id)
 if(!row||row.state!=='draft')fail('MAILBOX_REPLAY','This message is already submitted, held or unavailable. Never resend an uncertain message.',409)
 const auth=await mailboxAccess(c,providerChoice(row.provider))
 if(row.connection_sealed!==auth.row.grant_id||row.account_hash!==await sha256(auth.row.account))fail('MAILBOX_CHANGED','The personal mailbox changed. Prepare a new message.',409)
 if((await uniqueDonor(c,[row.recipient]))?.id!==row.donor_id)fail('MAILBOX_IDENTITY','The recipient is no longer a unique current identity.',409)
 await commit(c,[...auth.checks,live(row),...await solicitationRunGuards(c,'mailbox',key,[row.donor_id]),...await communicationGuards(c,[row.donor_id],'email',row.purpose,{kind:'mailbox',id:key}),guard("EXISTS(SELECT 1 FROM cf_mailbox_messages WHERE id=? AND state='draft' AND operator_id=?)",'MAILBOX_REPLAY','The message was already submitted.',key,c.actor.id),...await solicitationAskStatements(c,'mailbox',key,[row.donor_id]),sql('INSERT OR IGNORE INTO cf_mailbox_seen VALUES(?)',key),sql("UPDATE cf_mailbox_messages SET state='sending',note='Submission in progress. Do not resend.' WHERE id=?",key),event(c,'mailbox.submitting','mailbox',key,row.donor_id)])
 try{
  const link=await send(row.provider,auth.token,{from:auth.row.account,to:row.recipient,subject:row.subject,body:row.excerpt,messageId:row.request_key+'@'+new URL(c.env!.AUTH_ORIGIN).hostname})
  await c.db.prepare("UPDATE cf_mailbox_messages SET state='submitted',link=?,note='Submitted to your mailbox provider; delivery is not confirmed.' WHERE id=? AND state='sending'").bind(link,key).run()
 }catch{
  await c.db.prepare("UPDATE cf_mailbox_messages SET state='uncertain',note='Submission was not confirmed. Inspect Sent mail; Coffer will not retry.' WHERE id=? AND state='sending'").bind(key).run()
 }
 return await one(c,'SELECT id,donor_id,state,note FROM cf_mailbox_messages WHERE id=?',key)??{id:key,state:'erased'}
}
