import { requireRole } from './auth'
import { customAllowed, customMerge } from './custom-fields'
import { all, commit, event, fail, guard, integer, longText, one, sql, text, today, type Context, type Row } from './db'
import { letterRecipient } from './organizations'
import { pledgeHistory } from './pledges'
import { LETTER, checkTemplate, longDate, settings } from './settings'
import { recipientMergeFields, renderTemplate } from './template-fields'
import { PLEDGE_CONTEXT_FIELDS, PLEDGE_REQUIRED } from './merge-field-catalog'
import { usd } from './money'

export const pledgeTemplateFields=(c:{db:D1Database})=>customAllowed(c,[...LETTER,...PLEDGE_CONTEXT_FIELDS])
export async function pledgeTemplate(c:{db:D1Database}){const row=await one(c,'SELECT * FROM cf_pledge_template WHERE id=1');if(!row)fail('STORAGE','Apply the pledge-template migration before preparing reminders.',503);return row}
export async function pledgeTemplateCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command!=='pledgeTemplate.save')return
 requireRole(c.actor,['owner','admin'],'review pledge reminder wording')
 const version=integer(Number(p.version),'Template version',1),subject=text(p.subject,'Subject',200),body=longText(p.body,'Pledge reminder',8000),fields=await pledgeTemplateFields(c)
 checkTemplate(subject,'Reminder subject',fields,[]);checkTemplate(body,'Pledge reminder',fields,PLEDGE_REQUIRED)
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_pledge_template WHERE id=1 AND version=?)','VERSION','Reminder wording changed. Open the current template.',version),
  sql('INSERT OR IGNORE INTO cf_pledge_template_versions SELECT version,subject,body,reviewed_at,reviewed_by FROM cf_pledge_template WHERE id=1'),
  sql('UPDATE cf_pledge_template SET version=version+1,subject=?,body=?,reviewed_at=?,reviewed_by=? WHERE id=1',subject,body,c.now,c.actor.name),
  sql('INSERT INTO cf_pledge_template_versions SELECT version,subject,body,reviewed_at,reviewed_by FROM cf_pledge_template WHERE id=1'),event(c,command,'settings','pledge-template',null,{version:version+1})])
 return {version:version+1}
}
export async function renderPledgeReminder(c:Context,i:Row,options:{emailType?:string;interactionId?:string}={}){
 const [d,t,s,pledges]=await Promise.all([one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL',i.donor_id),pledgeTemplate(c),settings(c),pledgeHistory(c,i.donor_id)])
 if(!d)fail('DONOR_CHANGED','The pledge recipient no longer exists.')
 const p=pledges.find(p=>p.id===i.pledge_id);if(!p)fail('PLEDGE_CHANGED','The pledge changed. Open it again.')
 const recipient=await letterRecipient(c,d,options),remainingCents=i.amount_cents-i.paid_cents
 const campaign=p.campaign_id?await one(c,'SELECT name FROM cf_campaigns WHERE id=?',p.campaign_id):null
 const fields={...recipientMergeFields(recipient),...await customMerge(c,'pledge',p.id),date:longDate(today(s.timezone,new Date(c.now))),donor_name:recipient.letter_salutation??d.name,organization:s.organisation,ein:s.ein,fund:p.fund,campaign:campaign?.name??'',amount:usd(remainingCents),installment_amount:usd(remainingCents),due_date:longDate(i.due_on),pledged_amount:usd(p.amount_cents),pledge_balance:usd(p.remaining_cents),installment_number:String(i.position),pledge_date:longDate(p.pledged_on)}
 return {templateVersion:t.version,settingsVersion:s.version,donorVersion:d.version,recipient,remainingCents,...renderTemplate({subject:t.subject,body:t.body},fields)}
}
export async function pledgeMergeReview(c:{db:D1Database}){
 const rows=await all(c,`SELECT i.id,i.pledge_id,i.reminder_merge_blanks,d.id AS donor_id,d.name FROM cf_pledge_installments i JOIN cf_pledges p ON p.id=i.pledge_id JOIN cf_donors d ON d.id=p.donor_id WHERE d.erased_at IS NULL AND i.reminder_status='pending' AND i.reminder_merge_blanks IS NOT NULL AND i.reminder_merge_blanks<>'[]' ORDER BY lower(d.name),i.due_on,i.id`)
 return rows.map(r=>({donorId:r.donor_id,recipientName:r.name,pledgeId:r.pledge_id,installmentId:r.id,fields:JSON.parse(r.reminder_merge_blanks)}))
}
