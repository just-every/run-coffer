import { Buffer } from 'node:buffer'
import { fail } from '../db'
import { day } from './source-rows'
import { readBloomerang, sourceId } from './bloomerang-edge'
import { bloomerangRecurring } from './bloomerang-recurring'
import type { ExportFile, ParseInput, ParsedTask, ParsedRecurringReference, SourceCoverage } from './types'

type Facts=Record<string,any>
const file=(name:string,rows:Facts[]):ExportFile=>{const headers=[...new Set(rows.flatMap(Object.keys))];return {name,base64:Buffer.from([headers,...rows.map(r=>headers.map(h=>r[h]??''))].map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n').toString('base64')}}
const money=(value:unknown)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>0.00001)fail('BLOOMERANG_AMOUNT','A Bloomerang amount needs review; only exact non-negative USD cents are supported.',400);return value.toFixed(2)}
const dated=(value:unknown)=>{const result=day(typeof value==='string'?value.slice(0,10):'');if(!result)fail('BLOOMERANG_DATE','A source date is missing or invalid. Review it before importing.',400);return result}
const fields=(value:Facts,allowed:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('BLOOMERANG_HISTORY','A source-history field has no supported mapping. Review the documented history shape.',400)}
const ackFields=['Acknowledgment Date','Acknowledgment Method','Acknowledgment Reference','Acknowledgment Interaction ID','Acknowledgment Reason']

/** v1 omits household, relationship and historical consent and acknowledgment detail.
 * An optional explicit source report supplies those facts, separately from API facts. */
export async function bloomerangInput(input:ParseInput,importDay:string):Promise<{input:ParseInput;tasks:ParsedTask[];recurringReferences:ParsedRecurringReference[];coverage:SourceCoverage}> {
 const connection=input.bloomerang!
 if(connection.currency!=='USD')fail('BLOOMERANG_CURRENCY','Confirm the source account records USD. No currency conversion is performed.',400)
 if(input.files.length>1||input.files.some(f=>f.name!=='bloomerang-history.json'))fail('BLOOMERANG_HISTORY','Use one optional bloomerang-history.json source-history report.',400)
 let history:Facts={}
 if(input.files[0]){try{history=JSON.parse(Buffer.from(input.files[0].base64,'base64').toString('utf8'))}catch{fail('BLOOMERANG_HISTORY','The Bloomerang source-history report is not valid JSON.',400)}}
 fields(history,['constituents','households','relationships','acknowledgments','softCredits','transactions','recurringPlans'])
 const s=await readBloomerang(connection.apiKey),accountNumbers=new Map<string,string>(),byId=new Map(s.constituents.map(a=>[sourceId(a.Id),a]))
 for(const a of s.constituents){const number=sourceId(a.AccountNumber);if([...accountNumbers.values()].includes(number))fail('BLOOMERANG_SCHEMA','Bloomerang repeated an account number.',502);accountNumbers.set(sourceId(a.Id),number)}
 const person=(id:unknown)=>{const value=accountNumbers.get(sourceId(id));if(!value)fail('BLOOMERANG_REFERENCE','A source record refers to a constituent outside this complete read.',400);return value}
 for(const section of ['constituents','acknowledgments','softCredits','transactions','recurringPlans'])if(history[section]!==undefined&&(typeof history[section]!=='object'||history[section]===null||Array.isArray(history[section])))fail('BLOOMERANG_HISTORY','Source-history facts must be keyed by numeric source ID.',400)
 for(const id of Object.keys(history.constituents??{}))if(!byId.has(id))fail('BLOOMERANG_HISTORY','Source history names a constituent absent from the API read.',400)
 const householdByPerson=new Map<string,Facts>()
 if(history.households!==undefined&&!Array.isArray(history.households)||history.relationships!==undefined&&!Array.isArray(history.relationships))fail('BLOOMERANG_HISTORY','Households and relationships must be source record lists.',400)
 for(const h of history.households??[]){
  fields(h,['id','name','members','headId','addressee','formal','informal'])
  if(!h.id||typeof h.name!=='string'||!h.name.trim()||!Array.isArray(h.members)||!h.members.length||new Set(h.members).size!==h.members.length||h.headId!==undefined&&!h.members.includes(h.headId))fail('BLOOMERANG_HISTORY','Review the source household identity, members and explicit head.',400)
  for(const id of h.members){person(id);if(householdByPerson.has(String(id)))fail('BLOOMERANG_HISTORY','A source member belongs to multiple households.',400);householdByPerson.set(String(id),h)}
 }
 const donors:Facts[]=[],gifts:Facts[]=[],notes:Facts[]=[],pledges:Facts[]=[],credits:Facts[]=[],relationships:Facts[]=[],tasks:ParsedTask[]=[],recurringReferences:ParsedRecurringReference[]=[],usedAck=new Set<string>(),usedCredit=new Set<string>()
 const noCustom=(record:Facts)=>{if(record.CustomFields&&Object.keys(record.CustomFields).length)fail('BLOOMERANG_UNSUPPORTED','Custom values require a separately reviewed field-definition mapping. This API slice does not silently drop them; use the existing export and enrichment doors.',400)}
 const acknowledgment=(record:Facts,id:string)=>{
  const facts=history.acknowledgments?.[id]??{};fields(facts,ackFields);usedAck.add(id)
  return {'Acknowledgment Status':record.AcknowledgementStatus,...facts}
 }
 for(const a of s.constituents){
  noCustom(a)
  if(!['Individual','Organization'].includes(a.Type)||!['Active','Inactive','Deceased'].includes(a.Status)||!['All','Custom','OptedOut'].includes(a.EmailInterestType))fail('BLOOMERANG_UNSUPPORTED','An unsupported constituent or preference classification needs review.',400)
  const facts=history.constituents?.[String(a.Id)]??{};fields(facts,['deceasedOn','statusReason','restrictions','restrictionOn','preferenceOn','preferences'])
  if(facts.deceasedOn&&(a.Status!=='Deceased'||dated(facts.deceasedOn)>importDay))fail('BLOOMERANG_HISTORY','Date of death must agree with source status and not be in the future.',400)
  const hh=householdByPerson.get(String(a.Id)),r:Facts={'Account Number':person(a.Id),'Name':a.FullName,'Is Organization':a.Type==='Organization'?'yes':'no','Prefix':a.Prefix,'First Name':a.FirstName,'Middle Name':a.Middle,'Last Name':a.LastName,'Suffix':a.Suffix,'Informal Name':a.InformalName,'Formal Name':a.FormalName,'Envelope Name':a.EnvelopeName,'Recognition Name':a.RecognitionName,'Constituent Status':a.Status,'Date of Death':facts.deceasedOn,'Status Reason':facts.statusReason,'Household ID':hh?.id,'Household Name':hh?.name,'Head of Household ID':hh?.headId?person(hh.headId):'','Household Addressee':hh?.addressee,'Household Formal Salutation':hh?.formal,'Household Informal Salutation':hh?.informal,'Communication Restrictions':facts.restrictions??'','Restriction Date':facts.restrictionOn,'Preference Date':facts.preferenceOn}
  for(const [kind,list,key] of [['Email',a.Emails,'Value'],['Phone',a.Phones,'Number'],['Address',a.Addresses,'Street']] as const){
   if(!Array.isArray(list)||list.length>(kind==='Address'?2:3)||list.length&&list.filter((v:Facts)=>v.IsPrimary===true).length!==1)fail('BLOOMERANG_UNSUPPORTED','Review contacts: this slice supports three emails, three phones and two addresses, each kind with one explicit primary.',400)
   for(const [i,p] of list.entries()){
    if(sourceId(p.AccountId)!==String(a.Id)||p.IsBad||typeof p.IsPrimary!=='boolean'||!p[key]||p.Extension)fail('BLOOMERANG_UNSUPPORTED','A contact is incomplete, bad, extended or belongs to another constituent; review it before importing.',400)
    let type=String(p.TypeName??'').trim().toLowerCase()
    if(!type)fail('BLOOMERANG_UNSUPPORTED','A source contact has no type. Review its TypeName before importing; no contact type is guessed.',400)
    if(kind==='Email'&&type==='home')type='personal'
    r[kind+' '+(i+1)+' Type']=type;r[kind+' '+(i+1)+' Primary']=p.IsPrimary?'yes':'no'
    if(kind==='Address'){const prefix=i?'Address 2 ':'';Object.assign(r,{[prefix+(i?'Street':'Address Line 1')]:p.Street,[prefix+'City']:p.City,[prefix+'State']:p.State,[prefix+'Postal Code']:p.PostalCode,[prefix+'Country']:p.Country})}
    else r[i?kind+' '+(i+1):kind]=p[key]
   }
  }
  if(facts.preferences!==undefined)fields(facts.preferences,['email','mail','phone','sms'])
  for(const channel of ['email','mail','phone','sms']){
   let state=facts.preferences?.[channel]??'unknown'
   // "All" is an email-interest category, never evidence of affirmative consent.
   if(channel==='email'&&a.EmailInterestType==='OptedOut')state='no'
   if(!['yes','no','unknown'].includes(state))fail('BLOOMERANG_HISTORY','Source channel preferences must be yes, no or unknown.',400)
   r[(channel==='sms'?'SMS':channel[0].toUpperCase()+channel.slice(1))+' Preference']=state
  }
  donors.push(r)
  const timeline=s.timelines[String(a.Id)]
  for(const p of timeline.RecurringDonations){noCustom(p);recurringReferences.push(bloomerangRecurring(p,history.recurringPlans?.[String(p.Id)],person(a.Id)))}
  for(const n of [...timeline.Notes,...timeline.Interactions]){
   noCustom(n)
   const interaction=timeline.Interactions.includes(n),type=interaction?({Email:'email',Phone:'call',InPerson:'meeting'} as Record<string,string>)[n.Channel]:undefined
   if(interaction&&!type)fail('BLOOMERANG_UNSUPPORTED','This slice supports email, phone and in-person interactions. Other interaction classifications need review.',400)
   notes.push({'Note ID':String(n.Id),'Account Number':person(a.Id),'Note Date':dated(n.Date),'Note Type':type??'general','Note':[n.Subject,n.Note].filter(Boolean).join('\n')})
  }
  for(const p of timeline.Pledges){noCustom(p);if(p.EntryType!=='Pledge')fail('BLOOMERANG_UNSUPPORTED','Unsupported pledge classification.',400);pledges.push({'Transaction Number':String(p.Id),'Account Number':person(a.Id),'Transaction Type':'Pledge','Date':dated(p.Date),'Amount':money(p.Amount),'Fund':p.FundName,'Campaign':p.CampaignName,'Appeal':p.AppealName,'Note':p.Note})}
  for(const g of [...timeline.Donations,...timeline.PledgePayments,...timeline.RecurringDonationPayments]){
   noCustom(g)
   const facts=history.transactions?.[String(g.Id)]??{};fields(facts,['tributeGroup','notifiedName','notifiedEmail','notifiedAddress','recurringPlanId'])
   if(!['Donation','PledgePayment','RecurringDonationPayment'].includes(g.EntryType)||g.IsRefunded||g.RefundedAmount||g.Designations?.length||g.IsInKind)fail('BLOOMERANG_UNSUPPORTED','Split, refunded, noncash or unsupported transactions need separate review; none were counted as cash.',400)
   const recurring=g.EntryType==='RecurringDonationPayment'
   if(recurring&&(typeof facts.recurringPlanId!=='number'||!recurringReferences.some(p=>p.externalId===String(facts.recurringPlanId)&&p.donorExternalId===person(a.Id)))||!recurring&&facts.recurringPlanId!==undefined)fail('BLOOMERANG_RECURRING','Each historical recurring payment needs an explicit source-plan link belonging to the same constituent.',400)
   const methods=['Cash','Check','CreditCard','Eft'].filter(k=>g[k]);if(methods.length!==1)fail('BLOOMERANG_UNSUPPORTED','Review the source payment method before importing.',400)
   if(g.Check?.Number!==undefined&&typeof g.Check.Number!=='string')fail('BLOOMERANG_UNSUPPORTED','A source check number needs a text reference. Review it before importing.',400)
   const r:Facts={'Transaction Number':String(g.Id),'Account Number':person(a.Id),'Transaction Type':g.EntryType==='PledgePayment'?'Pledge Payment':'Donation','Parent Gift ID':g.EntryType==='PledgePayment'?String(sourceId(g.PledgeId)):'','Date':dated(g.Date),'Amount':money(g.Amount),'Fund':g.FundName,'Campaign':g.CampaignName,'Appeal':g.AppealName,'Check Number':g.Check?.Number??'','Payment Method':({Cash:'Cash',Check:'Check',CreditCard:'Credit Card',Eft:'EFT'} as Facts)[methods[0]],'Non-Deductible Amount':g.NonDeductible===undefined?'':money(g.NonDeductible),'Note':[g.Note,recurring?'Bloomerang source plan '+facts.recurringPlanId+' (historical payment).':''].filter(Boolean).join('\n'),'Tribute':g.TributeName,'Tribute Type':g.TributeType,'Tribute Group':facts.tributeGroup,'Tribute Recipient Name':facts.notifiedName,'Tribute Recipient Email':facts.notifiedEmail,'Tribute Recipient Address':facts.notifiedAddress,...acknowledgment(g,String(g.Id))}
   gifts.push(r)
   if(g.SoftCredits!==undefined&&!Array.isArray(g.SoftCredits))fail('BLOOMERANG_SCHEMA','Soft credits must be a complete source list.',502)
   for(const credit of g.SoftCredits??[]){
    const id=sourceId(credit.Id),facts=history.softCredits?.[id]??{};fields(facts,ackFields);if(usedCredit.has(id))fail('BLOOMERANG_SCHEMA','A soft credit source ID is repeated.',502);usedCredit.add(id)
    credits.push({'Soft Credit ID':id,'Account Number':person(credit.AccountId),'Related Gift ID':String(g.Id),'Amount':money(credit.Amount),'Acknowledgment Status':credit.AcknowledgementStatus,...facts})
   }
  }
  for(const t of timeline.Tasks){
   noCustom(t)
   if(!['Open','Complete','Archived'].includes(t.Status))fail('BLOOMERANG_UNSUPPORTED','Review the unsupported source task status. No task was omitted.',400)
   const completed=t.CompletedDate&&t.CompletedDate!=='0001-01-01T00:00:00',completedOn=completed?dated(t.CompletedDate):undefined
   if(t.Status==='Open'&&(completed||t.InteractionId)||t.Status!=='Open'&&(!completedOn||completedOn>importDay))fail('BLOOMERANG_UNSUPPORTED','Open tasks cannot have completion facts; completed and archived tasks need their actual past completion date.',400)
   const interactionExternalId=t.InteractionId?sourceId(t.InteractionId):undefined
   if(interactionExternalId&&!timeline.Interactions.some(i=>String(i.Id)===interactionExternalId))fail('BLOOMERANG_REFERENCE','A completed task must link an interaction belonging to the same source constituent.',400)
   const sourceOwnerId=sourceId(t.AssignedToUserId),ownerId=connection.taskOwners?.[sourceOwnerId]
   if(typeof ownerId!=='string'||!ownerId)fail('BLOOMERANG_OWNER','Map every source task owner to a current Coffer team member before previewing. No owner is guessed.',400)
   if(typeof t.Subject!=='string'||!t.Subject.trim()||t.Subject.length>1000)fail('BLOOMERANG_UNSUPPORTED','A task needs a supported source subject.',400)
   if(t.Note!==undefined&&(typeof t.Note!=='string'||t.Note.length>8000))fail('BLOOMERANG_UNSUPPORTED','A source task note must be text within the native note limit.',400)
   tasks.push({externalId:String(t.Id),donorExternalId:person(a.Id),sourceOwnerId,ownerId,dueOn:dated(t.DueDate),title:t.Subject,sourceStatus:t.Status,completedOn,interactionExternalId,notes:t.Note||undefined,location:{file:'Bloomerang Task '+t.Id,sheet:'REST',row:1}})
  }
 }
 for(const r of history.relationships??[]){fields(r,['id','accountId','relatedAccountId','type']);if(!r.id||!['spouse','employer','board_member','foundation_officer','introduced_by'].includes(r.type))fail('BLOOMERANG_HISTORY','Review the source relationship identity and classification.',400);relationships.push({'Relationship ID':r.id,'Account Number':person(r.accountId),'Related Account Number':person(r.relatedAccountId),'Relationship Type':r.type})}
 if([...Object.keys(history.acknowledgments??{}),...Object.keys(history.transactions??{})].some(id=>!usedAck.has(id))||Object.keys(history.softCredits??{}).some(id=>!usedCredit.has(id)))fail('BLOOMERANG_HISTORY','Acknowledgment source history names a record absent from the API read.',400)
 if(Object.keys(history.recurringPlans??{}).some(id=>!recurringReferences.some(p=>p.externalId===id)))fail('BLOOMERANG_RECURRING','The source schedule report names a plan absent from the complete API read.',400)
 const tables=[['constituents',donors],['gifts',gifts],['pledges',pledges],['notes',notes],['soft-credits',credits],['relationships',relationships]] as [string,Facts[]][]
 return {input:{source:'bloomerang',files:tables.filter(([,rows])=>rows.length).map(([name,rows])=>file(name+'.csv',rows)),solicitCodes:input.solicitCodes},tasks,recurringReferences,coverage:{currency:'USD',counts:{constituents:donors.length,transactions:gifts.length,pledges:pledges.length,notesAndInteractions:notes.length,tasks:tasks.length,recurringPlans:recurringReferences.length,households:(history.households??[]).length,relationships:relationships.length,softCredits:credits.length},unsupported:['Complete custom-field definitions and code lists','Provider-validated vault transfer and replacement schedules','Other contact and source-object classifications','Undated tasks and unknown task classifications','Live Bloomerang qualification']}}
}
