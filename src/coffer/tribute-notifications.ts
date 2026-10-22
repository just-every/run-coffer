import { letterRecipient } from './organizations'
import { all, commit, event, fail, guard, id, integer, newId, one, sql, type Context, type Row } from './db'
import { manager } from './auth'
import { settings } from './settings'
import { usd } from './money'

const live=`d.erased_at IS NULL AND g.net_cents>0 AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)`
export async function tributeNotifications(c:Pick<Context,'db'>,donorId:string) {
 return all(c,`SELECT n.* FROM cf_tribute_notifications n JOIN cf_gifts g ON g.id=n.gift_id WHERE g.donor_id=? ORDER BY n.prepared_at,n.id`,donorId)
}
export async function tributeNotificationCommand(c:Context,command:string,p:Row):Promise<Row|undefined> {
 if(command==='tributeNotification.prepare') {
  const giftId=id(p.giftId,'Tribute gift'),n=await one(c,`SELECT t.*,g.net_cents,g.donor_id AS gift_donor_id FROM cf_gift_tributes t JOIN cf_gift_balances g ON g.id=t.gift_id JOIN cf_donors d ON d.id=g.donor_id WHERE t.gift_id=? AND ${live}`,giftId)
  if(!n)fail('TRIBUTE_CHANGED','Choose a current tribute gift with a positive balance.')
  let contact:Row|null=null
  if(n.notification_donor_id){const d=await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL',n.notification_donor_id);if(!d)fail('NOTIFICATION_CONTACT','This family contact is no longer available.');contact=await letterRecipient(c,d!);n.notified_name=contact.letter_name;n.notified_email=contact.email;const a=JSON.parse(contact.letter_address);n.notified_address=[a.line1,a.line2,a.city,a.region,a.postalCode,a.country].filter(Boolean).join('\n')}
  if(!n.notified_name||(!n.notified_email&&!n.notified_address))fail('NOTIFICATION_CONTACT','Record the family notification name and email or postal address first.')
  const notificationId=newId(),s=await settings(c),subject=`A gift in ${n.kind==='memory'?'memory':'honor'} of ${n.honoree}`
  const body=`Dear ${contact?.letter_salutation??n.notified_name},\n\n${s.organisation} has received a gift${n.amount_permission?' of '+usd(n.net_cents):''} in ${n.kind==='memory'?'memory':'honor'} of ${n.honoree}.\n\nThank you.\n${s.organisation}`
  await commit(c,[
   guard(`EXISTS(SELECT 1 FROM cf_gift_tributes t JOIN cf_gift_balances g ON g.id=t.gift_id JOIN cf_donors d ON d.id=g.donor_id WHERE t.gift_id=? AND t.version=? AND g.net_cents=? AND ${live})`,'TRIBUTE_CHANGED','The tribute gift changed. Prepare a current notification.',giftId,n.version,n.net_cents),
   sql(`INSERT INTO cf_tribute_notifications(id,gift_id,tribute_version,amount_cents,status,subject,body,recipient_name,recipient_email,recipient_address,prepared_at,prepared_by) VALUES(?,?,?,?,'prepared',?,?,?,?,?,?,?)`,notificationId,giftId,n.version,n.net_cents,subject,body,n.notified_name,n.notified_email,n.notified_address,c.now,c.actor.id),
   ...(contact?[guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL)','CONTACT_CHANGED','The family contact changed. Prepare again.',contact.id,contact.version),sql('UPDATE cf_tribute_notifications SET contact_snapshot=? WHERE id=?',JSON.stringify({donorId:contact.id,donorVersion:contact.version,emailContactId:contact.selected_email_contact_id,addressContactId:contact.selected_address_contact_id}),notificationId)]:[]),
   event(c,command,'tribute_notification',notificationId,n.gift_donor_id,{giftId}),
  ])
  return {id:notificationId,version:1,donorId:n.gift_donor_id,status:'prepared'}
 }
 if(command==='tributeNotification.approve') {
  const notificationId=id(p.notificationId,'Notification'),version=integer(Number(p.version),'Notification version',1)
  await commit(c,[guard("NOT EXISTS(SELECT 1 FROM cf_tribute_notifications n WHERE n.id=? AND n.contact_snapshot IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=json_extract(n.contact_snapshot,'$.donorId') AND d.version=json_extract(n.contact_snapshot,'$.donorVersion') AND d.erased_at IS NULL))",'CONTACT_CHANGED','The family contact changed. Prepare the notification again.',notificationId),guard(`EXISTS(SELECT 1 FROM cf_tribute_notifications n JOIN cf_gift_tributes t ON t.gift_id=n.gift_id JOIN cf_gift_balances g ON g.id=n.gift_id JOIN cf_donors d ON d.id=g.donor_id WHERE n.id=? AND n.version=? AND n.status='prepared' AND n.tribute_version=t.version AND n.amount_cents=g.net_cents AND ${live})`,'NOTIFICATION_CHANGED','This notification or its gift changed. Prepare a new notification.',notificationId,version),
   sql("UPDATE cf_tribute_notifications SET status='approved',version=version+1,approved_at=?,approved_by=? WHERE id=?",c.now,c.actor.id,notificationId),event(c,command,'tribute_notification',notificationId,null)])
  return {id:notificationId,version:version+1,status:'approved'}
 }
 return undefined
}
export async function notificationDownload(c:Context,notificationId:string) {
 if(!manager(c.actor))fail('FORBIDDEN','Only the owner or an admin downloads approved family notifications.',403)
 const n=await one(c,`SELECT n.*,t.version AS current_tribute_version,g.net_cents FROM cf_tribute_notifications n JOIN cf_gift_balances g ON g.id=n.gift_id JOIN cf_gift_tributes t ON t.gift_id=n.gift_id JOIN cf_donors d ON d.id=g.donor_id WHERE n.id=? AND d.erased_at IS NULL`,notificationId)
 if(!n)fail('NOT_FOUND','That family notification is not available.',404)
 if(n.current_tribute_version!==n.tribute_version || n.net_cents!==n.amount_cents || n.net_cents<=0)fail('NOTIFICATION_CHANGED','The tribute or gift changed. Prepare a new family notification.')
 if(n.status!=='approved')fail('NOT_APPROVED','Approve this exact family notification before downloading it.')
 return n
}
