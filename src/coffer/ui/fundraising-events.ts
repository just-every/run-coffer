import { campaigns } from '../giving/campaigns'
import { appealCodes } from '../attribution'
import { eventGuests, fundraisingEvent, fundraisingEvents } from '../fundraising-events'
import { type Context } from '../db'
import { box, e, empty, field, form, hidden, longDay, money, select } from './common'

export async function eventsPage(c:Context,eventId?:string){
 const events=await fundraisingEvents(c)
 if(eventId){
  const current=events.find(r=>r.id===eventId)
  if(!current)return empty('This event is unavailable.')
  const event=await fundraisingEvent(c,current.slug),guests=await eventGuests(c,eventId)
  return `<p><a href="/app/events">Events</a> · <a href="/app/events/${e(eventId)}/auctions">Auction results</a> · <a href="/giving/events/${e(event.slug)}">Hosted registration</a> · <a href="/app/giving/campaigns/${e(event.campaign_id)}">Campaign progress</a></p>`+box(event.name,`<p>${longDay(event.starts_on)} · ${guests.length} paid guests · ${guests.filter(r=>r.checked_in_at).length} checked in</p>`)+box('Guest list',guests.length?`<ul class="list">${guests.map(g=>`<li><strong>${e(g.attendee_name)}</strong> · <a href="/app/donors/${e(g.donor_id)}">Guest timeline</a>${g.checked_in_at?'<p role="status">Checked in</p>':form('event.checkIn','',`Check in ${g.attendee_name}`,{registrationId:g.id,eventId})}</li>`).join('')}</ul>`:empty('No paid registrations yet.'))+box('Ticket types',event.tickets.map(t=>`<p>${e(t.name)} · ${money(t.price_cents)} · ${money(t.benefit_cents)} benefit: ${e(t.benefit_description)}</p>`).join('')+form('event.ticket',field('Ticket name','name','text','','required')+field('Ticket price (USD)','price','text','','required inputmode="decimal"')+field('Benefit value (USD)','benefit','text','','required inputmode="decimal"')+field('Benefit description','benefitDescription','text','','required'),'Add ticket type',{eventId}))
 }
 return `<p><a href="/app/giving">Giving</a></p>`+box('Fundraising events',events.length?`<ul class="list">${events.map(r=>`<li><a href="/app/events/${e(r.id)}">${e(r.name)}</a> · ${longDay(r.starts_on)} · ${e(r.campaign)}</li>`).join('')}</ul>`:empty('No events yet.'))+box('Create event',form('event.create',field('Event name','name','text','','required')+field('Page address','slug','text','','required')+field('Event date','startsOn','date','','required')+select('Campaign','campaignId',(await campaigns(c)).map(r=>[r.id,r.name] as [string,string]),'','required aria-label="Campaign"')+select('Defined appeal','appeal',(await appealCodes(c)).map(r=>[r.code,r.name] as [string,string]),'','required aria-label="Defined appeal"'),'Create event'))
}
export function registrationPage(event:Record<string,any>,siteKey:string){
 return box(event.name,`<p>${longDay(event.starts_on)}</p><form method="post" action="/giving/events/${e(event.slug)}/checkout">${hidden('requestId',crypto.randomUUID())}${field('Attendee name','name','text','','required maxlength="200"')}${field('Email','email','email','','required')}${select('Ticket type','ticketId',event.tickets.map((t:Record<string,any>)=>[t.id,`${t.name} · ${money(t.price_cents)} (${money(t.benefit_cents)} benefit)`]),'','required aria-label="Ticket type"')}<ul class="list">${event.tickets.map((t:Record<string,any>)=>`<li><strong>${e(t.name)}</strong> · ${money(t.price_cents)}<p>${e(t.benefit_description)} · fair market value ${money(t.benefit_cents)}</p></li>`).join('')}</ul><p>Each ticket includes the stated benefit value. Your receipt states the contribution that may be deductible.</p><div class="cf-turnstile" data-sitekey="${e(siteKey)}" data-action="giving"></div><button>Register with Stripe</button></form>`)
}
