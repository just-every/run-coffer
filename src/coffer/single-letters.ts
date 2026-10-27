import { all, commit, event, fail, guard, id, integer, newId, one, sha256, sql, today, type Context, type Row } from './db'
import { letterRecipient } from './organizations'
import { renderGiftLetter, templateRevision, templatesUnchanged } from './letter-templates'
import { renderAcknowledgment } from './in-kind'
import { annualLetter } from './year-end'
import { settings } from './settings'
import { withReceiptBenefits } from './receipt-rules'
import { withContributionTypes } from './contribution-receipts'
import { receiptFundLabels } from './gift-splits'
import { giftFacts } from './merge-facts'
import { customMerge } from './custom-fields'
import { tributeReceiptText } from './gift-depth'

const live=(donorId:string)=>guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','DONOR_CHANGED','Open the current constituent before producing a letter.',donorId,donorId)
export const singleLetters=(c:{db:D1Database},donorId:string)=>all(c,'SELECT * FROM cf_single_letters WHERE donor_id=? ORDER BY prepared_at DESC,id',donorId)
export async function singleLetter(c:Context,letterId:string,approved=false){
 const letter=await one(c,'SELECT l.* FROM cf_single_letters l JOIN cf_donors d ON d.id=l.donor_id WHERE l.id=? AND d.erased_at IS NULL',id(letterId,'Letter'))
 if(!letter||letter.status==='erased')fail('NOT_FOUND','That letter is unavailable.',404)
 if(approved&&letter.status!=='approved')fail('NOT_APPROVED','Approve this exact letter before downloading or printing.')
 if(approved)await currentSingleLetter(c,letter)
 return letter
}

async function currentSingleLetter(c:Context,l:Row){
 const snapshot=JSON.parse(l.context_snapshot)
 if(l.statement_year){
  const current=await one(c,`SELECT count(*) AS n FROM cf_gift_balances g WHERE g.donor_id=? AND g.kind='gift' AND g.net_cents>0 AND substr(g.received_on,1,4)=? AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id) AND NOT EXISTS(SELECT 1 FROM cf_contribution_types t WHERE t.gift_id=g.id AND t.kind='daf')`,l.donor_id,String(l.statement_year))
  if(current?.n!==(snapshot.gifts??[]).length)fail('GIFT_CHANGED','The statement year changed. Produce a current letter with the complete gift list.')
 }
 for(const g of snapshot.gifts??[]){
  const current=await one(c,'SELECT version,net_cents,donor_id FROM cf_gift_balances WHERE id=?',g.id)
  if(!current||current.version!==g.version||current.net_cents!==g.net||current.donor_id!==l.donor_id)fail('GIFT_CHANGED','Gift facts changed. Produce a current letter; this frozen copy remains in history.')
 }
 if(snapshot.propertyId){const current=await one(c,'SELECT version,donor_id FROM cf_in_kind_gifts WHERE id=?',snapshot.propertyId);if(!current||current.version!==snapshot.version||current.donor_id!==l.donor_id)fail('GIFT_CHANGED','Property facts changed. Produce a current letter.')}
}

/** A frozen reviewed copy never changes an existing receipt or claims mailing. */
export async function singleLetterCommand(c:Context,command:string,p:Row):Promise<Row|undefined>{
 if(!['singleLetter.prepare','singleLetter.approve'].includes(command))return undefined
 if(command==='singleLetter.approve'){
  const l=await singleLetter(c,id(p.letterId,'Letter')),version=integer(Number(p.version),'Version',1)
  await currentSingleLetter(c,l)
  await commit(c,[live(l.donor_id),guard("EXISTS(SELECT 1 FROM cf_single_letters WHERE id=? AND version=? AND status='prepared' AND content_hash=?)",'LETTER_CHANGED','This letter changed. Review it before approving.',l.id,version,p.contentHash??''),
   sql("UPDATE cf_single_letters SET status='approved',version=version+1,approved_at=?,approved_by=? WHERE id=?",c.now,c.actor.id,l.id),event(c,command,'single_letter',l.id,l.donor_id,{templateId:l.template_id,templateVersion:l.template_version})])
  return {id:l.id,donorId:l.donor_id,version:version+1,status:'approved'}
 }
 const donorId=id(p.donorId,'Constituent'),d=await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL',donorId)
 if(!d)fail('NOT_FOUND','Choose a current constituent.',404)
 const s=await settings(c),day=today(s.timezone,new Date(c.now)),revision=await templateRevision(c)
 if(!s.reviewed_at||!s.ein)fail('SETTINGS_UNREVIEWED','Review organization and letter settings first.')
 const template=p.templateId?await one(c,'SELECT * FROM cf_letter_templates WHERE id=? AND active=1',id(p.templateId,'Template')):undefined
 if(p.templateId&&!template)fail('NOT_FOUND','Choose an active reviewed template.',404)
 const recipient=await letterRecipient(c,d,{interactionId:p.interactionId||undefined}),kind=template?.kind??'default'
 let rendered:Row,gift:Row|null=null,property:Row|null=null,year:number|null=null,snapshot:Row={}
 if(kind==='year_end'){
  year=integer(Number(p.year),'Statement year',1900,Number(day.slice(0,4)))
  const gifts=await all(c,`SELECT g.*,g.net_cents AS amount_cents FROM cf_gift_balances g WHERE g.donor_id=? AND g.kind='gift' AND g.net_cents>0 AND substr(g.received_on,1,4)=? AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id) AND NOT EXISTS(SELECT 1 FROM cf_contribution_types t WHERE t.gift_id=g.id AND t.kind='daf') ORDER BY g.received_on,g.id`,donorId,String(year))
  if(!gifts.length||gifts.some(g=>g.goods==='unknown'||g.goods_cents>g.net_cents))fail('CONTEXT','Choose a year with gifts whose benefit facts are reviewed.')
  await withContributionTypes(c,gifts);await withReceiptBenefits(c,gifts);await receiptFundLabels(c,gifts)
  for(const g of gifts){const tribute=await one(c,'SELECT * FROM cf_gift_tributes WHERE gift_id=?',g.id);if(tribute)g.tribute=tribute}
  rendered=annualLetter(s,recipient,gifts,year,day,template??null)
  snapshot={gifts:gifts.map(g=>({id:g.id,version:g.version,net:g.net_cents}))}
 }else if(kind==='in_kind'||kind==='stock'){
  property=await one(c,'SELECT * FROM cf_in_kind_gifts WHERE id=? AND donor_id=?',id(p.contextId,'Property'),donorId)
  if(!property)fail('CONTEXT','Choose property belonging to this constituent.',400)
  await withContributionTypes(c,[property])
  if((kind==='stock')!==(property.contribution_type==='stock'))fail('CONTEXT','Choose the matching property template.',400)
  property.merge_fields=await customMerge(c,'gift',property.id)
  rendered=renderAcknowledgment(s,property,recipient,day,template??null)
  snapshot={propertyId:property.id,version:property.version}
 }else{
  gift=await one(c,"SELECT *,net_cents AS amount_cents FROM cf_gift_balances WHERE id=? AND donor_id=? AND kind='gift' AND net_cents>0",id(p.contextId,'Gift'),donorId)
  if(!gift||gift.goods==='unknown'||gift.goods_cents>=gift.net_cents)fail('CONTEXT','Choose this constituent’s positive gift with reviewed benefits.',400)
  await withContributionTypes(c,[gift]);await withReceiptBenefits(c,[gift]);await receiptFundLabels(c,[gift]);await giftFacts(c,[gift])
  gift.merge_fields=await customMerge(c,'gift',gift.id)
  if(['daf','qcd'].includes(kind)&&gift.contribution_type!==kind||gift.contribution_type&&kind!==gift.contribution_type)fail('CONTEXT','Use the template matching this contribution type.',400)
  rendered=renderGiftLetter(s,gift,recipient,day,template??undefined)
  const tribute=await one(c,'SELECT * FROM cf_gift_tributes WHERE gift_id=?',gift.id)
  rendered.body=[rendered.body,tributeReceiptText(tribute)].filter(Boolean).join('\n\n')
  snapshot={gifts:[{id:gift.id,version:gift.version,net:gift.net_cents}]}
 }
 const letterId=newId(),body='Reviewed letter copy. This does not replace an issued receipt.\n\n'+rendered.body
 const letter={recipient_name:recipient.letter_name,address:recipient.letter_address,subject:rendered.subject,body},hash=await sha256(JSON.stringify(letter))
 const giftSnapshots=JSON.stringify(snapshot.gifts??[])
 await commit(c,[live(donorId),guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=?)','DONOR_CHANGED','Constituent details changed. Prepare again.',donorId,d.version),templatesUnchanged(revision),
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)','SETTINGS_CHANGED','Settings changed. Prepare again.',s.version),
  guard("NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM cf_gift_balances g WHERE g.id=json_extract(j.value,'$.id') AND g.version=json_extract(j.value,'$.version') AND g.net_cents=json_extract(j.value,'$.net') AND g.donor_id=?))",'GIFT_CHANGED','Gift facts changed. Prepare again.',giftSnapshots,donorId),
  ...(property?[guard('EXISTS(SELECT 1 FROM cf_in_kind_gifts WHERE id=? AND donor_id=? AND version=?)','GIFT_CHANGED','Property changed. Prepare again.',property.id,donorId,property.version)]:[]),
  sql(`INSERT INTO cf_single_letters(id,donor_id,status,recipient_name,address,subject,body,merge_blanks,template_kind,template_id,template_version,gift_id,in_kind_id,statement_year,context_snapshot,content_hash,prepared_at,prepared_by) VALUES(?,?,'prepared',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,letterId,donorId,letter.recipient_name,letter.address,letter.subject,letter.body,rendered.merge_blanks??'[]',kind,template?.id??null,template?.version??s.version,gift?.id??null,property?.id??null,year,JSON.stringify(snapshot),hash,c.now,c.actor.id),
  event(c,command,'single_letter',letterId,donorId,{templateId:template?.id??null,templateVersion:template?.version??s.version})])
 return {id:letterId,donorId,version:1,status:'prepared',contentHash:hash}
}
