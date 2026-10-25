import { all, commit, date, event, fail, guard, id, newId, one, sql, text, type Context, type Row } from './db'
import { amount } from './money'

export const fundraisingEvents = (c: {db:D1Database}) => all(c, 'SELECT e.*,c.name AS campaign FROM cf_fundraising_events e JOIN cf_campaigns c ON c.id=e.campaign_id ORDER BY starts_on DESC,e.id')
export async function fundraisingEvent(c:{db:D1Database},slug:string):Promise<Row & {tickets:Row[]}>{
 const row=await one(c,'SELECT e.*,c.slug AS campaign_slug FROM cf_fundraising_events e JOIN cf_campaigns c ON c.id=e.campaign_id WHERE e.slug=? AND c.active=1',slug)
 if(!row)fail('NOT_FOUND','That event is unavailable.',404)
 return {...row,tickets:await all(c,'SELECT * FROM cf_event_ticket_types WHERE event_id=? ORDER BY name,id',row.id)}
}
export async function eventGuests(c:{db:D1Database},eventId:string){
 return all(c,`SELECT r.*,e.name AS event_name FROM cf_event_registrations r JOIN cf_fundraising_events e ON e.id=r.event_id JOIN cf_donors d ON d.id=r.donor_id
 WHERE r.event_id=? AND d.erased_at IS NULL ORDER BY lower(r.attendee_name),r.id`,eventId)
}
export async function fundraisingEventCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(command==='event.create'){
  const eventId=newId(),name=text(p.name,'Event name',120),slug=text(p.slug,'Page address',80),campaignId=id(p.campaignId,'Campaign'),appeal=text(p.appeal,'Defined appeal',80),startsOn=date(p.startsOn,'Event date')
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))fail('INPUT','Use lowercase words separated by hyphens for the page address.',400)
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND active=1)','CAMPAIGN','Choose an active campaign.',campaignId),guard('EXISTS(SELECT 1 FROM cf_appeal_codes WHERE code=?)','APPEAL','Choose a defined appeal.',appeal),sql('INSERT INTO cf_fundraising_events VALUES(?,?,?,?,?,?,?)',eventId,name,campaignId,appeal,slug,startsOn,c.now),sql('INSERT OR IGNORE INTO cf_campaign_appeals(campaign_id,appeal) VALUES(?,?)',campaignId,appeal),event(c,command,'fundraisingEvent',eventId,null)])
  return {id:eventId,slug}
 }
 if(command==='event.ticket'){
  const ticketId=newId(),eventId=id(p.eventId,'Event'),name=text(p.name,'Ticket name',120),price=amount(p,'price','Ticket price'),benefit=amount(p,'benefit','Benefit value'),description=text(p.benefitDescription,'Benefit description',300)
  if(benefit>price)fail('INPUT','Benefit value cannot exceed the ticket price.',400)
  if(price<100||price>10000000)fail('INPUT','Ticket price must be between $1 and $100,000.',400)
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_fundraising_events WHERE id=?)','EVENT','Choose an event.',eventId),sql('INSERT INTO cf_event_ticket_types VALUES(?,?,?,?,?,?)',ticketId,eventId,name,price,benefit,description),event(c,command,'eventTicket',ticketId,null,{eventId,priceCents:price,benefitCents:benefit})])
  return {id:ticketId,eventId}
 }
 if(command==='event.checkIn'){
  const registrationId=id(p.registrationId,'Guest'),r=await one(c,'SELECT * FROM cf_event_registrations WHERE id=?',registrationId)
  if(!r?.donor_id)fail('NOT_FOUND','Choose a paid guest registration.',404)
  if(r.checked_in_at)return {id:registrationId,eventId:r.event_id,checkedIn:true}
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_event_registrations r JOIN cf_donors d ON d.id=r.donor_id WHERE r.id=? AND d.erased_at IS NULL AND r.checked_in_at IS NULL)','GUEST_CHANGED','The guest registration changed. Refresh the list.',registrationId),sql('UPDATE cf_event_registrations SET checked_in_at=?,checked_in_by=? WHERE id=?',c.now,c.actor.id,registrationId),event(c,command,'eventRegistration',registrationId,r.donor_id,{eventId:r.event_id})])
  return {id:registrationId,eventId:r.event_id,checkedIn:true}
 }
 return undefined
}
