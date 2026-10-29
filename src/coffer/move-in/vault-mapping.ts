import { digest, manager } from '../auth'
import { all, commit, event, fail, guard, newId, object, one, sql, text, type Context, type Row } from '../db'
import { parseCsv } from './parse-input'
import type { ExportFile, VaultMappingInput, VaultPlan, VaultRow } from './types'

const planKeys=['source_plan_id','source_donor_id','source_customer_id','source_payment_id','payment_type','amount_cents','currency','frequency','fund','campaign','next_charge_on','history_reference','authorization_reference','authorization_date','authorization_method']
const sources=['lgl','bloomerang','re-nxt','neon','givebutter','zeffy','spreadsheet']
const raw=/(?:\d[ -]?){12,}|\d{8,}|\b(?:sk|rk|pk)_(?:test|live)_/i
const own=(c:Context)=>{if(!manager(c.actor))fail('manager_required','Only the owner or an admin reviews payment mappings.',403)}
const ref=(value:unknown,label:string)=>{const v=text(value,label,160);if(raw.test(v)||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(v))fail('VAULT_REFERENCE','Use opaque references only, never payment account data.',400);return v}
function fields(value:unknown,keys:string[],label:string){
 const row=object(value,label)
 if(Object.keys(row).length!==keys.length||keys.some(k=>!Object.hasOwn(row,k)))fail('VAULT_SCHEMA',`${label} must use exactly the documented columns.`,400)
 return row
}
function strictJson(body:string):unknown{
 const result=JSON.parse(body),stack:{keys:Set<string>;object:boolean;key:boolean}[]=[]
 for(const token of body.match(/"(?:\\.|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g)??[]){
  if(token==='{'||token==='[')stack.push({keys:new Set(),object:token==='{',key:token==='{'})
  else if(token==='}'||token===']')stack.pop()
  else {
   const top=stack.at(-1)
   if(token===','&&top?.object)top.key=true
   else if(token.startsWith('"')&&top?.object&&top.key){
    const key=JSON.parse(token)
    if(top.keys.has(key))fail('VAULT_SCHEMA','Duplicate JSON keys are ambiguous. Review the original file.',400)
    top.keys.add(key);top.key=false
   }
  }
 }
 return result
}
function readFile(file:ExportFile,keys?:string[]):any{
 if(!file||typeof file.name!=='string'||!/^[-a-zA-Z0-9_.]+\.(csv|json)$/i.test(file.name)||typeof file.base64!=='string'||file.base64.length>1024*1024||file.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))fail('VAULT_FILE','Choose a documented UTF-8 CSV or JSON file, at most 750 KB.',400)
 let rows:unknown
 try {
  const body=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(file.base64),v=>v.charCodeAt(0)))
  if(/\.json$/i.test(file.name))rows=strictJson(body)
  else {
   const [header,...values]=parseCsv(body)
   if(!header||new Set(header).size!==header.length||keys&&(header.length!==keys.length||keys.some(k=>!header.includes(k))))fail('VAULT_SCHEMA','Use exactly the documented CSV columns.',400)
   rows=values.map(v=>{if(v.length!==header.length)fail('VAULT_SCHEMA','Every CSV row must contain every column.',400);return Object.fromEntries(header.map((k,i)=>[String(k),v[i]]))})
  }
 }catch(error){if(error instanceof Error&&error.name==='CofferError')throw error;fail('VAULT_FILE','The file is malformed. Use the documented CSV or JSON schema.',400)}
 if(!keys&&!Array.isArray(rows))return object(rows,'Stripe JSON mapping')
 if(!Array.isArray(rows)||!rows.length||rows.length>1000)fail('VAULT_FILE','Each file must contain 1–1000 rows.',400)
 return keys?rows.map(row=>fields(row,keys,'File row')):rows
}
// Stripe's post-import formats have different card and ACH column names.
// Validate allowed metadata, discard it, and retain opaque references only.
function mappingFile(file:ExportFile):Row[]{
 const loaded=readFile(file),output:Row[]=[]
 const add=(oldCustomer:unknown,customer:unknown,oldPayment:unknown,instrument:unknown,kind:string,metadata:Row)=>{
  for(const [key,value] of Object.entries(metadata)){
   if(key.endsWith('last4')||key==='last4'){if(!/^\d{4}$/.test(String(value)))fail('VAULT_SCHEMA','Mapping last-four metadata must contain exactly four digits.',400)}
   else if(/exp_month$/.test(key)){if(!Number.isInteger(Number(value))||Number(value)<1||Number(value)>12)fail('VAULT_SCHEMA','Invalid expiration month.',400)}
   else if(/exp_year$/.test(key)){if(!/^\d{4}$/.test(String(value)))fail('VAULT_SCHEMA','Invalid expiration year.',400)}
   else if(key==='brand'||key==='card_brand'){if(raw.test(text(value,'Card brand',60)))fail('VAULT_SCHEMA','Invalid card brand metadata.',400)}
   else ref(value,'Mapping metadata')
  }
  const month=Number(metadata.card_exp_month??metadata.exp_month),year=Number(metadata.card_exp_year??metadata.exp_year)
  output.push({old_customer_id:ref(oldCustomer,'Old customer'),new_customer_id:ref(customer,'Stripe customer'),old_source_id:ref(oldPayment,'Old payment reference'),new_source_id:ref(instrument,'Imported instrument'),payment_type:kind,expires_on:year&&month?String(year)+'-'+String(month).padStart(2,'0'):''})
 }
 if(Array.isArray(loaded))for(const value of loaded){
  const row=object(value,'Stripe mapping row'),card=Object.hasOwn(row,'old_id'),kind=card?'card':'ach'
  const required=card?['old_id','source_old_id','created_customer','source_new_id']:['old_customer_id','customer_id','old_bank_account_id','bank_account_id']
  const allowed=card?['card_fingerprint','card_last4','card_exp_month','card_exp_year','card_brand']:['bank_account_fingerprint','bank_account_last4']
  if(required.some(k=>!Object.hasOwn(row,k))||Object.keys(row).some(k=>![...required,...allowed].includes(k)))fail('VAULT_SCHEMA','Unknown Stripe mapping columns. Use the documented card or ACH schema.',400)
  const metadata=Object.fromEntries(Object.entries(row).filter(([k])=>allowed.includes(k)))
  if(card&&(Object.hasOwn(metadata,'card_exp_month')!==Object.hasOwn(metadata,'card_exp_year')))fail('VAULT_SCHEMA','Supply both expiration fields or neither.',400)
  add(row[required[0]],row[required[card?2:1]],row[required[card?1:2]],row[required[3]],kind,metadata)
 }else for(const [oldCustomer,value] of Object.entries(loaded)){
  const customer=object(value,'Stripe customer mapping')
  if(!Object.hasOwn(customer,'id')||Object.keys(customer).some(k=>!['id','cards','bank_accounts'].includes(k))||!customer.cards&&!customer.bank_accounts)fail('VAULT_SCHEMA','Unknown Stripe JSON customer mapping.',400)
  for(const [group,kind] of [['cards','card'],['bank_accounts','ach']])if(customer[group])for(const [oldPayment,value] of Object.entries(object(customer[group],'Stripe instruments'))){
   const instrument=object(value,'Stripe instrument'),allowed=kind==='card'?['id','fingerprint','last4','exp_month','exp_year','brand']:['id','fingerprint','last4']
   if(!Object.hasOwn(instrument,'id')||Object.keys(instrument).some(k=>!allowed.includes(k)))fail('VAULT_SCHEMA','Unknown Stripe JSON instrument fields.',400)
   if(kind==='card'&&(Object.hasOwn(instrument,'exp_month')!==Object.hasOwn(instrument,'exp_year')))fail('VAULT_SCHEMA','Supply both expiration fields or neither.',400)
   add(oldCustomer,customer.id,oldPayment,instrument.id,kind,Object.fromEntries(Object.entries(instrument).filter(([k])=>k!=='id')))
  }
 }
 if(!output.length||output.length>1000)fail('VAULT_FILE','Each mapping file must contain 1–1000 instruments.',400)
 return output
}
function day(value:unknown,label:string){
 if(value==='')return ''
 const v=text(value,label,10)
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('VAULT_DATE',`${label} must be an ISO date or empty.`,400)
 return v
}
function plan(value:Row):VaultPlan{
 const p:Row={}
 for(const k of planKeys){
  if(k==='amount_cents'){
   if(!/^[1-9]\d{0,9}$/.test(String(value[k]))||!Number.isSafeInteger(Number(value[k])))fail('VAULT_AMOUNT','Source amount must be positive integer cents.',400)
   p[k]=Number(value[k])
  }else if(k==='next_charge_on'||k==='authorization_date')p[k]=day(value[k],k)
  else if(['fund','campaign','authorization_method'].includes(k)){
   p[k]=value[k]===''?'':text(value[k],k,200)
   if(raw.test(p[k])||p[k].includes('@'))fail('VAULT_REFERENCE','Payment account data and contact addresses are not accepted.',400)
  }else p[k]=value[k]===''?'':ref(value[k],k)
 }
 if(['source_plan_id','source_donor_id','source_customer_id','source_payment_id','payment_type','currency','frequency'].some(k=>!p[k]))fail('VAULT_SCHEMA','Every source plan needs its identity, payment references, currency and schedule.',400)
 if((p.authorization_reference||p.authorization_date||p.authorization_method)&&!(p.authorization_reference&&p.authorization_date&&p.authorization_method))fail('VAULT_AUTHORIZATION','Attested authorization needs its reference, date and method together.',400)
 return p as VaultPlan
}
function rowChecks(rows:VaultRow[]){
 const identities=JSON.stringify(rows.map(r=>({id:r.donorId,version:r.donorVersion,hash:r.sourceIdentityHash})))
 return [
  guard("NOT EXISTS(SELECT 1 FROM json_each(?) r LEFT JOIN cf_donors d ON d.id=json_extract(r.value,'$.id') WHERE d.id IS NULL OR d.version<>json_extract(r.value,'$.version') OR d.erased_at IS NOT NULL OR EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))",'VAULT_IDENTITY_CHANGED','A reviewed donor changed. Upload and review the files again.',identities),
  guard("NOT EXISTS(SELECT 1 FROM json_each(?) r JOIN cf_vault_identities i ON i.identity_hash=json_extract(r.value,'$.hash') WHERE i.donor_id<>json_extract(r.value,'$.id'))",'VAULT_IDENTITY','Source identity belongs to another donor.',identities),
  guard("NOT EXISTS(SELECT 1 FROM json_each(?) r JOIN cf_vault_erased_sources e ON e.identity_hash=json_extract(r.value,'$.hash'))",'VAULT_ERASED','An erased source identity cannot be imported again.',identities),
 ]
}
export async function previewVault(c:Context,value:VaultMappingInput){
 own(c)
 const input=object(value)
 if(Object.keys(input).some(k=>!['source','sourceAccount','destinationAccount','plans','mappings','donors'].includes(k))||!sources.includes(input.source))fail('VAULT_SCHEMA','Choose a supported source and documented review fields.',400)
 const source=input.source,sourceAccount=ref(input.sourceAccount,'Source account'),destinationAccount=ref(input.destinationAccount,'Destination account')
 if(!/^acct_[A-Za-z0-9_-]+$/.test(destinationAccount)||sourceAccount===destinationAccount)fail('VAULT_ACCOUNT','Identify a distinct destination Stripe account. Same-account adoption uses the Stripe import door.',400)
 if(!Array.isArray(input.mappings)||input.mappings.length<1||input.mappings.length>6)fail('VAULT_FILE','Supply 1–6 mapping files.',400)
 const plans:VaultPlan[]=readFile(input.plans,planKeys).map(plan),mappings:Row[]=input.mappings.flatMap((f:ExportFile)=>mappingFile(f))
 if(plans.length>1000||mappings.length>3000)fail('VAULT_FILE','Split large reviews into smaller files.',400)
 const donors=object(input.donors,'Reviewed donor identities'),rows:VaultRow[]=[]
 if(Object.keys(donors).some(k=>!plans.some(p=>p.source_donor_id===k)))fail('VAULT_IDENTITY','Donor selections must correspond to the source plans.',400)
 const sourceIds=[...new Set(plans.map(p=>p.source_donor_id))],selections=new Map<string,{id:string;version:number;hash:string}>()
 for(const key of sourceIds){
  const selection=fields(donors[key],['id','version'],'Reviewed donor identity'),id=ref(selection.id,'Donor'),version=Number(selection.version)
  if(!Number.isSafeInteger(version)||version<1)fail('VAULT_IDENTITY','Choose an exact current donor version.',400)
  selections.set(key,{id,version,hash:await digest(JSON.stringify([source,sourceAccount,key]))})
 }
 const hashes=JSON.stringify([...selections.values()].map(s=>s.hash))
 const [native,known,retainedRows,custody,erased]=await Promise.all([
  all(c,"SELECT id,version FROM cf_donors d WHERE id IN (SELECT value FROM json_each(?)) AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id)",JSON.stringify([...selections.values()].map(s=>s.id))),
  all(c,"SELECT r.source_key,COALESCE(m.into_id,r.native_id) AS donor_id FROM cf_move_in_records r LEFT JOIN cf_donor_merges m ON m.donor_id=r.native_id WHERE r.source=? AND r.kind='donor' AND r.source_key IN (SELECT value FROM json_each(?))",source,JSON.stringify(sourceIds)),
  all(c,"SELECT * FROM cf_recurring_source_references WHERE source=? AND source_id IN (SELECT value FROM json_each(?))",source,JSON.stringify(plans.map(p=>p.source_plan_id))),
  all(c,'SELECT * FROM cf_vault_identities WHERE identity_hash IN (SELECT value FROM json_each(?))',hashes),
  all(c,'SELECT * FROM cf_vault_erased_sources WHERE identity_hash IN (SELECT value FROM json_each(?))',hashes),
 ])
 if(erased.length)fail('VAULT_ERASED','An erased source identity cannot be imported again.')
 const nativeById=new Map(native.map(d=>[d.id,d])),retainedById=new Map(retainedRows.map(r=>[r.source_id,r])),custodyByHash=new Map(custody.map(r=>[r.identity_hash,r.donor_id]))
 for(const p of plans){
  const selection=selections.get(p.source_donor_id)!,donorId=selection.id,version=selection.version,identityHash=selection.hash,d=nativeById.get(donorId),retained=retainedById.get(p.source_plan_id)
  if(!d||d.version!==version)fail('VAULT_IDENTITY_CHANGED','Choose an active current donor explicitly. Names or shared contacts cannot identify a donor.')
  if(known.some(k=>k.source_key===p.source_donor_id&&k.donor_id!==donorId)||retained&&retained.donor_id!==donorId||custodyByHash.has(identityHash)&&custodyByHash.get(identityHash)!==donorId)fail('VAULT_IDENTITY','Source identity conflicts with an existing donor mapping.')
  const hits=mappings.filter((m:Row)=>m.old_customer_id===p.source_customer_id&&m.old_source_id===p.source_payment_id),m=hits[0]??null
  let category:VaultRow['category']='matched',reason='File match only; provider usability unverified'
  if(plans.filter(q=>q.source_plan_id===p.source_plan_id).length>1||hits.length>1||m&&mappings.some((q:Row)=>q!==m&&((q.old_customer_id===m.old_customer_id&&q.new_customer_id!==m.new_customer_id)||(q.new_source_id===m.new_source_id&&(q.new_customer_id!==m.new_customer_id||q.old_source_id!==m.old_source_id||q.old_customer_id!==m.old_customer_id))))) {category='conflicting';reason='Duplicate or conflicting source or destination mapping'}
  else if(retained&&(retained.amount_cents!==p.amount_cents||retained.frequency!==p.frequency||retained.campaign!==p.campaign||retained.customer_reference&&retained.customer_reference!==p.source_customer_id||retained.payment_method_reference&&retained.payment_method_reference!==p.source_payment_id)){category='conflicting';reason='Source plan differs from retained import evidence'}
  else if(!['card','ach'].includes(p.payment_type)||p.currency!=='USD'||!['monthly','quarterly','annual','weekly'].includes(p.frequency)||m&&(m.payment_type!==p.payment_type||m.expires_on&&m.expires_on<c.now.slice(0,7)||!/^cus_[A-Za-z0-9_-]+$/.test(m.new_customer_id)||!(p.payment_type==='card'?/^pm_[A-Za-z0-9_-]+$/:/^(pm|ba)_[A-Za-z0-9_-]+$/).test(m.new_source_id))) {category='unsupported';reason='Unsupported currency, schedule, payment type or destination reference'}
  else if(!m){category='missing';reason='No mapping for the exact source customer and payment reference'}
  else if(p.payment_type==='ach'&&!p.authorization_reference){category='missing';reason='Debit authorization provenance not supplied'}
  rows.push({donorId,donorVersion:version,sourceIdentityHash:identityHash,plan:p,mapping:m as VaultRow['mapping'],category,reason})
 }
 // Extra file rows must be accounted for; never hide unrelated instruments.
 const unused=mappings.filter((m:Row)=>!plans.some(p=>p.source_customer_id===m.old_customer_id&&p.source_payment_id===m.old_source_id)).length
 if(unused)fail('VAULT_UNBOUND','Mapping files contain instruments with no reviewed source plan. Split the file or include their plans.',400)
 const fingerprint=await digest(JSON.stringify({source,sourceAccount,destinationAccount,rows})),prior=await one(c,'SELECT id,state FROM cf_vault_reviews WHERE fingerprint=?',fingerprint)
 if(prior){if(['erased','invalidated'].includes(prior.state))fail('VAULT_CHANGED','This review was invalidated. Review current source facts and identities.');return getVault(c,prior.id)}
 const id=newId()
 const stored=JSON.stringify(rows.map((r,position)=>({id:newId(),position,donorId:r.donorId,donorVersion:r.donorVersion,sourceIdentityHash:r.sourceIdentityHash,sourcePlanId:r.plan.source_plan_id,payload:JSON.stringify({plan:r.plan,mapping:r.mapping}),category:r.category,reason:r.reason})))
 await commit(c,[...rowChecks(rows),
  sql("INSERT INTO cf_vault_reviews(id,fingerprint,source,source_account,destination_account,state,created_at,created_by) VALUES(?,?,?,?,?,'reviewed',?,?)",id,fingerprint,source,sourceAccount,destinationAccount,c.now,c.actor.name),
  sql("INSERT OR IGNORE INTO cf_vault_identities SELECT json_extract(value,'$.sourceIdentityHash'),json_extract(value,'$.donorId') FROM json_each(?)",stored),
  sql("INSERT INTO cf_vault_rows SELECT json_extract(value,'$.id'),?,json_extract(value,'$.position'),json_extract(value,'$.donorId'),json_extract(value,'$.donorVersion'),json_extract(value,'$.sourceIdentityHash'),json_extract(value,'$.sourcePlanId'),json_extract(value,'$.payload'),json_extract(value,'$.category'),json_extract(value,'$.reason') FROM json_each(?)",id,stored),
  event(c,'vault.preview','vault-review',id,null),
 ])
 return getVault(c,id)
}
export async function getVault(c:Context,id:string):Promise<Row & {rows:(VaultRow&{donorName:string})[]}>{
 own(c)
 const review=await one(c,'SELECT * FROM cf_vault_reviews WHERE id=?',id)
 if(!review)fail('not_found','That mapping review does not exist.',404)
 const saved=await all(c,'SELECT r.*,d.name,d.version AS current_version,d.erased_at FROM cf_vault_rows r JOIN cf_donors d ON d.id=r.donor_id WHERE review_id=? ORDER BY position',id)
 const rows=saved.map(r=>({...JSON.parse(r.payload),donorId:r.donor_id,donorVersion:r.donor_version,donorName:r.name,category:r.category,reason:r.reason,sourceIdentityHash:r.source_identity_hash})) as (VaultRow&{donorName:string})[]
 const current=saved.every(r=>r.donor_version===r.current_version&&!r.erased_at)
 return {...review,current,providerUsability:'unverified',canSave:review.state==='reviewed'&&current,counts:Object.fromEntries(['matched','missing','conflicting','unsupported'].map(k=>[k,rows.filter(r=>r.category===k).length])),rows}
}
export async function vaultReviews(c:Context){own(c);return all(c,"SELECT id,state,source,destination_account,created_at FROM cf_vault_reviews ORDER BY created_at DESC,id DESC LIMIT 30")}
export async function saveVault(c:Context,input:Row){
 own(c)
 const review=await getVault(c,text(input.id,'Review')),rows=review.rows
 if(input.fingerprint!==review.fingerprint||Number(input.version)!==review.version||input.confirm!=='yes'||!review.current)fail('VAULT_CHANGED','Confirm the exact current review. Changed donor identities require a new upload.')
 if(review.state==='saved')return {...review,unchanged:true}
 if(review.state!=='reviewed')fail('VAULT_CHANGED','This review can no longer be saved.')
 await commit(c,[...rowChecks(rows),guard("EXISTS(SELECT 1 FROM cf_vault_reviews WHERE id=? AND state='reviewed' AND fingerprint=? AND version=?)",'VAULT_CHANGED','The review changed. Refresh it.',review.id,review.fingerprint,review.version),sql("UPDATE cf_vault_reviews SET state='saved',saved_at=?,version=version+1 WHERE id=?",c.now,review.id),event(c,'vault.save','vault-review',review.id,null,{matched:review.counts.matched})])
 return getVault(c,review.id)
}
export async function removeVault(c:Context,input:Row){
 own(c)
 const review=await getVault(c,text(input.id,'Review'))
 if(!['reviewed','saved'].includes(review.state)||!review.current||input.fingerprint!==review.fingerprint||Number(input.version)!==review.version||input.confirm!=='yes')fail('VAULT_CHANGED','Only an unchanged current review can be removed. Confirm its version.')
 await commit(c,[...rowChecks(review.rows),guard("EXISTS(SELECT 1 FROM cf_vault_reviews WHERE id=? AND version=? AND state IN ('reviewed','saved'))",'VAULT_CHANGED','The review changed. Refresh it.',review.id,review.version),sql('DELETE FROM cf_vault_rows WHERE review_id=?',review.id),sql("UPDATE cf_vault_reviews SET state='removed',version=version+1 WHERE id=?",review.id),event(c,'vault.remove','vault-review',review.id,null)])
 return getVault(c,review.id)
}
