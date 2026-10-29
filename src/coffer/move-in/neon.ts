import { neonFields } from './neon-fields'
import { Buffer } from 'node:buffer'
import { fail } from '../db'
import { day as sourceDay } from './source-rows'
import { readNeon, type NeonSnapshot } from './neon-edge'
import type { CustomImportMapping, ExportFile, ParseInput, SourceCoverage } from './types'

type Facts=Record<string,Record<string,any>>
type History={ accounts?:Facts; donations?:Facts; registrations?:Facts; households?:Facts; softCredits?:Record<string,any>[]; memberships?:Facts; pledgePayments?:Facts; recurring?:Facts }
const file=(name:string,rows:Record<string,any>[]):ExportFile=>{const headers=[...new Set(rows.flatMap(Object.keys))];return {name,base64:Buffer.from([headers,...rows.map(r=>headers.map(h=>r[h]??''))].map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n').toString('base64')}}
const postalCode=(address:Record<string,any>)=>[address.zipCode,address.zipCodeSuffix].filter(Boolean).join('-')
const date=(value:unknown)=>typeof value==='string'?value.slice(0,10):''
const amount=(value:any)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>0.00001)fail('NEON_AMOUNT','A Neon amount needs review; this slice accepts exact non-negative USD cents.',400);return value.toFixed(2)}
const acknowledgment=(facts:Record<string,any>={})=>Object.fromEntries(['Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Reason','Acknowledgment Reference','Acknowledgment Interaction ID'].map(k=>[k,facts[k]??'']))

/** The optional history file is an explicit source report, not an API response.
 * It fills facts the Neon API does not attest: actual acknowledgment, source dates,
 * account status, contact restrictions and independent soft-credit recognition. */
export async function neonInput(input:ParseInput,importDay:string):Promise<{input:ParseInput;coverage:SourceCoverage}> {
 if(input.neon?.currency!=='USD')fail('NEON_CURRENCY','Confirm that your Neon organization records USD amounts before reviewing money. The API does not identify currency and no conversion is performed.',400)
 let history:History={}
 if(input.files.length>1||input.files.some(f=>f.name!=='neon-history.json'))fail('NEON_HISTORY','Use one optional neon-history.json source-history file.',400)
 if(input.files[0]){
  try{history=JSON.parse(Buffer.from(input.files[0].base64,'base64').toString('utf8'))}catch{fail('NEON_HISTORY','The Neon source-history file is not valid JSON.',400)}
  if(!history||typeof history!=='object'||Array.isArray(history)||Object.keys(history).some(k=>!['accounts','donations','registrations','households','softCredits','memberships','pledgePayments','recurring'].includes(k)))fail('NEON_HISTORY','Review the documented Neon source-history sections.',400)
 }
 for(const [section,allowed] of Object.entries({accounts:['status','deceasedOn','statusReason','codes','restrictionOn','preferenceOn'],households:['addressee','informal'],donations:['Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Reason','Acknowledgment Reference','Acknowledgment Interaction ID','tributeGroup'],memberships:['Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Reason','Acknowledgment Reference','Acknowledgment Interaction ID'],pledgePayments:['Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Reason','Acknowledgment Reference','Acknowledgment Interaction ID'],recurring:['customerReference','paymentMethodReference'],registrations:['Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Reason','Acknowledgment Reference','Acknowledgment Interaction ID']}))for(const facts of Object.values((history as Record<string,any>)[section]??{})){
  if(!facts||typeof facts!=='object'||Array.isArray(facts)||Object.keys(facts).some(k=>!allowed.includes(k)))fail('NEON_HISTORY','A source-history field has no supported mapping. Review it before importing.',400)
 }
 for(const facts of Object.values(history.accounts??{}))if(facts.deceasedOn){const day=sourceDay(facts.deceasedOn);if(!day||day>importDay)fail('NEON_HISTORY','A supplied date of death must be a real date on or before today in the organization time zone.',400)}
 const snapshot=await readNeon(input.neon!)
 return {input:normalizeNeon(snapshot,history,input),coverage:{currency:'USD',counts:{accounts:snapshot.accounts.length,donations:snapshot.donations.length,activities:snapshot.activities.length,eventRegistrations:snapshot.registrations.length,households:snapshot.households.length,memberships:snapshot.memberships.length,pledges:snapshot.pledges.length,recurringDonations:snapshot.recurring.length},unsupported:['Replacement recurring schedules and vault transfer','Other source objects','Split, pending, refunded, disputed and noncash payments','Native event guest-list seats']}}
}
function normalizeNeon(s:NeonSnapshot,h:History,input:ParseInput):ParseInput {
 const definitions:CustomImportMapping[]=[],donors:Record<string,any>[]=[],gifts:Record<string,any>[]=[],notes:Record<string,any>[]=[],memberships:Record<string,any>[]=[],plans:Record<string,any>[]=[],credits:Record<string,any>[]=[]
 const accountIds=new Set(s.accounts.map(a=>a.accountId)),donationIds=new Set(s.donations.map(a=>a.id)),registrationIds=new Set(s.registrations.map(a=>a.id)),householdIds=new Set(s.households.map(a=>a.id)),membershipIds=new Set(s.memberships.map(a=>a.id)),pledgePaymentIds=new Set(s.pledges.flatMap(p=>p._payments.map((v:any)=>v.id))),recurringIds=new Set(s.recurring.map(a=>a.id))
 for(const [section,ids] of [['accounts',accountIds],['donations',donationIds],['registrations',registrationIds],['households',householdIds],['memberships',membershipIds],['pledgePayments',pledgePaymentIds],['recurring',recurringIds]] as const){const facts=h[section]??{};if(typeof facts!=='object'||Array.isArray(facts)||Object.keys(facts).some(id=>!ids.has(id)))fail('NEON_HISTORY','Source history must match an imported Neon source ID.',400)}
 const fields=neonFields(s.definitions)
 definitions.push(...fields.mappings)
 const householdByAccount=new Map<string,Record<string,any>>()
 for(const household of s.households){
  if(!household.id||!household.name||!Array.isArray(household.contacts))fail('NEON_SCHEMA','A Neon household is incomplete.',502)
  const heads=household.contacts.filter((m:any)=>m.isPrimaryHouseHoldContact===true)
  if(heads.length>1)fail('NEON_SCHEMA','A Neon household has multiple explicit heads.',502)
  for(const member of household.contacts){if(!accountIds.has(member.accountId)||householdByAccount.has(member.accountId))fail('NEON_SCHEMA','A household member is missing or belongs to multiple source households.',502);householdByAccount.set(member.accountId,{...household,head:heads[0]?.accountId??''})}
 }
 for(const a of s.accounts){
  const p=a.primaryContact??{},facts=h.accounts?.[a.accountId]??{},household=householdByAccount.get(a.accountId),householdFacts=h.households?.[household?.id]??{}
  if(p.deceased===true&&facts.status&&String(facts.status).trim().toLowerCase()!=='deceased')fail('NEON_HISTORY','Source history contradicts the current Neon deceased flag. Correct the source history or Neon record and review again.',400)
  const row:Record<string,any>={'Constituent ID':a.accountId,'Name':a._company?a.name:[p.prefix,p.firstName,p.middleName,p.lastName,p.suffix].filter(Boolean).join(' '),'Is Organization':a._company?'yes':'no','Prefix':p.prefix,'First Name':p.firstName,'Middle Name':p.middleName,'Last Name':p.lastName,'Suffix':p.suffix,'Nickname':p.preferredName,'Salutation':p.salutation,'Constituent Status':facts.status??(p.deceased?'deceased':'active'),'Date of Death':facts.deceasedOn,'Status Reason':facts.statusReason,'Household ID':household?.id,'Household Name':household?.name,'Head of Household ID':household?.head,'Household Addressee':householdFacts.addressee,'Household Formal Salutation':household?.salutation,'Household Informal Salutation':householdFacts.informal,'Communication Restrictions':[a.noSolicitation?'Do not solicit':'',...(facts.codes??[])].filter(Boolean).join('; '),'Restriction Date':facts.restrictionOn,'Preference Date':facts.preferenceOn}
  for(const [i,key] of ['email1','email2','email3'].entries()){row[i?'Email '+(i+1):'Email']=p[key];if(p[key]){row['Email '+(i+1)+' Type']=i?'other':'personal';row['Email '+(i+1)+' Primary']=i?'no':'yes'}}
  const addresses=p.addresses??[]
  if(!Array.isArray(addresses)||addresses.length>32||addresses.length&&addresses.filter((v:any)=>v.isPrimaryAddress).length!==1)fail('NEON_UNSUPPORTED','Review Neon contacts: this bounded preview supports up to 32 addresses with one explicit primary.',400)
  let phone=0
  addresses.sort((a:any,b:any)=>Number(b.isPrimaryAddress)-Number(a.isPrimaryAddress))
  for(const [i,address] of addresses.entries()){
   if(address.startDate||address.endDate)fail('NEON_UNSUPPORTED','Dated Neon addresses require a separate reviewed mapping; their date meaning cannot be inferred.',400)
   const prefix=i?'Address '+(i+1)+' ':''
   for(const [target,value] of Object.entries({[i?'Street':'Address Line 1']:address.addressLine1,[i?'Street 2':'Address Line 2']:[address.addressLine2,address.addressLine3,address.addressLine4].filter(Boolean).join(', '),City:address.city,State:address.stateProvince?.code,'Postal Code':postalCode(address),Country:address.country?.name}))row[prefix+target]=value
   row['Address '+(i+1)+' Type']=address.type?.name?.toLowerCase()??'home';row['Address '+(i+1)+' Primary']=address.isPrimaryAddress?'yes':'no'
   for(let n=1;n<=3;n++)if(address['phone'+n]){if(++phone>32)fail('NEON_UNSUPPORTED','More than 32 Neon phone contacts need a separate reviewed mapping.',400);row[phone===1?'Phone':'Phone '+phone]=address['phone'+n];row['Phone '+phone+' Type']=(address['phone'+n+'Type']??'other').toLowerCase();row['Phone '+phone+' Primary']=phone===1?'yes':'no'}
  }
  for(const channel of ['email','mail','phone','sms']){
   let state=a.consent?.[channel]??'NOT_ASKED'
   if(channel==='email'&&a.email1OptOut===true)state='DECLINED'
   if(!['GIVEN','DECLINED','NOT_ASKED'].includes(state))fail('NEON_SCHEMA','An unknown Neon consent value needs review.',502)
   const label=channel==='sms'?'SMS':channel[0].toUpperCase()+channel.slice(1)
   row[label+' Preference']=({GIVEN:'yes',DECLINED:'no',NOT_ASKED:'unknown'} as Record<string,string>)[state]
  }
  Object.assign(row,fields.values('Account',a.accountCustomFields))
  donors.push(row)
 }
 for(const activity of s.activities){
  if(!Array.isArray(activity.clientAccount)||activity.clientAccount.length!==1||!accountIds.has(activity.clientAccount[0].accountId))fail('NEON_UNSUPPORTED','Review activities linked to multiple accounts separately; no ambiguous donor is chosen.',400)
  const kind=String(activity.activityType?.name??'').toLowerCase(),type=({email:'email',call:'call','phone call':'call',meeting:'meeting'} as Record<string,string>)[kind]??'note'
  notes.push({'Interaction ID':activity.id,'Constituent ID':activity.clientAccount[0].accountId,'Interaction Date':date(activity.activityDates?.startDate),'Interaction Type':type,'Note':[activity.subject,activity.note].filter(Boolean).join('\n'),...fields.values('Activity',activity.activityCustomFields)})
 }
 const paymentIds=new Set<string>()
 const cash=(record:any,externalId:string,accountId:string,on:string,facts:Record<string,any>,event=false)=>{
  const payments=record.payments
  if(record.payLater||!Array.isArray(payments)||payments.length!==1||payments[0].paymentStatus!=='Succeeded'||payments[0].inKind||record.status&&!['Succeeded','SUCCEEDED'].includes(record.status)||record.registrantCustomFields?.length)fail('NEON_UNSUPPORTED','Only fully paid single-payment donations and registrations are supported. Pending, refunded, split and noncash records need separate review; none were counted as cash.',400)
  if(!payments[0].id||paymentIds.has(String(payments[0].id)))fail('NEON_AMOUNT','A source payment is missing its ID or is repeated across transactions. Nothing was counted twice.',400)
  paymentIds.add(String(payments[0].id))
  const tender=s.tenders.find(t=>String(t.id)===String(payments[0].tenderType))
  if(payments[0].tenderType!==undefined&&!tender?.name)fail('NEON_SCHEMA','A payment tender has no matching Neon definition. Review the source before importing.',502)
  const value=event?record.totalCharge??record.registrationAmount:record.amount
  if(amount(payments[0].amount)!==amount(value))fail('NEON_AMOUNT','Neon payment and transaction amounts do not match.',400)
  const goods=record.taxDeductibleInfo?.nonDeductibleAmount
  const row:Record<string,any>={'Gift ID':externalId,'Constituent ID':accountId,'Gift Type':'Gift','Gift Date':date(payments[0].receivedDate)||date(on),'Amount':amount(value),'Fund':event?'Neon event '+record.eventId:record.fund?.name,'Campaign':record.campaign?.name,'Channel':event?'Event':'','Payment Method':tender?.name??(payments[0].check?'Check':'imported'),'Non-Deductible Amount':goods===undefined?'':amount(goods),'Goods Description':record.taxDeductibleInfo?.nonDeductibleDescription,...acknowledgment(facts),...(!event?fields.values('Donation',record.donationCustomFields):{})}
  if(record.tribute){if(!['Honor','Memory'].includes(record.tribute.type))fail('NEON_SCHEMA','Review the Neon tribute kind.',502);Object.assign(row,{'Tribute Honoree':record.tribute.name,'Tribute Type':record.tribute.type,'Tribute Group':facts.tributeGroup,'Tribute Recipient Name':record.acknowledgee?.name,'Tribute Recipient Address':record.acknowledgee?.address?[record.acknowledgee.address.addressLine1,record.acknowledgee.address.addressLine2,record.acknowledgee.address.addressLine3,record.acknowledgee.address.addressLine4,record.acknowledgee.address.city,record.acknowledgee.address.stateProvince?.code??record.acknowledgee.address.stateProvince?.name,postalCode(record.acknowledgee.address),record.acknowledgee.address.country?.name].filter(Boolean).join(', '):'','Tribute Recipient Email':record.acknowledgee?.email})}
  gifts.push(row)
  return row
 }
 for(const donation of s.donations)cash(donation,donation.id,donation.accountId,donation.date,h.donations?.[donation.id]??{})
 for(const registration of s.registrations)cash(registration,'event:'+registration.id,registration.registrantAccountId,registration.registrationDateTime,h.registrations?.[registration.id]??{},true)
 for(const membership of s.memberships){
  if(!membership.membershipLevel?.id||!membership.membershipLevel?.name||!membership.termStartDate||typeof membership.isActive!=='boolean'||typeof membership.autoRenewal!=='boolean'||membership.membershipCustomFields?.length)fail('NEON_UNSUPPORTED','Review the complete source membership level, dates, flags and fields before importing.',400)
  const fee=amount(membership.fee),charge=amount(membership.totalCharge??membership.fee),paid=membership.status==='SUCCEEDED'&&Number(charge)>0&&!membership.complimentary
  let giftId=''
  if(paid){giftId='membership:'+membership.id;cash({...membership,amount:Number(charge)},giftId,membership.accountId,membership.transactionDate,h.memberships?.[membership.id]??{})}
  else if(membership.payments?.some((p:any)=>p.paymentStatus==='Succeeded'))fail('NEON_UNSUPPORTED','A non-successful membership has received payments. Review its signed payment history before importing; none were counted as cash.',400)
  memberships.push({'Source Membership ID':membership.id,'Constituent ID':membership.accountId,'Membership Level ID':membership.membershipLevel.id,'Membership Level':membership.membershipLevel.name,'Membership Term':membership.membershipTerm?.name,'Membership Starts':date(membership.termStartDate),'Membership Ends':date(membership.termEndDate),'Membership Status':membership.status,'Membership Fee':fee,'Membership Gift ID':giftId,'Source Auto Renewal':String(membership.autoRenewal),'Source Active':String(membership.isActive)})
 }
 for(const pledge of s.pledges){
  if(!['Open','Closed'].includes(pledge.pledgeStatus)||pledge.tribute)fail('NEON_UNSUPPORTED','Review this pledge status, tribute or custom fields separately before importing.',400)
  const id='pledge:'+pledge.id
  gifts.push({'Gift ID':id,'Constituent ID':pledge.accountId,'Gift Type':'Pledge','Gift Date':date(pledge.date),'Amount':amount(pledge.amount),'Fund':pledge.fund?.name,'Campaign':pledge.campaign?.name,'Note':'Neon pledge status: '+pledge.pledgeStatus,...fields.values('Donation',pledge.donationCustomFields)})
  const schedule=pledge._installments
  if(!schedule.length)fail('NEON_UNSUPPORTED','This pledge has no dated source installments. Review its full schedule before importing.',400)
  for(const i of schedule){if(i.pledgeId!==pledge.id||!i.id)fail('NEON_SCHEMA','A source installment belongs to another pledge.',502);gifts.push({'Installment ID':'installment:'+i.id,'Pledge ID':id,'Due Date':date(i.expectedDate),'Installment Amount':amount(i.amount)})}
  let paid=0
  for(const payment of pledge._payments){
   if(payment.pledgeId!==pledge.id||!payment.id||payment.installmentId&&!schedule.some((i:any)=>i.id===payment.installmentId))fail('NEON_SCHEMA','A source pledge payment has mismatched evidence.',502)
   const row=cash({amount:payment.payment?.amount,payments:[payment.payment],taxDeductibleInfo:payment.taxDeductibleInfo,fund:pledge.fund,campaign:pledge.campaign},'pledge-payment:'+payment.id,pledge.accountId,payment.date,h.pledgePayments?.[payment.id]??{})
   row['Parent Gift ID']=id;row['Payment Installment ID']=payment.installmentId?'installment:'+payment.installmentId:'';paid+=payment.payment.amount
  }
  if(pledge.pledgeStatus==='Closed'&&Math.round(paid*100)!==Math.round(pledge.amount*100))fail('NEON_UNSUPPORTED','A closed pledge has an unpaid balance. Its source write-off history must be reviewed before importing.',400)
 }
 for(const plan of s.recurring){
  const facts=h.recurring?.[plan.id]??{}
  if(!Number.isSafeInteger(plan.period)||plan.period<1||!['YEAR','MONTH','DAY','LIFE','WEEK'].includes(plan.periodType))fail('NEON_SCHEMA','The recurring source frequency is incomplete.',502)
  plans.push({'Plan ID':plan.id,'Constituent ID':plan.accountId,'Amount':amount(plan.amount),'Frequency':plan.period+' '+plan.periodType.toLowerCase(),'Plan Status':plan.status,'Next Charge Date':date(plan.nextDate),'Payment Method':plan.method,'Campaign':plan.campaign,'Processor Customer Reference':facts.customerReference,'Processor Payment Method Reference':facts.paymentMethodReference})
 }
 if(h.softCredits!==undefined&&!Array.isArray(h.softCredits))fail('NEON_HISTORY','Source soft credits must be a list.',400)
 for(const credit of h.softCredits??[]){if(!credit||typeof credit!=='object'||Array.isArray(credit)||Object.keys(credit).some(k=>!['id','accountId','donationId','amount','Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Reason','Acknowledgment Reference','Acknowledgment Interaction ID'].includes(k)))fail('NEON_HISTORY','Review the supported soft-credit source-history fields.',400);if(!credit.id||!accountIds.has(credit.accountId)||!donationIds.has(credit.donationId))fail('NEON_HISTORY','A soft credit needs its own source ID, imported account and donation.',400);credits.push({'Soft Credit ID':credit.id,'Constituent ID':credit.accountId,'Related Gift ID':credit.donationId,'Amount':amount(credit.amount),...acknowledgment(credit)})}
 return {source:'neon',files:[...(donors.length?[file('constituents.csv',donors)]:[]),...(gifts.length?[file('gifts.csv',gifts)]:[]),...(notes.length?[file('interactions.csv',notes)]:[]),...(credits.length?[file('soft-credits.csv',credits)]:[]),...(memberships.length?[file('memberships.csv',memberships)]:[]),...(plans.length?[file('recurring-plans.csv',plans)]:[])],customFields:[...definitions,...(s.pledges.length?definitions.filter(m=>m.kind==='gift').map(m=>({...m,key:m.key+'_pledge',kind:'pledge' as const})):[])].flatMap(m=>m.kind==='interaction'?[...new Set(notes.length?notes.map(n=>['call','meeting','email'].includes(n['Interaction Type'])?'interaction':'note'):['interaction'])].map(kind=>({...m,key:m.key+(kind==='note'?'_note':''),kind:kind as 'interaction'|'note'})):m),solicitCodes:input.solicitCodes,noGoodsOrServices:input.noGoodsOrServices}
}
