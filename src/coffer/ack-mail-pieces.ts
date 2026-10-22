import { all, choice, guard, newId, sql, today, type Context, type Row, type Stmt } from './db'
import { tributeReceiptText } from './gift-depth'
import { householdState } from './households'
import { letterRecipient } from './organizations'
import { renderGiftLetter } from './letter-templates'
import { settings } from './settings'
import { receiptText } from './receipt-format'

export const ackMailPieces=(c:{db:D1Database},batchId:string)=>all(c,'SELECT * FROM cf_ack_mail_pieces WHERE batch_id=? ORDER BY position',batchId)
const addressKey=(value:string|null)=>{const a=value?JSON.parse(value):{};return ['line1','line2','city','region','postalCode','country'].map(k=>String(a[k]??'').trim().replace(/\s+/g,' ').toLowerCase()).join('|')}
export async function prepareAckMailPieces(c:Context,batchId:string,letters:Row[],gifts:Row[],templates:Map<string,Row>,requested:unknown,options:{emailType?:string;addressType?:string}={}){
 const basis=choice(requested,['gift','constituent','household'] as const,'one piece per'),s=await settings(c),day=today(s.timezone,new Date(c.now))
 const donors=await all(c,'SELECT * FROM cf_donors WHERE id IN(SELECT value FROM json_each(?))',JSON.stringify([...new Set(letters.map(l=>l.donor_id))]))
 const tributes=await all(c,'SELECT * FROM cf_gift_tributes WHERE gift_id IN(SELECT value FROM json_each(?))',JSON.stringify(gifts.map(g=>g.id)))
 const groups=new Map<string,Row[]>()
 for(const letter of letters){const donor=donors.find(d=>d.id===letter.donor_id)!,key=(basis==='gift'?letter.id:basis==='household'&&donor.household_id?'household:'+donor.household_id:'donor:'+donor.id)+':'+addressKey(letter.address);groups.set(key,[...groups.get(key)??[],letter])}
 const pieces:Row[]=[],checks:Stmt[]=[]
 for(const group of groups.values()){
  const first=group[0],donor=donors.find(d=>d.id===first.donor_id)!,state=basis==='household'&&donor.household_id?await householdState(c,donor.household_id):null
  const contact=await letterRecipient(c,donor,options),names=state?.names
  const recipient=state?{...contact,letter_name:names!.addressee,letter_salutation:names!.formal,letter_names:{informal:names!.informal,formal:names!.formal,envelope:names!.addressee},letter_household_names:names}:contact
  const content=group.map(letter=>{
   const gift=gifts.find(g=>g.id===letter.gift_id)!,rendered=renderGiftLetter(s,gift,recipient,day,templates.get(gift.id))
   return {letterId:letter.id,donorId:letter.donor_id,donorName:donors.find(d=>d.id===letter.donor_id)!.name,subject:state?rendered.subject:letter.subject,body:state?[rendered.body,tributeReceiptText(tributes.find(t=>t.gift_id===gift.id))].filter(Boolean).join('\n\n'):letter.body,status:donors.find(d=>d.id===letter.donor_id)!.constituent_status,mergeBlanks:state?rendered.merge_blanks:letter.merge_blanks}
  })
  const fields=[...new Set(content.flatMap(l=>JSON.parse(l.mergeBlanks??'[]')))].sort()
  const piece={id:newId(),batch_id:batchId,position:pieces.length,recipient_name:state?names!.addressee:first.recipient_name,address:first.address,household_id:state?.household.id??null,household_version:state?.household.version??null,members:JSON.stringify(state?state.members.map(m=>m.id):[...new Set(group.map(l=>l.donor_id))]),letter_ids:JSON.stringify(group.map(l=>l.id)),content:JSON.stringify(content),snapshot:JSON.stringify({basis,asOf:day,names:names??null,headStatus:state?.headStatus??null,overridesReview:!!state?.household.overrides_review}),merge_blanks:JSON.stringify(fields)}
  pieces.push(piece)
  if(state)checks.push(guard('EXISTS(SELECT 1 FROM cf_households WHERE id=? AND version=?)','HOUSEHOLD_CHANGED','This household changed while preparing. Prepare again.',state.household.id,state.household.version))
 }
 const columns=['id','batch_id','position','recipient_name','address','household_id','household_version','members','letter_ids','content','snapshot','merge_blanks']
 return {basis,pieces,checks,writes:pieces.map(p=>sql(`INSERT INTO cf_ack_mail_pieces(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,...columns.map(k=>p[k])))}
}
export const ackMailPieceGuard=(batchId:string)=>guard('NOT EXISTS(SELECT 1 FROM cf_ack_mail_pieces p WHERE p.batch_id=? AND p.household_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_households h WHERE h.id=p.household_id AND h.version=p.household_version))','HOUSEHOLD_CHANGED','A household changed after these postal pieces were prepared. Prepare again before approval or first export.',batchId)

/** A piece can span pages, but has one envelope. Every component keeps the
 * original receipt number, donor, money and VOID marker. Email remains separate. */
export function printableAckPieces(pieces:Row[],selected:Row[]):Row[]{
 return pieces.flatMap(piece=>{
  const content:Row[]=JSON.parse(piece.content),letters=content.flatMap(part=>{const actual=selected.find(l=>l.id===part.letterId);return actual?[{...actual,body:part.body,paper_subject:part.subject,hard_credit_name:part.donorName}]:[]})
  if(!letters.length)return []
  return [{recipient_name:piece.recipient_name,address:piece.address,subject:letters.length===1?letters[0].paper_subject:'Acknowledgments for your household',body:letters.map(l=>'Hard-credit donor: '+l.hard_credit_name+'\n'+l.paper_subject+'\n\n'+receiptText(l)).join('\n\n────────\n\n'),mail_piece:true}]
 })
}
