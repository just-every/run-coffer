import {all,type Context,type Row} from '../db'
import {customFields} from '../custom-fields'
import {box,e,empty,field,form,hidden,money,select} from './common'

export async function eventDefinitions(c:Context,event:Row){
 const fields=(await customFields(c)).filter(f=>f.kind==='constituent'),questions:Row[]=event.questions??[]
 return box('Ticket types',event.tickets.map((t:Row)=>`<p><strong>${e(t.name)}</strong> · ${money(t.price_cents)} · ${money(t.benefit_cents)} benefit · ${e(t.kind)} · ${t.seats} seats<br>${e(t.benefit_description)}</p>`).join('')+form('event.ticket',field('Ticket name','name','text','','required')+select('Ticket kind','kind',[['single','Single ticket'],['table','Table package'],['sponsorship','Sponsorship']],'single','aria-label="Ticket kind"')+field('Guest seats','seats','number','1','required min="0" max="100"')+field('Ticket price (USD)','price','text','','required inputmode="decimal"')+field('Benefit value (USD)','benefit','text','','required inputmode="decimal"')+field('Benefit description','benefitDescription','text','','required'),'Add ticket type',{eventId:event.id}))+
 box('Registration questions',questions.length?`<ul class="list">${questions.map(q=>`<li>${e(q.label)} · ${e(q.field_key)}${q.required?' · required':''}</li>`).join('')}</ul>`:empty('No custom registration questions yet.'))+
 box('Map a registration question',fields.length?form('event.question',field('Question shown to guests','label','text','','required maxlength="200"')+select('Constituent custom field','fieldKey',fields.map(f=>[f.key,f.label] as [string,string]),'','required aria-label="Constituent custom field"')+'<label><input type="checkbox" name="required" value="yes"> Require an answer</label>','Add mapped question',{eventId:event.id}):`<p><a href="/app/settings#custom-field-definitions">Define a constituent custom field</a> before mapping a question.</p>`)
}
export async function eventGuestList(c:Context,eventId:string,guests:Row[],search:{q?:string;registrationId?:string}={}){
 if(!guests.length)return box('Guest list',empty('No paid registrations yet.'))
 return box('Guest list',`<ul class="list">${(await Promise.all(guests.map(async g=>{
  let candidates:Row[]=[]
  if(g.donor_id)candidates=await all(c,'SELECT id,name,email FROM cf_donors WHERE id=? AND erased_at IS NULL',g.donor_id)
  else if(search.registrationId===g.id&&search.q&&search.q.trim().length>=2&&search.q.length<=100){
   const query='%'+search.q.trim().replace(/[\\%_]/g,'\\$&')+'%'
   candidates=await all(c,"SELECT id,name,email FROM cf_donors WHERE erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id) AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY lower(name),id LIMIT 20",query,query)
  }
  const answers:Row=JSON.parse(g.answers_json??'{}'),review=candidates.map(d=>form('event.matchGuest',`<p>${e(d.name)}${d.email?' · '+e(d.email):''}</p><label><input type="checkbox" name="reviewed" value="yes" required> I reviewed this guest identity and the submitted answers</label>`,`Accept guest ${g.attendee_name} as ${d.name}`,{registrationId:g.id,donorId:d.id,version:g.version})).join('')
  return `<li><h3>${e(g.attendee_name)}</h3>${g.donor_id?`<p><a href="/app/donors/${e(g.donor_id)}">Guest timeline</a></p>`:'<p>Donor identity needs staff review.</p>'}${g.attendee_email?`<p>${e(g.attendee_email)}</p>`:''}${g.dietary_notes?`<p>Dietary notes: ${e(g.dietary_notes)}</p>`:''}${Object.keys(answers).length?`<dl>${Object.entries(answers).map(([key,value])=>`<dt>${e(key)}</dt><dd>${e(Array.isArray(value)?value.join(', '):value)}</dd>`).join('')}</dl>`:''}${g.checked_in_at?'<p role="status">Checked in</p>':form('event.checkIn','',`Check in ${g.attendee_name}`,{registrationId:g.id,eventId})}${g.answers_applied_at?'<p>Guest identity and custom answers reviewed.</p>':`<details${search.registrationId===g.id?' open':''}><summary>Review guest and answers</summary><p>Submitted answers update custom fields only after this review. A conflicting donor value must be resolved in the donor’s native custom fields first.</p>${review}${g.donor_id?'':`<form method="get" action="/app/events/${e(eventId)}">${hidden('matchGuest',g.id)}${field('Find donor for '+g.attendee_name,'q','search',search.registrationId===g.id?search.q??'':'','required minlength="2" maxlength="100"')}<button>Find guest donor</button></form><p><a href="/app/donors?record=1">Create a donor record</a> if this is a new person, then return to match the guest.</p>`}</details>`}</li>`
 })).then(rows=>rows.join('')))}</ul>`)
}
