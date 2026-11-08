import { CofferError, date, email, fail, sha256, text, type Row } from '../../db'
import { amount } from '../../money'
import { parseCsv } from '../../move-in/parse-input'

// Explicit column mapping accommodates the organization's actual export.
// Unknown formats, refunds and changed disbursements stay held for a person.
export const columns = [
 ['organization','Source organization ID'],['disbursement','Disbursement ID'],['transaction','Transaction ID'],
 ['donor','Source donor ID'],['name','Donor name'],['email','Donor email'],['date','Contribution date'],
 ['currency','Currency'],['gross','Gross contribution'],['fee','Actual fees'],['net','Net payout'],
 ['fund','Fund'],['campaign','Campaign ID or none'],['acknowledged','Source acknowledgment status'],
 ['ackDate','Source acknowledgment date'],['ackMethod','Source acknowledgment method'],
] as const
export type Upload = Awaited<ReturnType<typeof parseBenevity>>
export function csvInput(input: Row) {
 const csv=text(input.csv,'UTF-8 CSV',150000)
 let rows
 try { rows=parseCsv(csv) } catch(error) { fail('CSV',error instanceof Error?error.message:'Cannot read CSV.',400) }
 const headers=(rows[0]??[]).map(v=>String(v??'').trim())
 if(!headers.length||headers.some(v=>!v)||new Set(headers).size!==headers.length)fail('CSV','Use unique, nonempty column headings.',400)
 if(rows.length<2||rows.length>101)fail('CSV','Upload 1–100 contributions from one disbursement.',400)
 return {csv,headers,rows:rows.slice(1)}
}
export async function parseBenevity(input: Row) {
 const source=csvInput(input), mapping:Record<string,string>={}
 let supplied=input.mapping
 if(typeof supplied==='string'){try{supplied=JSON.parse(supplied)}catch{fail('MAPPING','Choose the source columns.',400)}}
 for(const [key] of columns){
  const selected=supplied?.[key]??input['map_'+key]??''
  if(selected&&(!source.headers.includes(selected)||typeof selected!=='string'))fail('MAPPING','A mapped column is absent from this upload.',400)
  mapping[key]=selected
 }
 const used=Object.values(mapping).filter(Boolean)
 if(new Set(used).size!==used.length)fail('MAPPING','Each source column can have only one meaning.',400)
 const issues:string[]=[],records:Row[]=[]
 const money=(v:string,label:string,zero=false)=>amount({value:v},'value',label,{allowZero:zero})
 for(const [index,cells] of source.rows.entries()){
  const raw:Record<string,string>=Object.fromEntries(columns.map(([key])=>[key,mapping[key]?String(cells[source.headers.indexOf(mapping[key])]??'').trim():'']))
  const rowIssues:string[]=[],facts:Row={}
  const read=(key:string,fn:()=>any)=>{try{facts[key]=fn()}catch(error){if(!(error instanceof CofferError))throw error;rowIssues.push(error.message);facts[key]=null}}
  if(cells.length!==source.headers.length)rowIssues.push('The row has a different number of columns.')
  for(const key of ['organization','disbursement','transaction','donor','name'])read(key,()=>text(raw[key],key,150))
  read('email',()=>{const value=email(raw.email);if(!value)fail('DONOR','Donor email is missing.',400);return value})
  read('date',()=>date(raw.date,'Contribution date'))
  if(raw.currency.toUpperCase()!=='USD')rowIssues.push('The source must explicitly report USD.')
  facts.currency='usd'
  read('amount',()=>money(raw.gross,'Gross contribution'))
  read('fee',()=>money(raw.fee,'Actual fees',true))
  read('net',()=>money(raw.net,'Net payout',true))
  if(facts.amount!==null&&facts.fee!==null&&facts.net!==null&&facts.amount-facts.fee!==facts.net)rowIssues.push('Gross less actual fees must equal net payout.')
  read('fund',()=>text(raw.fund,'Source fund',100))
  read('campaign',()=>{if(!raw.campaign)fail('PROVENANCE','Supply a campaign ID or explicit none.',400);return raw.campaign==='none'?null:text(raw.campaign,'Campaign ID',100)})
  facts.acknowledged=raw.acknowledged||'unknown';facts.ackDate=raw.ackDate||null;facts.ackMethod=raw.ackMethod||null
  if(!['unknown','acknowledged','not acknowledged','do not acknowledge'].includes(facts.acknowledged))rowIssues.push('Map the explicit source acknowledgment status, or leave it unknown.')
  if(facts.ackDate)read('ackDate',()=>date(raw.ackDate,'Source acknowledgment date'))
  if(facts.ackMethod&&!['email','letter','phone','in person','other'].includes(facts.ackMethod))rowIssues.push('Unsupported source acknowledgment method.')
  if(facts.acknowledged!=='acknowledged'&&(facts.ackDate||facts.ackMethod))rowIssues.push('Acknowledgment date or method conflicts with its status.')
  facts.refunded=0
  records.push({facts,issues:rowIssues,rowNumber:index+2,evidence:JSON.stringify(Object.fromEntries(source.headers.map((h,i)=>[h,cells[i]??''])))})
  issues.push(...rowIssues.map(issue=>`Row ${index+2}: ${issue}`))
 }
 const first=records[0].facts
 if(records.some(r=>r.facts.organization!==first.organization||r.facts.disbursement!==first.disbursement))issues.push('One upload must contain one source organization and disbursement.')
 const transactions=records.map(r=>r.facts.transaction)
 if(new Set(transactions).size!==transactions.length)issues.push('Repeated transaction IDs require source correction.')
 let controls:Row={}
 const suppliedControls=input.controls??input
 try{
  controls={arrivalOn:date(suppliedControls.arrivalOn,'Deposit date'),gross:money(suppliedControls.gross,'Source gross total'),fee:money(suppliedControls.fee,'Source fee total',true),net:money(suppliedControls.net,'Source deposit total',true)}
  if(records.some(r=>r.facts.date>controls.arrivalOn))issues.push('A contribution date is after the deposit date.')
  for(const key of ['gross','fee','net']){
   const factKey=key==='gross'?'amount':key
   if(records.reduce((sum,r)=>sum+(r.facts[factKey]??0),0)!==controls[key])issues.push(`Source ${key} control does not reconcile with the rows.`)
  }
 }catch(error){if(!(error instanceof CofferError))throw error;issues.push(error.message)}
 const fileHash=await sha256(source.csv),fingerprint=await sha256(JSON.stringify({fileHash,mapping,controls,records:records.map(r=>r.facts)}))
 const batchKey=await sha256(JSON.stringify(['benevity',first.organization,first.disbursement]))
 for(const row of records){
  row.id='benevity-'+await sha256(JSON.stringify(['benevity',row.facts.organization,row.facts.transaction]))
  row.factsHash=await sha256(JSON.stringify(row.facts))
 }
 return {...source,mapping,records,issues,controls,fileHash,fingerprint,batchKey}
}
