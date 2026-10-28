import { Buffer } from 'node:buffer'
import { fail } from '../db'
import { parseCsv } from './parse-input'
import type { ParseInput } from './types'

type RecordRow=Record<string,any>
const api='https://api.givebutter.com/v1/'
/** Read-only network boundary. Never follow a provider-controlled credential redirect. */
async function get(path:string,key:string):Promise<any> {
 let response:Response
 try{response=await fetch(api+path,{headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000)})}
 catch{fail('GIVEBUTTER_READ','Givebutter could not be read. Nothing was imported; try a fresh review.',502)}
 if(!response!.ok)fail('GIVEBUTTER_READ',`Givebutter read failed (HTTP ${response!.status}). Nothing was imported.`,502)
 const text=await response!.text()
 if(text.length>4*1024*1024)fail('GIVEBUTTER_LIMIT','Split the source history into smaller exports.',400)
 try{return JSON.parse(text)}catch{fail('GIVEBUTTER_READ','Givebutter returned unreadable history. Nothing was imported.',502)}
}
async function list(resource:string,key:string) {
 const rows:RecordRow[]=[]
 let lastPage:number|undefined,total:number|undefined
 for(let page=1;page<=100;page++){
  const result=await get(resource+'?page='+page,key)
  if(!Array.isArray(result.data)||!result.meta||!Number.isInteger(result.meta.last_page)||result.meta.last_page<1||result.meta.current_page!==page||lastPage!==undefined&&result.meta.last_page!==lastPage)fail('GIVEBUTTER_SCHEMA','Givebutter pagination is incomplete; no partial history was imported.',502)
  lastPage=result.meta.last_page
  if(result.meta.total!==undefined){if(!Number.isSafeInteger(result.meta.total)||result.meta.total<0||total!==undefined&&total!==result.meta.total)fail('GIVEBUTTER_SCHEMA','Givebutter source counts changed during the read. Review again.',502);total=result.meta.total}
  rows.push(...result.data)
  if(rows.length>10000)fail('GIVEBUTTER_LIMIT','Use bounded source exports for more than 10,000 records.',400)
  if(page>=result.meta.last_page){if(total!==undefined&&total!==rows.length)fail('GIVEBUTTER_SCHEMA','Givebutter source counts do not match the returned records.',502);return rows}
 }
 fail('GIVEBUTTER_LIMIT','Givebutter history exceeded 100 pages. Nothing was imported.',400)
}
const file=(name:string,rows:RecordRow[])=>{
 const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))],cell=(value:unknown)=>'\"'+String(value??'').replaceAll('\"','\"\"')+'\"'
 return {name,base64:Buffer.from([keys,...rows.map(r=>keys.map(k=>r[k]??''))].map(r=>r.map(cell).join(',')).join('\r\n')).toString('base64')}
}
const date=(value:unknown)=>typeof value==='string'?value.slice(0,10):''
function contactColumns(c:RecordRow):RecordRow {
 const result:RecordRow={}
 for(const [kind,plural,max] of [['Email','emails',3],['Phone','phones',3]] as const){
  const values=[...(c[plural]??[])]
  const primary=c['primary_'+kind.toLowerCase()]
  if(primary&&!values.some(v=>v.value===primary))values.unshift({value:primary,type:kind==='Email'?'personal':'mobile'})
  if(values.length>max)fail('GIVEBUTTER_CONTACT','This contact exceeds the supported contact columns. Export and map all values before importing.',400)
  values.sort((a,b)=>Number(b.value===primary)-Number(a.value===primary))
  values.forEach((point,i)=>{result[kind+(i?' '+(i+1):'')]=point.value;result[kind+' '+(i+1)+' Type']=point.type||'other';result[kind+' '+(i+1)+' Primary']=i===0?'yes':'no'})
 }
 const addresses=[...(c.addresses??[])]
 if(c.primary_address&&!addresses.some(a=>a.address_1===c.primary_address.address_1&&a.zipcode===c.primary_address.zipcode))addresses.unshift(c.primary_address)
 if(addresses.length>2)fail('GIVEBUTTER_CONTACT','This contact has more than two source addresses. Export and map all addresses before importing.',400)
 addresses.sort((a,b)=>Number(Boolean(b.is_primary))-Number(Boolean(a.is_primary)))
 addresses.forEach((a,i)=>{
  const prefix=i?'Address 2 ':''
  for(const [column,value] of Object.entries(i?{'Street':a.address_1,'Street 2':a.address_2,'City':a.city,'State':a.state,'Postal Code':a.zipcode,'Country':a.country}:{'Address':a.address_1,'Address Line 2':a.address_2,'City':a.city,'State':a.state,'Postal Code':a.zipcode,'Country':a.country}))result[prefix+column]=value
  result['Address '+(i+1)+' Type']=a.type||'home';result['Address '+(i+1)+' Primary']=i===0?'yes':'no'
 })
 return result
}

/** Public API fields plus operator-supplied source evidence, matched only by source ID.
 * Evidence fills fields the API may omit; it cannot overwrite API money or identity. */
export async function givebutterInput(input:ParseInput):Promise<ParseInput> {
 const key=input.givebutterKey
 if(typeof key!=='string'||!key.trim()||/[\r\n]/.test(key))fail('GIVEBUTTER_KEY','Supply a Givebutter read key for this preview.',400)
 if(!['cents','dollars'].includes(input.givebutterAmountUnit??''))fail('GIVEBUTTER_UNITS','Review whether the source amounts are cents or dollars.',400)
 const dollars=(value:unknown)=>{
  if(value===undefined||value===null||value==='')return ''
  if(input.givebutterAmountUnit==='cents'){
   if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value)))fail('GIVEBUTTER_AMOUNT','Source cents must be whole non-negative amounts.',400)
   return (Number(value)/100).toFixed(2)
  }
  if(!/^\d+(?:\.\d{1,2})?$/.test(String(value)))fail('GIVEBUTTER_AMOUNT','Source dollars must have at most two decimal places.',400)
  return String(value)
 }
 const [contacts,transactions,plans,campaigns]=await Promise.all(['contacts','transactions','plans','campaigns'].map(r=>list(r,key!)))
 const details=[]
 for(const transaction of transactions){if(!transaction.id)fail('GIVEBUTTER_SCHEMA','A source transaction has no ID.',502);const result=await get('transactions/'+encodeURIComponent(transaction.id),key!);if(!result.data||result.data.id!==transaction.id)fail('GIVEBUTTER_SCHEMA','Givebutter transaction details do not match the listed ID.',502);details.push(result.data)}
 const extraFiles:ParseInput['files']=[]
 const contactEvidence=new Map<string,RecordRow>(),giftEvidence=new Map<string,RecordRow>(),planEvidence=new Map<string,RecordRow>()
 for(const f of input.files??[]) {
  if(!/\.csv$/i.test(f.name))fail('GIVEBUTTER_EVIDENCE','Source evidence must be CSV.',400)
  const rows=parseCsv(Buffer.from(f.base64,'base64').toString('utf8')),headers=rows[0]?.map(String)??[]
  if(!headers.includes('Gift ID')&&!headers.includes('Plan ID')&&headers.some(h=>['Note ID','Interaction ID','Soft Credit ID','Relationship ID'].includes(h))){extraFiles.push(f);continue}
  for(const row of rows.slice(1)){
   const values=Object.fromEntries(headers.map((h,i)=>[h,row[i]??''])),id=String(values['Plan ID']||values['Gift ID']||values['Constituent ID']||'')
   const target=values['Plan ID']?planEvidence:values['Gift ID']?giftEvidence:contactEvidence
   if(!id||target.has(id))fail('GIVEBUTTER_EVIDENCE','Evidence needs one unambiguous source ID per row.',400)
   target.set(id,values)
  }
 }
 const preference=(value:unknown)=>value===null||value===undefined||value===''?'unknown':String(value).toLowerCase()==='1'?'yes':String(value).toLowerCase()==='0'?'no':String(value)
 const donors=contacts.map(c=>{
  const a=c.primary_address??{},extra=contactEvidence.get(String(c.id))??{}
  return {...extra,'Constituent ID':c.id,'First Name':c.first_name,'Middle Name':c.middle_name,'Last Name':c.last_name,'Prefix':c.prefix,'Suffix':c.suffix,'Nickname':c.preferred_name,'Email':c.primary_email,'Phone':c.primary_phone,'Address':a.address_1,'Address Line 2':a.address_2,'City':a.city,'State':a.state,'Postal Code':a.zipcode,'Country':a.country,...contactColumns(c),'Email Preference':extra['Email Preference']??preference(c.email_opt_in??c.is_email_subscribed),'Mail Preference':extra['Mail Preference']??preference(c.is_address_subscribed),'SMS Preference':extra['SMS Preference']??preference(c.sms_opt_in),'Phone Preference':extra['Phone Preference']??preference(c.is_phone_subscribed)}
 })
 const gifts=details.map(t=>{
  const extra=giftEvidence.get(String(t.id))??{},campaign=campaigns.find(c=>String(c.id)===String(t.campaign_id)),dedication=t.dedication
  const contact=donors.find(c=>String(c['Constituent ID'])===String(t.contact_id))
  if(!contact)fail('GIVEBUTTER_SCHEMA','A transaction contact is missing from the source contact list.',400)
  for(const answer of t.custom_fields??[])if(answer.title&&answer.value!==undefined){const column='Question: '+answer.title;if(Object.hasOwn(contact,column)&&(contact as RecordRow)[column]!==answer.value)fail('GIVEBUTTER_QUESTION','A donor has conflicting answers to one question. Map the history explicitly before import.',400);(contact as RecordRow)[column]=answer.value}
  return {...extra,'Gift ID':t.id,'Constituent ID':t.contact_id,'Gift Type':'Gift','Gift Date':date(t.transacted_at),'Amount':dollars(t.amount),'Fees':dollars(t.fee),'Campaign ID':t.campaign_id,'Campaign':campaign?.title??t.campaign_title??'','Fund':t.fund_code??'','Payment Method':t.method??t.payment_method,'Payment Status':t.status,'Currency':t.currency,'Refunded Amount':t.refunded??'0','Non-Deductible Amount':dollars(t.fair_market_value_amount),'Goods Description':(t.line_items??[]).map((item:RecordRow)=>item.description).filter(Boolean).join('; ')||extra['Goods Description']||'','Tribute Honoree':dedication?.name??extra['Tribute Honoree']??'','Tribute Type':dedication?.type??extra['Tribute Type']??'','Tribute Recipient Name':dedication?.recipient?.name??extra['Tribute Recipient Name']??'','Tribute Recipient Email':dedication?.recipient?.email??extra['Tribute Recipient Email']??'','Tribute Group':extra['Tribute Group']??(dedication?String(t.campaign_id):'')}
 })
 const recurring=plans.map(p=>({...planEvidence.get(String(p.id)),'Plan ID':p.id,'Constituent ID':p.contact_id,'Amount':dollars(p.amount),'Frequency':p.frequency,'Plan Status':p.status,'Payment Method':p.method,'Next Charge Date':date(p.next_bill_date)}))
 for(const [evidence,rows,column] of [[contactEvidence,donors,'Constituent ID'],[giftEvidence,gifts,'Gift ID'],[planEvidence,recurring,'Plan ID']] as const)for(const id of evidence.keys())if(!rows.some(r=>String((r as RecordRow)[column])===id))fail('GIVEBUTTER_EVIDENCE','An evidence ID was not returned by Givebutter. Nothing was imported.',400)
 return {source:'givebutter',files:[file('givebutter-contacts.csv',donors),...(gifts.length?[file('givebutter-gifts.csv',gifts)]:[]),...(recurring.length?[file('givebutter-plans.csv',recurring)]:[]),...extraFiles],customFields:input.customFields,solicitCodes:input.solicitCodes,noGoodsOrServices:input.noGoodsOrServices}
}
