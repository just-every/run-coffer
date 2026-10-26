import type { Row } from '../db'
import { box,e,field,hidden,longDay,money,select } from './common'

export function eventQuestionInput(q:Row,prefix:string,labelPrefix=''){
 const name=prefix+q.field_key,label=labelPrefix+q.label,required=q.required?'required':'',choices=Array.isArray(q.choices)?q.choices:JSON.parse(q.choices??'[]')
 if(q.entry==='pick-many')return `<fieldset><legend>${e(label)}${q.required?' (required)':''}</legend>${choices.map((value:string)=>`<label><input type="checkbox" name="${e(name)}" value="${e(value)}"> ${e(value)}</label>`).join('')}</fieldset>`
 if(q.entry==='pick-one'||q.type==='checkbox')return select(label,name,q.type==='checkbox'?[['','Choose an answer'],['true','Yes'],['false','No']]:[['','Choose an answer'],...choices.map((v:string)=>[v,v])],'',required+` aria-label="${e(label)}"`)
 const type=q.type==='date'?'date':q.type==='number'||q.type==='year'?'number':'text'
 return field(label,name,type,'',required+(q.type==='currency'?' inputmode="decimal"':'')+(type==='text'?' maxlength="2000"':''))
}
export function registrationPage(event:Row,siteKey:string,selectedTicketId?:string){
 const tickets:Row[]=event.tickets,questions:Row[]=event.questions??[],selected=tickets.find(t=>t.id===selectedTicketId)??tickets.find(t=>t.kind==='single'||!t.kind)??tickets[0]
 if(!selected)return box(event.name,`<p>${longDay(event.starts_on)}</p><p>Registration is not open yet.</p>`)
 const packageOrder=selected.kind&&selected.kind!=='single',seats=Number(selected.seats??1)
 const chooser=`<form method="get" action="/giving/events/${e(event.slug)}">${select('Ticket or package','ticketId',tickets.map(t=>[t.id,`${t.name} · ${money(t.price_cents)}`]),selected.id,'aria-label="Ticket or package"')}<button>Continue to registration</button></form>`
 const singleTicket=select('Ticket type','ticketId',tickets.filter(t=>!t.kind||t.kind==='single').map(t=>[t.id,`${t.name} · ${money(t.price_cents)} (${money(t.benefit_cents)} benefit)`]),selected.id,'required aria-label="Ticket type"')
 const guests=packageOrder?Array.from({length:seats},(_,i)=>{const n=i+1;return `<fieldset><legend>Guest ${n}</legend>${field(`Guest ${n} name`,`guest${n}Name`,'text','','required maxlength="200"')}${field(`Guest ${n} email`,`guest${n}Email`,'email','','maxlength="200"')}${field(`Guest ${n} dietary notes`,`guest${n}DietaryNotes`,'text','','maxlength="1000"')}<label><input type="checkbox" name="guest${n}Buyer" value="yes"> Guest ${n} is the purchaser</label>${questions.map(q=>eventQuestionInput(q,`guest${n}_answer_`,`Guest ${n}: `)).join('')}</fieldset>`}).join(''):field('Dietary notes','dietaryNotes','text','','maxlength="1000"')+questions.map(q=>eventQuestionInput(q,'answer_')).join('')
 const description=`<p>${e(selected.name)} · ${money(selected.price_cents)} total · ${money(selected.benefit_cents)} benefit${packageOrder?` · ${seats} guest seats`:''}</p><p>${e(selected.benefit_description)}</p>`
 return box(event.name,`<p>${longDay(event.starts_on)}</p>${chooser}${description}<form method="post" action="/giving/events/${e(event.slug)}/checkout">${hidden('requestId',crypto.randomUUID())}${field(packageOrder?'Purchaser name':'Attendee name','name','text','','required maxlength="200"')}${field('Email','email','email','','required')}${packageOrder?hidden('ticketId',selected.id):singleTicket}${guests}<p>Guest notes and answers are private to authorized event staff. Staff review answers before adding them to donor custom fields. Registration grants no marketing permission.</p><p>Your receipt states the full payment, the stated benefit value and the contribution that may be deductible.</p><div class="cf-turnstile" data-sitekey="${e(siteKey)}" data-action="giving"></div><button>Register with Stripe</button></form>`)
}
