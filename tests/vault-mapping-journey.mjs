import assert from 'node:assert/strict'
import {run,donor,archive,restore,reviewed} from './harness.mjs'
import {vaultMappingBrowser} from './vault-mapping-browser.mjs'
const key=n=>'synthetic-coffer-'+n
const mail=n=>[key(n),'example.test'].join('@')
const root='/api/coffer/move-in/vault'
const post=(h,verb,input,options)=>h.api(root+'/'+verb,input,options)
const get=(h,id,options)=>h.get(root+'/review?id='+id,options)
const now={headers:{'x-test-now':'2026-10-01T12:00:00Z'}}
export const file=(name,rows,format='json')=>({name:name+'.'+format,base64:Buffer.from(format==='json'?JSON.stringify(rows):[Object.keys(rows[0]),...rows.map(r=>Object.values(r))].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n').toString('base64')})
function fixture(d){
 const plans=Array.from({length:7},(_,i)=>({source_plan_id:key(7100+i),source_donor_id:key(7110),source_customer_id:key(7120),source_payment_id:key(7130+i),payment_type:i===1||i===2||i===6?'ach':'card',amount_cents:1200+i*100,currency:'USD',frequency:'monthly',fund:'Library',campaign:'Reading',next_charge_on:'2026-11-04',history_reference:key(7180+i),authorization_reference:i===1||i===2?key(7191):'',authorization_date:i===1||i===2?'2026-09-01':'',authorization_method:i===1||i===2?'signed paper':''}))
 const card=i=>({old_id:key(7120),source_old_id:key(7130+i),created_customer:'cus_'+key(7140),source_new_id:'pm_'+key(7150+i),card_fingerprint:key(7160+i),card_last4:'1234',card_exp_month:'12',card_exp_year:'2030',card_brand:'Visa'})
 const ach=i=>({old_customer_id:key(7120),customer_id:'cus_'+key(7140),old_bank_account_id:key(7130+i),bank_account_id:(i===1?'pm_':'ba_')+key(7150+i),bank_account_fingerprint:key(7160+i),bank_account_last4:'1234'})
 const mappingRows=[card(0),ach(1),ach(2),card(4),card(4),{...card(5),source_new_id:'card_'+key(7155)},ach(6)]
 const input={source:'bloomerang',sourceAccount:key(7170),destinationAccount:'acct_'+key(7171),plans:file('source-plans',plans),mappings:[file('stripe-card',[mappingRows[0],...mappingRows.slice(3,6)],'csv'),file('stripe-ach',mappingRows.filter((_,i)=>[1,2,6].includes(i)))],donors:{[key(7110)]:{id:d.id,version:d.version}}}
 return {plans,input,card,ach}
}
const confirm=r=>({id:r.id,fingerprint:r.fingerprint,version:r.version,confirm:'yes'})
async function noBilling(h,d){const history=await h.get('/api/coffer/donors/'+d.id);return {gifts:history.gifts,subscriptions:history.subscriptions,totals:history.totals}}
export async function vaultMappingJourney(){
 let providerWrites=0
 const edge=async request=>{providerWrites++;throw Error('Unexpected provider request: '+request.method)}
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'Synthetic Mapping Donor',{email:''}),other=await donor(h,'Synthetic Other Donor',{email:''}),{input,plans,card,ach}=fixture(d),original=JSON.stringify(plans),billing=await noBilling(h,d)
  const member=await h.person(mail(7201)),admin=await h.person(mail(7202),'admin')
  for(const options of [{as:'',status:401},{as:member.cookie,status:403}])await post(h,'preview',input,options)
  const r=await post(h,'preview',input,now)
  assert.deepEqual(r.counts,{matched:3,missing:2,conflicting:1,unsupported:1})
  assert.equal(r.providerUsability,'unverified');assert.equal(r.rows.length,7)
  assert.deepEqual(r.rows.map(v=>[v.plan.source_plan_id,v.category]),plans.map((p,i)=>[p.source_plan_id,['matched','matched','matched','missing','conflicting','unsupported','missing'][i]]))
  assert.deepEqual(r.rows.slice(0,3).map(v=>v.mapping.new_source_id),[0,1,2].map(i=>(i===2?'ba_':'pm_')+key(7150+i)))
  assert.deepEqual(r.rows[1].plan,plans[1]);assert.match(r.rows[3].reason,/exact source customer/);assert.match(r.rows[6].reason,/authorization provenance/)
  assert.equal(JSON.stringify(r).includes('last4'),false,'Metadata is validated and discarded')
  assert.equal((await post(h,'preview',input,now)).id,r.id,'Replay reuses the exact fingerprint')
  const bad=[]
  bad.push({...input,donors:{}})
  bad.push({...input,plans:file('broken',[{...plans[0],account_number:'123456789'}])})
  bad.push({...input,plans:file('broken',[{...plans[0],source_payment_id:'1234567890123456'}])})
  bad.push({...input,mappings:[file('raw',[{...card(0),card_number:'1234567890123456'}])]})
  bad.push({...input,mappings:[file('unknown',[{old_customer_id:key(7120),new_customer_id:key(7140)}])]})
  bad.push({...input,mappings:[{name:'duplicate.json',base64:Buffer.from('{"duplicate":{},"duplicate":{}}').toString('base64')}]})
  bad.push({...input,plans:{name:'source.json',base64:Buffer.from('{broken').toString('base64')}})
  bad.push({...input,plans:file('source',plans.map((p,i)=>i===0?{...p,next_charge_on:'2026-02-30'}:p))})
  bad.push({...input,mappings:[file('unbound',[{...card(0),source_old_id:key(7999)}])]})
  for(const rejected of bad)await post(h,'preview',rejected,{status:400})
  await post(h,'save',{...confirm(r),fingerprint:'changed'},{status:409})
  await get(h,r.id,{as:member.cookie,status:403})
  await post(h,'save',confirm(r),{as:member.cookie,status:403})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'save',confirm(r),{as:admin.cookie,status:401})
  // Both documented formats, all three instrument shapes, through the HTTP door.
  for(const format of ['csv','json']){
   const nested={ [key(7120)]:{id:'cus_'+key(7140),cards:{[key(7130)]:{id:'pm_'+key(7150),last4:'1234',exp_month:12,exp_year:2030,brand:'Visa',fingerprint:key(7160)}},bank_accounts:{[key(7131)]:{id:'pm_'+key(7151),last4:'1234',fingerprint:key(7161)},[key(7132)]:{id:'ba_'+key(7152),last4:'1234',fingerprint:key(7162)}}}}
   const version={...input,sourceAccount:key(format==='csv'?7210:7211),plans:file('source',plans.slice(0,3),format),mappings:format==='csv'?[file('cards',[card(0)],'csv'),file('ach',[ach(1),ach(2)],'csv')]:[file('stripe',nested)]}
   const checked=await post(h,'preview',version,now);assert.deepEqual(checked.counts,{matched:3,missing:0,conflicting:0,unsupported:0});assert.notEqual(checked.id,r.id)
   const saved=await post(h,'save',confirm(checked));assert.equal(saved.state,'saved');assert.equal((await post(h,'save',confirm(saved))).unchanged,true)
   assert.deepEqual(saved.rows.map(r=>r.plan),plans.slice(0,3),'Money, schedule, designations, history and authorization facts survive')
  }
  const expired=await post(h,'preview',{...input,sourceAccount:key(7212),plans:file('source',[plans[0]]),mappings:[file('expired',[{...card(0),card_exp_year:'2020'}])]},now)
  assert.deepEqual(expired.counts,{matched:0,missing:0,conflicting:0,unsupported:1})
  const collision=await post(h,'preview',{...input,sourceAccount:key(7213),plans:file('source',[plans[0],{...plans[1],payment_type:'card'}]),mappings:[file('collision',[card(0),{...card(0),source_old_id:key(7131)}])]},now)
  assert.deepEqual(collision.counts,{matched:0,missing:0,conflicting:2,unsupported:0})
  const different=await post(h,'preview',{...input,destinationAccount:'acct_'+key(7220)},now);assert.notEqual(different.fingerprint,r.fingerprint);assert.equal((await get(h,r.id)).destination_account,input.destinationAccount)
  await post(h,'save',{...confirm(different),fingerprint:r.fingerprint},{status:409})
  const conflicting=await post(h,'preview',{...input,donors:{[key(7110)]:{id:other.id,version:other.version}}},{status:409});assert.equal(conflicting.error,'VAULT_IDENTITY')
  await vaultMappingBrowser(h,input,r,process.env.COFFER_VAULT_BROWSER||'.cache/vault-mapping')
  assert.deepEqual(await noBilling(h,d),billing,'Preview and saving evidence change no gift, total or billing plan')
  const saved=await get(h,r.id),snapshot=await archive(h)
  await run(async fresh=>{
   await restore(fresh,snapshot);assert.deepEqual((await get(fresh,r.id)).rows,saved.rows)
   await post(fresh,'remove',{...confirm(saved),version:1},{status:409})
   const removed=await post(fresh,'remove',confirm(saved));assert.equal(removed.state,'removed');assert.equal(removed.rows.length,0)
   assert.deepEqual(await noBilling(fresh,d),billing)
   for(const row of await fresh.get(root))if(['reviewed','saved'].includes(row.state))await post(fresh,'remove',confirm(await get(fresh,row.id)))
   await fresh.command('donor.erase',{donorId:d.id,confirm:'ERASE'})
   const replacement=await donor(fresh,'Synthetic Removed Replacement',{email:''})
   const refused=await post(fresh,'preview',{...input,donors:{[key(7110)]:{id:replacement.id,version:replacement.version}}},{status:409})
   assert.equal(refused.error,'VAULT_ERASED','Removing the file before erasure cannot remove source-identity custody')
  },{outbound:edge,entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:'2026-10-01T12:00:00Z'}})
  const current=(await h.get('/api/coffer/donors/'+d.id)).donor
  await h.command('donor.update',{...current,donorId:d.id,version:current.version,name:'Synthetic Changed Donor'})
  await post(h,'save',confirm(saved),{status:409});await post(h,'remove',confirm(saved),{status:409})
  assert.equal((await get(h,r.id)).current,false)
  const target=await donor(h,'Synthetic Survivor',{email:''}),comparison=await h.get('/api/coffer/duplicates/compare?source='+d.id+'&target='+target.id)
  await h.command('donor.merge',{sourceDonorId:d.id,donorId:target.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  const merged=await get(h,r.id);assert.equal(merged.state,'invalidated');assert.ok(merged.rows.every(row=>row.donorId===target.id))
  await post(h,'remove',confirm(merged),{status:409})
  await h.command('donor.erase',{donorId:target.id,confirm:'ERASE'})
  const erased=await get(h,r.id);assert.equal(erased.state,'erased');assert.deepEqual(erased.rows,[])
  const archiveAfter=JSON.stringify(await archive(h));assert.ok(!archiveAfter.includes(key(7130))&&!archiveAfter.includes(key(7191)),'Erasure removes source references from live rows and merge custody')
  const replacement=await donor(h,'Synthetic Replacement',{email:''})
  await post(h,'preview',{...input,donors:{[key(7110)]:{id:replacement.id,version:replacement.version}}},{status:409})
  assert.equal(JSON.stringify(plans),original,'Original source plans are never changed')
  assert.equal(providerWrites,0,'No provider call, subscription creation or charge is submitted')
  assert.deepEqual((await noBilling(h,other)).gifts,[])
 },{outbound:edge,entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:'2026-10-01T12:00:00Z'}})
}
