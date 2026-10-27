import { manager } from '../auth'
import { calendarEvents, calendarState } from '../calendars/google'
import { bookingState, donorBookingLinks } from '../calendars/bookings'
import { fail, id, one, type Context } from '../db'
import { settings } from '../settings'
import { box, e, field, form, moment, when } from './common'

const confirm=(label:string)=>`<label><input type="checkbox" name="confirm" value="yes" required> ${e(label)}</label>`
export async function calendarSettingsPanel(c:Context) {
 if(c.actor.role==='agent')return ''
 const state=await calendarState(c),booking=await bookingState(c)
 return box('Calendars and booking',`<h3>Your Google Calendar</h3>${state.connected?`<p>Connected for read-only access to your primary calendar.</p>${form('calendar.disconnect','','Disconnect my calendar')}`:state.configured?form('calendar.start',confirm('Allow Coffer to read my calendar so I can choose meetings to log.'),'Connect Google Calendar'):'<p>An owner or admin configures the Google application below before staff connect their own calendars.</p>'}
 ${manager(c.actor)?`<details><summary>Google application</summary><p>Register this callback in your Google web application: <code>${e(state.callback)}</code></p>${form('calendar.configure',field('Google client ID','clientId','text','','required autocomplete="off"')+field('Google client secret','clientSecret','password','','required autocomplete="new-password"')+confirm('Approve this read-only application. Replacing it disconnects existing calendars.'),'Configure Google application')}</details>
 <details><summary>Calendly booking intake</summary><p>${booking.configured?'Configured.':'Not configured.'} Create an invitee.created webhook in Calendly with a signing key and this endpoint: <code>${e(booking.endpoint)}</code></p>${form('booking.configure',field('Calendly scheduling link','bookingUrl','url',booking.bookingUrl??'','required placeholder="https://calendly.com/your-team/donor-visit"')+field('Calendly event type URI','eventType','url','','required placeholder="https://api.calendly.com/event_types/your-event"')+field('Calendly webhook signing key','signingKey','password','','required autocomplete="new-password"')+confirm('Approve signed bookings from this event type to create local meetings and preparation tasks. No message is sent by Coffer.'),'Configure booking intake')}${booking.configured?form('booking.disconnect','','Disconnect booking intake'):''}</details>`:''}`, 'calendar-settings')
}
export async function bookingDonorPanel(c:Context,donorId:string) {
 const state=await bookingState(c),links=await donorBookingLinks(c,donorId)
 return `<details><summary>Calendar and scheduling links</summary><p><a href="/app/calendar?donorId=${encodeURIComponent(donorId)}">Choose a meeting from my Google Calendar</a></p>${state.configured?`${form('booking.link',confirm('Create a 30-day link for this donor’s primary email and assign its preparation task to me.'),'Create booking link',{donorId})}${links.length?`<ul class="list">${links.map(link=>`<li><a href="${e(link.url)}" rel="noreferrer">Open donor booking link</a><p>Expires ${e(when(link.expiresAt,'UTC'))}. Copy this link to share it with the donor.</p>${form('booking.revoke','','Revoke booking link',{donorId,id:link.id})}</li>`).join('')}</ul>`:''}`:'<p>An owner or admin connects Calendly in Settings before booking links can be shared.</p>'}</details>`
}
export async function calendarPage(c:Context,url:URL) {
 const donorId=id(url.searchParams.get('donorId'),'Donor'),donor=await one(c,'SELECT id,name FROM cf_donors d WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)',donorId)
 if(!donor)fail('NOT_FOUND','Choose a current donor.',404)
 const state=await calendarState(c)
 if(!state.connected)return box('Your Google Calendar',`<p>Connect your calendar in <a href="/app/settings#calendar-settings">Settings</a>, then return to choose a meeting for ${e(donor.name)}.</p>`)
 const result=await calendarEvents(c,url.searchParams.get('pageToken')??undefined),zone=(await settings(c)).timezone
 return box('Choose a meeting',`<p>Link a calendar meeting to ${e(donor.name)}. Only the selected meeting’s time and provider reference are saved. Your other calendar entries stay private.</p>${result.events.length?`<ul class="list">${result.events.map(value=>`<li><strong>${e(value.summary)}</strong><p>${e(moment(value.startsAt,zone))} to ${e(moment(value.endsAt,zone))}</p>${form('calendar.log',confirm('This meeting belongs on this donor’s timeline.'),'Log this meeting',{donorId,eventId:value.id})}</li>`).join('')}</ul>`:'<p>No timed meetings in the last 30 or next 90 days.</p>'}${result.nextPageToken?`<p><a href="/app/calendar?${e(new URLSearchParams({donorId,pageToken:result.nextPageToken}))}">Next calendar page</a></p>`:''}<p><a href="/app/donors/${e(donorId)}#meetings">Back to donor meetings</a></p>`)
}
