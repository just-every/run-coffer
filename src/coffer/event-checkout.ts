import {erasureHash} from './imports/snapshots'
import { all, email, fail, guard, one, optional, sha256, text, type Row } from './db'
import { eventAnswers, eventQuestions } from './event-questions'

export type EventCheckout = {order:Row;guests:Row[];statements:D1PreparedStatement[]}

/** Every package price, benefit, seat and question comes from the native definitions. */
export async function prepareEventCheckout(db:D1Database,intentId:string,ticket:Row,p:Row,buyerName:string,buyerEmail:string):Promise<EventCheckout> {
 const c={db},prior=await one(c,'SELECT * FROM cf_event_orders WHERE intent_id=?',intentId)
 if(prior&&prior.ticket_type_id!==ticket.id)fail('checkout_changed','Reload before choosing a different event package.',409)
 const snapshot=prior??{intent_id:intentId,event_id:ticket.event_id,ticket_type_id:ticket.id,ticket_name:ticket.name,kind:ticket.kind??'single',seats:ticket.seats??1,price_cents:ticket.price_cents,benefit_cents:ticket.benefit_cents,benefit_description:ticket.benefit_description,questions_json:JSON.stringify(await eventQuestions(c,ticket.event_id))}
 const questions:Row[]=JSON.parse(snapshot.questions_json)
 let supplied=p.guests
 if(typeof supplied==='string'){try{supplied=JSON.parse(supplied)}catch{fail('INPUT','Guests must be a JSON list.',400)}}
 if(supplied===undefined)supplied=snapshot.kind==='single'?[{name:buyerName,email:buyerEmail,buyer:true,dietaryNotes:p.dietaryNotes,answers:p.answers}]:snapshot.seats===0?[]:undefined
 if(!Array.isArray(supplied)||supplied.length!==snapshot.seats)fail('INPUT','Provide exactly '+snapshot.seats+' named guests for this package.',400)
 let buyers=0
 const guests=supplied.map((guest:unknown,index:number)=>{
  if(!guest||typeof guest!=='object'||Array.isArray(guest))fail('INPUT','Each guest must have a name and answers.',400)
  const row=guest as Row,name=text(row.name,'Guest name',200),mail=email(row.email,'Guest email')
  if(![true,false,'yes','no',undefined].includes(row.buyer))fail('INPUT','Choose whether the guest is the buyer.',400)
  const buyer=row.buyer===true||row.buyer==='yes'
  if(buyer){buyers++;if(name!==buyerName||mail!==buyerEmail)fail('INPUT','The buyer seat must use the buyer name and email.',400)}
  return {id:index===0?intentId:intentId+'-guest-'+(index+1),seat_number:index+1,attendee_name:name,attendee_email:mail,dietary_notes:optional(row.dietaryNotes,'Dietary notes',2000),answers:eventAnswers(questions,row.answers),is_buyer:buyer?1:0}
 })
 if(buyers>1)fail('INPUT','Only one seat can belong to the buyer.',400)
 const inputHash=await sha256(JSON.stringify({ticketId:ticket.id,guests:guests.map(g=>({...g,answers:Object.fromEntries(Object.entries(g.answers).sort(([a],[b])=>a.localeCompare(b)))}))}))
 if(prior&&prior.input_hash!==null&&prior.input_hash!==inputHash)fail('checkout_changed','Reload the registration before changing its guests or answers.',409)
 if(prior&&prior.input_hash===null){
  const saved=await all(c,'SELECT * FROM cf_event_registrations WHERE intent_id=? ORDER BY seat_number',intentId)
  if(saved.length!==guests.length||saved.some((g,i)=>g.attendee_name!==guests[i].attendee_name||guests[i].is_buyer!==1||guests[i].attendee_email!==buyerEmail||guests[i].dietary_notes!==null||Object.keys(guests[i].answers).length))fail('checkout_changed','Reload this saved registration before changing its guests.',409)
 }
 const erasedKeys=guests.filter(g=>g.attendee_email).map(g=>erasureHash(g.attendee_email!))
 if(erasedKeys.length&&await one(c,'SELECT 1 FROM cf_erasures WHERE hash IN(SELECT value FROM json_each(?))',JSON.stringify(erasedKeys)))fail('GUEST_ERASED','A submitted guest identity was erased. Contact the organization before registering that guest.',409)
 const now=new Date().toISOString(),statements:D1PreparedStatement[]=[]
 if(erasedKeys.length){const fence=guard('NOT EXISTS(SELECT 1 FROM cf_erasures WHERE hash IN(SELECT value FROM json_each(?)))','GUEST_ERASED','A submitted guest identity was erased during registration.',JSON.stringify(erasedKeys));statements.push(db.prepare(fence.sql).bind(...fence.params))}
 statements.push(db.prepare(`INSERT OR IGNORE INTO cf_event_orders(intent_id,event_id,ticket_type_id,ticket_name,kind,seats,price_cents,benefit_cents,benefit_description,questions_json,input_hash,created_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(intentId,snapshot.event_id,ticket.id,snapshot.ticket_name,snapshot.kind,snapshot.seats,snapshot.price_cents,snapshot.benefit_cents,snapshot.benefit_description,snapshot.questions_json,inputHash,now))
 // A concurrent different request cannot add any seats to the winning snapshot.
 for(const g of guests)statements.push(db.prepare(`INSERT OR IGNORE INTO cf_event_registrations(id,event_id,ticket_type_id,donor_id,intent_id,attendee_name,price_cents,benefit_cents,benefit_description,created_at,seat_number,attendee_email,dietary_notes,answers_json,is_buyer)
 SELECT ?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cf_event_orders WHERE intent_id=? AND input_hash=? AND paid_at IS NULL)`).bind(g.id,snapshot.event_id,ticket.id,intentId,g.attendee_name,snapshot.price_cents,snapshot.benefit_cents,snapshot.benefit_description,now,g.seat_number,g.attendee_email,g.dietary_notes,JSON.stringify(g.answers),g.is_buyer,intentId,inputHash))
 return {order:{...snapshot,input_hash:prior?prior.input_hash:inputHash},guests,statements}
}
