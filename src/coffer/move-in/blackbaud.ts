import { Buffer } from 'node:buffer'
import { fail } from '../db'
import { day as sourceDay } from './source-rows'
import { blackbaudReader } from './blackbaud-edge'
import { parseExports } from './parse'
import type { ExportFile, ParseInput, ParsedImport, ParsedOpportunity } from './types'

type Row=Record<string,any>
const file=(name:string,rows:Row[]):ExportFile=>{const columns=[...new Set(rows.flatMap(Object.keys))];return {name,base64:Buffer.from([columns,...rows.map(r=>columns.map(k=>r[k]??''))].map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')).toString('base64')}}
const error=(message:string):never=>fail('SKY_UNSUPPORTED',message+' Nothing was applied.',400)
const day=(value:any)=>{const result=typeof value==='string'?sourceDay(value.slice(0,10)):value&&Number.isInteger(value.y)&&Number.isInteger(value.m)&&Number.isInteger(value.d)?sourceDay(`${value.y}-${String(value.m).padStart(2,'0')}-${String(value.d).padStart(2,'0')}`):'';if(!result)error('An incomplete source date needs review.');return result}
const cents=(value:any)=>{const n=value?.value;if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100000000||Math.abs(n*100-Math.round(n*100))>0.00001)error('SKY amounts must be exact non-negative USD cents.');return Math.round(n*100)}
const dollars=(value:number)=>(value/100).toFixed(2)
const dictionary=(value:any,label:string):Row=>{if(value===undefined)return {};if(!value||typeof value!=='object'||Array.isArray(value))error(`Review the ${label} dictionary.`);return value}
const mapped=(map:Row,id:any,label:string)=>{if(!id)return '';const value=Object.hasOwn(map,id)?map[id]:undefined;if(typeof value!=='string'||!value.trim()||value.length>100)error(`Map the source ${label} ${id} explicitly.`);return value}

/** The source review is an attested export supplement, never an invented SKY response.
 * Blackbaud does not expose independent soft-credit acknowledgments or household
 * greetings in these endpoints; those facts require source-linked review evidence. */
export async function blackbaudImport(input:ParseInput,importDay:string):Promise<ParsedImport> {
 if(input.files.length!==1||input.files[0].name!=='sky-review.json')error('Supply the documented sky-review.json mappings and source-history supplement.')
 let review:Row={}
 try{review=JSON.parse(Buffer.from(input.files[0].base64,'base64').toString('utf8'))}catch{error('The SKY review file is not valid JSON.')}
 if(!review||typeof review!=='object'||Array.isArray(review)||Object.keys(review).some(k=>!['currency','funds','campaigns','appeals','stages','owners','contactTypes','households','gifts','softCredits','customFields'].includes(k)))error('The SKY review has unsupported sections.')
 if(review!.currency!=='USD')error('Confirm USD source currency; no currency conversion is performed.')
 for(const key of ['funds','campaigns','appeals','stages','owners','contactTypes','households','gifts','softCredits'])review![key]=dictionary(review![key],key)
 const {read,list}=blackbaudReader(input.blackbaud!),people=await list('/constituent/v1/constituents?include_inactive=true&include_deceased=true')
 const ids=new Set(people.map(p=>p.id)),donors:Row[]=[],notes:Row[]=[],relationships:Row[]=[],gifts:Row[]=[],pledges:Row[]=[],credits:Row[]=[],splits=new Map<string,any[]>(),opportunities:ParsedOpportunity[]=[]
 const used={gifts:new Set<string>(),softCredits:new Set<string>()}
 const custom=review!.customFields??(typeof input.customFields==='string'?JSON.parse(input.customFields):input.customFields??[])
 if(!Array.isArray(custom))error('Review the custom column mappings.')
 const customValues=(values:Row[],kind:string,row:Row)=>{for(const value of values){const m=custom.find((m:any)=>m.kind===kind&&m.column===value.category);if(!m||value.comment||value.end||value.start||Object.hasOwn(row,value.category))error('Every custom source value needs one unambiguous reviewed column mapping; dated or annotated fields remain unsupported.');row[value.category]=typeof value.value==='object'?error('Structured custom fields need a separate mapping.'):String(value.value)}}
 const householdByPerson=new Map<string,Row>()
 for(const [id,h] of Object.entries(review!.households) as [string,Row][]){
  if(!h||!h.name||!Array.isArray(h.members)||!h.members.length||h.members.some((m:any)=>!ids.has(m))||h.headId&&!h.members.includes(h.headId)||Object.keys(h).some(k=>!['name','members','headId','addressee','formal','informal'].includes(k)))error('Review each source household identity, membership, explicit head and greetings.')
  for(const member of h.members){if(householdByPerson.has(member))error('A constituent belongs to multiple supplied source households.');householdByPerson.set(member,{...h,id})}
 }
 for(const p of people){
  const person=await read('/constituent/v1/constituents/'+encodeURIComponent(p.id))
  if(person?.id!==p.id||!person.name||!['Individual','Organization'].includes(person.type)||person.title_2||person.suffix_2)error('A constituent identity, type or name is unsupported or incomplete.')
  const formats=await read(`/constituent/v1/constituents/${encodeURIComponent(p.id)}/nameformats/summary`),h=householdByPerson.get(p.id)
  if(!formats||!formats.primary_addressee||!formats.primary_salutation||[formats.primary_addressee,formats.primary_salutation].some(f=>f.constituent_id!==p.id||typeof f.formatted_name!=='string'))error('Both primary source name formats must be complete and match their constituent.')
  const row:Row={'Constituent ID':p.id,'Name':person.name,'Is Organization':person.type==='Organization'?'yes':'no','Prefix':person.title,'First Name':person.first,'Middle Name':person.middle,'Last Name':person.last,'Suffix':person.suffix,'Nickname':person.preferred_name,'Salutation':formats.primary_salutation?.formatted_name,'Addressee':formats.primary_addressee?.formatted_name,'Constituent Status':person.deceased?'deceased':person.inactive?'inactive':'active','Date of Death':person.deceased_date?day(person.deceased_date):'','Household ID':h?.id,'Household Name':h?.name,'Head of Household ID':h?.headId,'Household Addressee':h?.addressee,'Household Formal Salutation':h?.formal,'Household Informal Salutation':h?.informal}

  const pref=await list(`/constituent/v1/constituents/${encodeURIComponent(p.id)}/communicationpreferences`)
  if(pref.some(v=>v.constituent_id!==p.id||!v.solicit_code||v.end||v.start&&day(v.start)>importDay))error('Dated, ended or incomplete solicit codes need a separate reviewed migration.')
  row['Solicit Codes']=pref.map(v=>v.solicit_code).join('; ');
  for(const prefRow of pref){const rule=input.solicitCodes?.[prefRow.solicit_code];if(rule?.type==='channels')for(const channel of rule.channels??[])row[channel==='sms'?'SMS Preference':channel[0].toUpperCase()+channel.slice(1)+' Preference']='no'}row['Restriction Date']=pref.length&&pref.every(v=>v.start)?pref.map(v=>day(v.start)).sort().at(-1):''
  for(const [kind,path] of [['email','emailaddresses'],['phone','phones'],['address','addresses']] as const){
   const points=await list(`/constituent/v1/constituents/${encodeURIComponent(p.id)}/${path}`)
   if(points.length>(kind==='address'?2:3)||points.some(v=>v.constituent_id!==p.id||v.inactive||v.start||v.end||v.seasonal_start||v.seasonal_end)||points.length&&points.filter(v=>kind==='address'?v.preferred:v.primary).length!==1)error('Review contacts: this slice requires at most three emails, three phones and two undated active addresses, each kind with one explicit primary.')
   for(const [i,v] of points.entries()){
    const label=kind==='email'?'Email':kind==='phone'?'Phone':'Address',prefix=i?label+' '+(i+1):label
    const type=mapped(review!.contactTypes,kind+':'+v.type,'contact type')
    row[label+' '+(i+1)+' Type']=type;row[label+' '+(i+1)+' Primary']=(kind==='address'?v.preferred:v.primary)?'yes':'no'
    if(kind==='address'){const lines=String(v.address_lines??'').split(/\r?\n/);if(lines.length>2)error('Addresses with more than two lines need a separate mapping.');for(const [k,value] of Object.entries({[i?'Street':'Address Line 1']:lines[0],[i?'Street 2':'Address Line 2']:lines[1],City:v.city,State:v.state,'Postal Code':v.postal_code,Country:v.country}))row[(i?prefix+' ':'')+k]=value}
    else row[prefix]=kind==='email'?v.address:v.number
    if(v.do_not_email||person.requests_no_email)row['Email Preference']='no'
    if(v.do_not_call)row['Phone Preference']='no'
    if(v.do_not_mail)row['Mail Preference']='no'
   }
  }
  customValues(await list(`/constituent/v1/constituents/${encodeURIComponent(p.id)}/customfields`),'constituent',row)
  donors.push(row)
 }
 for(const r of await list('/constituent/v1/relationships')){
  if(!ids.has(r.constituent_id)||!ids.has(r.relation_id)||r.end||r.start)error('A relationship has an unresolved identity or unsupported dates.')
  if(r.is_spouse_head_of_household||r.is_constituent_head_of_household){const h=householdByPerson.get(r.constituent_id),head=r.is_constituent_head_of_household?r.constituent_id:r.relation_id;if(r.is_spouse_head_of_household&&r.is_constituent_head_of_household||!h||!h.members.includes(r.relation_id)||h.headId!==head)error('The source relationship head flag must agree with the explicit household supplement.')}
  relationships.push({'Relationship ID':r.id,'Constituent ID':r.constituent_id,'Related Constituent ID':r.relation_id,'Relationship Type':r.is_spouse?'spouse':r.type})
 }
 for(const a of await list('/constituent/v1/actions')){
  if(!ids.has(a.constituent_id)||!a.completed||a.opportunity_id||!['Phone Call','Meeting','Email','Mailing',['Task','Other'].join('/')].includes(a.category))error('Unfinished actions, opportunity-linked actions or unresolved action identities need separate review.')
  const row={'Note ID':'action:'+a.id,'Constituent ID':a.constituent_id,'Note Date':day(a.completed_date||a.date),'Note Type':({'Phone Call':'call',Meeting:'meeting',Email:'email'} as Row)[a.category]??'note','Note':[a.summary,a.description].filter(Boolean).join('\n')}
  customValues(await list(`/constituent/v1/actions/${encodeURIComponent(a.id)}/customfields`),['call','meeting','email'].includes(row['Note Type'])?'interaction':'note',row);notes.push(row)
 }
 for(const n of await list('/constituent/v1/notes')){if(!ids.has(n.constituent_id))error('A note has an unresolved constituent.');notes.push({'Note ID':'note:'+n.id,'Constituent ID':n.constituent_id,'Note Date':day(n.date),'Note Type':'note','Note':[n.summary,n.text].filter(Boolean).join('\n')})}
 const rawGifts=await list('/gift/v1/gifts')
 for(const item of rawGifts){
  const g=await read('/gift/v1/gifts/'+encodeURIComponent(item.id)),facts=review!.gifts[item.id]??{}
  if(g?.id!==item.id||!ids.has(g.constituent_id)||!['Donation','Pledge'].includes(g.type)||g.is_anonymous||g.linked_gifts?.length||g.gift_status&&g.gift_status!=='Active')error('Unsupported gift classification, anonymity, state or links must be resolved before import.')
  if(Object.keys(facts).some(k=>!['goodsValue','acknowledgmentMethod','acknowledgmentInteractionId','tribute'].includes(k)))error('A gift source-history fact has no supported mapping.')
  used.gifts.add(g.id)
  const amount=cents(g.amount),parts=g.gift_splits
  if(!Array.isArray(parts)||!parts.length||parts.length>50||new Set(parts.map((v:Row)=>v.id)).size!==parts.length||parts.some((v:Row)=>!v.id||v.package_id)||parts.reduce((n:number,v:Row)=>n+cents(v.amount),0)!==amount)error('Source designation splits must have distinct IDs and add exactly to their parent gift.')
  const dimensions=parts.map((v:Row)=>({externalId:v.id,amountCents:cents(v.amount),fund:mapped(review!.funds,v.fund_id,'fund'),campaign:mapped(review!.campaigns,v.campaign_id,'campaign'),appeal:mapped(review!.appeals,v.appeal_id,'appeal')}))
  if(dimensions.some((v:Row)=>!v.fund)||new Set(dimensions.map((v:Row)=>v.fund)).size!==parts.length||new Set(dimensions.map((v:Row)=>v.campaign)).size>1||new Set(dimensions.map((v:Row)=>v.appeal)).size>1)error('This slice supports distinct funds with a common source campaign and appeal; other dimensions need separate review.')
  const row:Row={'Gift ID':g.id,'Constituent ID':g.constituent_id,'Gift Type':g.type==='Pledge'?'Pledge':'Gift','Gift Date':day(g.date),'Amount':dollars(amount),'Fund':parts.length>1?'':dimensions[0].fund,'Campaign':dimensions[0].campaign,'Appeal':dimensions[0].appeal,'Gift Note':g.reference}
  if(g.type==='Pledge'){if(parts.length!==1||g.soft_credits?.length||cents(g.balance)!==amount)error('Only unpaid, unsplit pledges are supported.');pledges.push(row);continue}
  if(g.payments?.length!==1)error('Each cash gift needs one supported source payment method.')
  const method=({Cash:'Cash',PersonalCheck:'Check',CreditCard:'Card',DirectDebit:'Bank transfer',Other:'Other',PayPal:'Online'} as Row)[g.payments[0].payment_method]
  if(!method)error('The source payment method is unsupported.');row['Payment Method']=method
  if(g.acknowledgements?.length>1||g.receipts?.length>1)error('Multiple acknowledgment or receipt histories need separate review.')
  const ack=g.acknowledgements?.[0],status=String(ack?.status??'NotAcknowledged').replace(/\s/g,'').toUpperCase()
  if(!['ACKNOWLEDGED','NEEDSACKNOWLEDGEMENT','NOTACKNOWLEDGED','DONOTACKNOWLEDGE'].includes(status))error('Review the source acknowledgment status.')
  row['Acknowledgment Status']=status==='DONOTACKNOWLEDGE'?'do not acknowledge':status==='ACKNOWLEDGED'?'acknowledged':'not acknowledged'
  row['Acknowledgment Date']=ack?.date?day(ack.date):'';row['Acknowledgment Reference']=ack?.letter;row['Acknowledgment Method']=facts.acknowledgmentMethod??(ack?.letter?'letter':'');row['Acknowledgment Interaction ID']=facts.acknowledgmentInteractionId?'action:'+facts.acknowledgmentInteractionId:''
  const receipt=g.receipts?.[0],goods=receipt?.amount?amount-cents(receipt.amount):facts.goodsValue===undefined?null:cents({value:facts.goodsValue})
  if(goods!==null&&(goods<0||facts.goodsValue!==undefined&&cents({value:facts.goodsValue})!==goods))error('Source receipt and benefits values disagree.')
  row['Non-Deductible Amount']=goods===null?'':dollars(goods)
  if(facts.tribute){const t=facts.tribute;if(!t.honoree||!['honor','memory'].includes(t.kind)||Object.keys(t).some(k=>!['kind','honoree','sourceGroup','recipientName','recipientAddress'].includes(k)))error('Review the source tribute type, honoree and private recipient facts.');Object.assign(row,{'Tribute Type':t.kind,'Tribute Honoree':t.honoree,'Tribute Group':t.sourceGroup,'Tribute Recipient Name':t.recipientName,'Tribute Recipient Address':t.recipientAddress})}
  customValues(await list(`/gift/v1/gifts/${encodeURIComponent(g.id)}/customfields`),'gift',row)
  gifts.push(row);if(parts.length>1)splits.set(g.id,dimensions)
  for(const credit of g.soft_credits??[]){const f=review!.softCredits[credit.id]??{};if(!credit.id||!ids.has(credit.constituent_id)||credit.gift_id!==g.id||Object.keys(f).some(k=>!['status','date','method','reference','interactionId'].includes(k)))error('Review each soft credit identity and its independent acknowledgment facts.');used.softCredits.add(credit.id);credits.push({'Soft Credit ID':credit.id,'Constituent ID':credit.constituent_id,'Related Gift ID':g.id,'Amount':dollars(cents(credit.amount)),'Acknowledgment Status':f.status??'not acknowledged','Acknowledgment Date':f.date,'Acknowledgment Method':f.method,'Acknowledgment Reference':f.reference,'Acknowledgment Interaction ID':f.interactionId?'action:'+f.interactionId:''})}
 }
 for(const o of await list('/opportunity/v1/opportunities?include_inactive=true')){
  const stage=review!.stages[o.status],fundraiser=o.fundraisers?.length===1?o.fundraisers[0].constituent_id:o.fundraisers?.length?error('Multiple source opportunity fundraisers need separate review.'):'unassigned',owner=review!.owners[fundraiser]
  if(!ids.has(o.constituent_id)||o.inactive||o.linked_gifts?.length||o.funded_date||o.funded_amount&&cents(o.funded_amount)>0||!stage||!owner||!o.name||!o.summary||Object.keys(stage).some(k=>!['stage','probability'].includes(k))||Object.keys(owner).some(k=>!['id','version'].includes(k)))error('Review source stages and current owners. Funded, closed or linked opportunities need separate migration.')
  opportunities.push({externalId:o.id,donorExternalId:o.constituent_id,label:o.name,stage:stage.stage,sourceStage:o.status,ownerId:owner.id,ownerVersion:owner.version,askAmountCents:cents(o.ask_amount),expectedAmountCents:cents(o.expected_amount),probability:stage.probability,fund:mapped(review!.funds,o.fund_id,'fund')||'Unrestricted',sourceCampaign:mapped(review!.campaigns,o.campaign_id,'campaign'),expectedCloseOn:day(o.expected_date||o.deadline),nextStep:o.summary,location:{file:'sky-opportunities.json',sheet:'SKY',row:opportunities.length+1}})
 }
 for(const section of ['gifts','softCredits'] as const)if(Object.keys(review![section]).some(id=>!used[section].has(id)))error('Source history names an object that was not read from SKY.')
 const parsed=await parseExports({source:'re-nxt',files:[...[["constituents.csv",donors],["gifts.csv",gifts],["pledges.csv",pledges],["relationships.csv",relationships],["interactions.csv",notes],["soft-credits.csv",credits]].filter(([,rows])=>(rows as Row[]).length).map(([name,rows])=>file(name as string,rows as Row[]))],solicitCodes:input.solicitCodes?Object.fromEntries(Object.entries(input.solicitCodes).map(([k,v])=>[k,v.type==='channels'?{type:'ignore' as const}:v])):undefined,customFields:custom})
 for(const gift of parsed.gifts)gift.designations=splits.get(gift.externalId)
 // Count each parent once as cash; fund dimensions independently sum source splits.
 for(const totals of [parsed.sourceTotals,parsed.mappedTotals]){
  totals.byFund=Object.create(null)
  for(const gift of parsed.gifts)for(const allocation of gift.designations??[{fund:gift.fund,amountCents:gift.amountCents}]){
   const total=totals.byFund[allocation.fund]??={giftCount:0,amountCents:0};total.giftCount++;total.amountCents+=allocation.amountCents
  }
 }
 parsed.solicitCodes=input.solicitCodes
 parsed.opportunities=opportunities
 parsed.sourceCoverage={provider:'Blackbaud SKY',currency:'USD',counts:{constituents:donors.length,gifts:gifts.length,designations:[...splits.values()].reduce((n,v)=>n+v.length,0),pledges:pledges.length,relationships:relationships.length,actionsAndNotes:notes.length,opportunities:opportunities.length},unsupported:['Full custom-field definitions and code tables (MOVE-010)','Recurring gifts, vault transfer and replacement schedules','Funded or closed opportunities and multiple fundraisers','Unfinished or opportunity-linked actions','Other gift classifications and remaining source objects','Live OAuth, account and provider qualification']}
 return parsed
}
