import {eventDefinitions,eventGuestList} from './event-admin'
import { campaigns } from '../giving/campaigns'
import { appealCodes } from '../attribution'
import { eventGuests, fundraisingEvent, fundraisingEvents } from '../fundraising-events'
import { type Context } from '../db'
import { box, e, empty, field, form, hidden, longDay, money, select } from './common'

export async function eventsPage(c:Context,eventId?:string,search:{q?:string;registrationId?:string}={}){
 const events=await fundraisingEvents(c)
 if(eventId){
  const current=events.find(r=>r.id===eventId)
  if(!current)return empty('This event is unavailable.')
  const event=await fundraisingEvent(c,current.slug),guests=await eventGuests(c,eventId)
  return `<p><a href="/app/events">Events</a> · <a href="/app/events/${e(eventId)}/auctions">Auction results</a> · <a href="/giving/events/${e(event.slug)}">Hosted registration</a> · <a href="/app/giving/campaigns/${e(event.campaign_id)}">Campaign progress</a></p>`+box(event.name,`<p>${longDay(event.starts_on)} · ${guests.length} paid guests · ${guests.filter(r=>r.checked_in_at).length} checked in</p>`)+await eventGuestList(c,eventId,guests,search)+await eventDefinitions(c,event)
 }
 return `<p><a href="/app/giving">Giving</a></p>`+box('Fundraising events',events.length?`<ul class="list">${events.map(r=>`<li><a href="/app/events/${e(r.id)}">${e(r.name)}</a> · ${longDay(r.starts_on)} · ${e(r.campaign)}</li>`).join('')}</ul>`:empty('No events yet.'))+box('Create event',form('event.create',field('Event name','name','text','','required')+field('Page address','slug','text','','required')+field('Event date','startsOn','date','','required')+select('Campaign','campaignId',(await campaigns(c)).map(r=>[r.id,r.name] as [string,string]),'','required aria-label="Campaign"')+select('Defined appeal','appeal',(await appealCodes(c)).map(r=>[r.code,r.name] as [string,string]),'','required aria-label="Defined appeal"'),'Create event'))
}
export {registrationPage} from './event-registration'
