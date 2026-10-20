import { choice, email, fail, optional, text, type Row, type Stmt } from '../db'

export function givingTribute(p:Row) {
 if(!p.tributeKind&&!p.tributeHonoree) {
  if(p.notifyName||p.notifyEmail||p.notifyAddress||p.tributeAmountPermission)fail('INPUT','Choose a tribute type and honoree before adding a notification.',400)
  return null
 }
 const kind=choice(p.tributeKind,['honor','memory'] as const,'tribute type'),honoree=text(p.tributeHonoree,'Honoree')
 const notified_name=optional(p.notifyName,'Person to notify'),notified_email=email(p.notifyEmail,'Notification email'),notified_address=optional(p.notifyAddress,'Notification postal address',1000)
 if((notified_email||notified_address)&&!notified_name)fail('INPUT','Enter the name of the person to notify.',400)
 if(notified_name&&!notified_email&&!notified_address)fail('INPUT','Enter an email or postal address for the notification.',400)
 return {kind,honoree,notified_name,notified_email,notified_address,amount_permission:p.tributeAmountPermission==='yes'?1:0}
}
export function tributeGiftStatement(giftId:string,intentId:string,now:string):Stmt {
 return {sql:`INSERT OR IGNORE INTO cf_gift_tributes(gift_id,version,kind,honoree,notified_name,notified_email,donor_id,created_at,created_by,notified_address,amount_permission,group_key)
  SELECT ?,1,t.kind,t.honoree,t.notified_name,t.notified_email,NULL,?,'Giving page',t.notified_address,t.amount_permission,NULL
  FROM cf_giving_tributes t JOIN cf_gifts g ON g.id=? JOIN cf_donors d ON d.id=g.donor_id AND d.erased_at IS NULL WHERE t.intent_id=? AND t.kind IS NOT NULL`,params:[giftId,now,giftId,intentId]}
}
