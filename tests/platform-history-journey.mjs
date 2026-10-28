import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,reviewed,archive,restore,donor} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
const key=n=>'synthetic-coffer-'+n
const email=n=>key(n)+String.fromCharCode(64)+'example.test'
const post=(h,action,input,options)=>h.api('/api/coffer/move-in/'+action,input,options)
const history=(h,id,options)=>h.get('/api/coffer/move-in/source-history?donorId='+id,options)
const file=(name,rows)=>{const headers=[...new Set(rows.flatMap(r=>Object.keys(r)))],cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';return {name:name+'.csv',base64:Buffer.from([headers,...rows.map(r=>headers.map(k=>r[k]??''))].map(r=>r.map(cell).join(',')).join('\r\n')).toString('base64')}}
async function apply(h,p,options={}){let r=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,...options});while(r.state==='applying')r=await post(h,'continue',{id:p.id});return r}
function fixture(source){
 const contacts=[1,2,3,4,5].map(n=>({id:key(7000+n),first_name:['Avery','Blake','Cleo','Dana','Emory'][n-1],last_name:n===1?'Rain':n===4?'Lake':'Reed',primary_email:email(7000+n),primary_phone:'+1202555700'+n,primary_address:{address_1:'1 Main Street',city:'Springfield',state:'IL',zipcode:'62701',country:'US'},email_opt_in:n===2?null:true,is_address_subscribed:n===2?false:true,is_phone_subscribed:n===2?false:true,sms_opt_in:n===2?null:false}))
 const people=contacts.map((c,i)=>({'Constituent ID':c.id,'First Name':c.first_name,'Last Name':c.last_name,'Email':c.primary_email,'Phone':c.primary_phone,'Address':'1 Main Street','City':'Springfield','State':'IL','Postal Code':'62701','Email Preference':i===1?'unknown':'yes','Mail Preference':i===1?'no':'yes','SMS Preference':'unknown','Phone Preference':i===1?'no':'yes','Preference Date':'2026-09-01',...(i===1||i===2?{'Household ID':key(7020),'Household Name':'Reed family','Head of Household':i===2?'yes':'no','Household Addressee':'The Reading Reeds','Household Formal Salutation':'The Reed Readers','Household Informal Salutation':'Blake and Cleo'}:i===3?{'Household ID':key(7021),'Household Name':'Lake family'}:{}),...(i===0?{'Question: Seating':'Garden'}:{})}))
 const gifts=[1,2,3,4].map((n,i)=>({'Gift ID':key(7010+n),'Constituent ID':key(7000+Math.min(n,3)),'Gift Date':'2026-09-0'+(4+i),'Amount':[300,450,275,325][i],'Campaign':n%2?'Library':'Lessons','Campaign ID':key(n%2?7041:7042),'Currency':'USD','Fees':source==='givebutter'?[9,13.5,8.25,9.75][i]:0,'Payment Method':'card','Non-Deductible Amount':n===2?25:n===4?'':0,'Goods Description':n===2?'Gala ticket':'','Acknowledgment Status':n===1?'':n===3?'do not acknowledge':'not acknowledged','Acknowledgment Date':n===1?'2026-09-05':'','Acknowledgment Method':'','Acknowledgment Interaction ID':n===1?key(7031):'','Acknowledgment Reference':n===1?key(7061):'',...(n<=2?{'Tribute Honoree':'Jordan Rain','Tribute Type':'memory','Tribute Group':key(7040),'Tribute Recipient Name':'River Rain','Tribute Recipient Address':'19 Reading Street'}:{}),...(n===1?{'Soft Credit ID':key(7051),'Soft Credit Constituent ID':key(7002),'Soft Credit Amount':100,'Soft Credit Acknowledgment Status':'acknowledged','Soft Credit Acknowledgment Date':'2026-09-06','Soft Credit Acknowledgment Method':'phone call','Soft Credit Acknowledgment Interaction ID':key(7032)}:{})}))
 const notes=[{'Note ID':key(7031),'Constituent ID':key(7001),'Note':'Source gift thank-you','Note Date':'2026-09-05','Note Type':'email'},{'Note ID':key(7032),'Constituent ID':key(7002),'Note':'Independent credit thank-you','Note Date':'2026-09-06','Note Type':'call'}]
 const plans=[{id:key(7071),contact_id:key(7001),frequency:'monthly',status:'active',method:'card',amount:1200,next_bill_date:'2026-11-15'}]
 const planEvidence=[{'Plan ID':key(7071),'Processor Customer Reference':key(7072),'Processor Payment Method Reference':key(7073),'Campaign':'Library'}]
 const customFields=[{source,column:'Question: Seating',key:'source_seating',label:'Seating',kind:'constituent',type:'text',entry:'free-form',choices:[]}]
 const input=source==='givebutter'?{source,givebutterKey:key(7099),givebutterAmountUnit:'cents',files:[file('contact-evidence',people.map(p=>Object.fromEntries(Object.entries(p).filter(([k])=>!['First Name','Last Name','Email','Address','City','State','Postal Code','Question: Seating'].includes(k))))),file('gift-evidence',gifts.map(p=>Object.fromEntries(Object.entries(p).filter(([k])=>!['Constituent ID','Gift Date','Amount','Campaign','Campaign ID','Fees','Payment Method','Non-Deductible Amount','Tribute Honoree','Tribute Type'].includes(k))))),file('plan-evidence',planEvidence),file('interactions',notes)],customFields}:{source,files:[file('contacts',people.map(p=>Object.fromEntries(Object.entries(p).filter(([k])=>k!=='Question: Seating')))),file('payments',gifts.map((p,i)=>Object.fromEntries(Object.entries({...p,...(i===0?{'Question: Seating':'Garden'}:{})}).map(([k,v])=>[({'Gift ID':'Payment ID','Constituent ID':'Contact ID','Gift Date':'Payment date','Amount':'Donation amount','Campaign':'Form name','Non-Deductible Amount':'Advantage amount','Acknowledgment Date':'Tax receipt date','Acknowledgment Reference':'Receipt number'})[k]??k,v])))),file('interactions',notes)],customFields}
 const transactions=gifts.map((g,i)=>({id:g['Gift ID'],contact_id:g['Constituent ID'],transacted_at:g['Gift Date']+'T12:00:00Z',amount:g.Amount*100,fee:g.Fees*100,campaign_id:g['Campaign ID'],method:'card',currency:'USD',status:'succeeded',refunded:'false',line_items:i===1?[{type:'ticket',quantity:1,description:'Gala ticket',price:45000,total:45000}]:[],fair_market_value_amount:g['Non-Deductible Amount']===''?null:g['Non-Deductible Amount']*100,...(i<2?{dedication:{type:'memory',name:'Jordan Rain',recipient:{name:'River Rain',email:null}}}:{}),custom_fields:i===0?[{field_id:1,title:'Seating',type:'text',value:'Garden'}]:[]}))
 const requests=[]
 let mode='ok'
 const outbound=async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.givebutter.com');assert.equal(request.method,'GET','Import never alters source plans or sends donor mail');assert.equal(request.headers.get('Authorization'),'Bearer '+key(7099));requests.push(url.pathname)
  if(mode==='denied')return Response.json({message:'denied'},{status:403})
  if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://invalid.test/private'}})
  const resource=url.pathname.split('/')[2]
  if(resource==='transactions'&&url.pathname.split('/')[3])return Response.json({data:transactions.find(t=>t.id===url.pathname.split('/')[3])})
  const values={contacts,transactions,plans,campaigns:[{id:key(7041),title:'Library'},{id:key(7042),title:'Lessons'}]}[resource];assert.ok(values,'Only documented read endpoints are called')
  const page=Number(url.searchParams.get('page')),split=resource==='contacts'?2:values.length,last=resource==='contacts'?Math.ceil(values.length/split):1
  return Response.json({data:values.slice((page-1)*split,page*split),meta:{current_page:page,last_page:last,total:values.length+(mode==='incomplete'?1:0)},links:{next:mode==='foreign'?'https://invalid.test/private':null}})
 }
 return {input,requests,plans,transactions,outbound,setMode:value=>mode=value}
}

async function browser(h,p,source,input){
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage(),directory=process.env.COFFER_PLATFORM_SHOTS
  if(directory)await mkdir(directory,{recursive:true})
  // Assertions use one desktop width; the phone rendering is recorded once.
  await page.goto(origin+'/app/move-in/crm/review?id='+p.id)
  await page.getByText('Gifts · 4',{exact:true}).click()
  assert.match(await page.locator('body').innerText(),/Library|Lessons/)
  assert.match(await page.locator('body').innerText(),/source fee/)
  if(source==='givebutter'){await page.getByText('Recurring source evidence · 1',{exact:true}).click();assert.match(await page.locator('body').innerText(),/monthly/);assert.match(await page.locator('body').innerText(),/no replacement schedule is active/)}
  if(directory)for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:directory+'/'+source+'-review-'+width+'.png',fullPage:true})}
  await page.setViewportSize({width:1440,height:1000})
  await page.locator('input[name="acknowledged"][value="no"]').check()
  await page.locator('input[name="confirm"]').check()
  await page.getByRole('button',{name:'Move these records in',exact:true}).click()
  while(await page.getByRole('button',{name:'Continue',exact:true}).count())await page.getByRole('button',{name:'Continue',exact:true}).click()
  assert.match(await page.locator('body').innerText(),/Everything in this move-in is in Coffer/)
  if(directory)for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:directory+'/'+source+'-journal-'+width+'.png',fullPage:true})}
  await page.close()
 })
}
export async function platformHistoryJourney(){
 for(const source of ['givebutter','zeffy']){
  const f=fixture(source),initialPlans=JSON.stringify(f.plans)
  await run(async h=>{
   await reviewed(h)
   if(source==='givebutter'){for(const mode of ['denied','redirect','incomplete']){f.setMode(mode);await post(h,'preview',f.input,{status:502});assert.equal((await h.get('/api/coffer/donors')).total,0)}f.setMode('ok')}
   if(source==='zeffy'){const otherCurrency=structuredClone(f.input),payments=otherCurrency.files.find(f=>f.name==='payments.csv');payments.base64=Buffer.from(Buffer.from(payments.base64,'base64').toString().replace('\"USD\"','\"CAD\"')).toString('base64');const refused=await post(h,'preview',otherCurrency);assert.equal(refused.canApply,false);assert.ok(refused.diagnostics.some(d=>d.code==='PLATFORM_CURRENCY'));await post(h,'apply',{id:refused.id,fingerprint:refused.fingerprint},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,0)}
   const wrongLink=structuredClone(f.input),giftFile=wrongLink.files.find(f=>source==='givebutter'?f.name==='gift-evidence.csv':f.name==='payments.csv')
   giftFile.base64=Buffer.from(Buffer.from(giftFile.base64,'base64').toString().replace(key(7032),key(7031))).toString('base64')
   const wrong=await post(h,'preview',wrongLink);assert.equal(wrong.canApply,false);assert.ok(wrong.diagnostics.some(d=>d.code==='ACKNOWLEDGMENT_LINK'));await post(h,'apply',{id:wrong.id,fingerprint:wrong.fingerprint},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,0)
   const p=await post(h,'preview',f.input)
   assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));assert.equal(p.needsAcceptance,false,JSON.stringify(p.unmapped));assert.equal(p.sourceTotals.amountCents,135000)
   assert.equal(p.counts.householdsWithHead,1);assert.equal(p.counts.householdsWithoutHead,2)
   assert.equal(JSON.stringify(p).includes(key(7099)),false,'Read key is never returned or staged')
   const member=await h.person(email(7090)),admin=await h.person(email(7091),'admin')
   await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
   await post(h,'preview',f.input,{as:admin.cookie,status:401});await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{as:admin.cookie,status:401})
   await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{as:member.cookie,status:403})
   await post(h,'apply',{id:p.id,fingerprint:'stale-review'},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,0)
   await browser(h,p,source,f.input)
   const people=await Promise.all((await h.get('/api/coffer/donors')).donors.map(async d=>(await h.get('/api/coffer/donors/'+d.id)).donor)),find=n=>people.find(d=>d.source_ref===source+':'+key(n))
   const a=find(7001),b=find(7002),c=find(7003),d=find(7004),e=find(7005),read=id=>h.get('/api/coffer/donors/'+id)
   const av=await read(a.id),bv=await read(b.id),cv=await read(c.id),gifts=[...av.gifts,...bv.gifts,...cv.gifts],gift=n=>gifts.find(g=>g.reference===source+':'+key(n))
   assert.equal(av.donor.phone,'+12025557001');assert.deepEqual([av.donor.first_name,av.donor.last_name],['Avery','Rain']);assert.equal(JSON.parse(av.customValues.find(v=>v.field_key==='source_seating').value),'Garden')
   assert.equal(gifts.reduce((s,g)=>s+g.amount_cents,0),135000)
   const totals=Object.fromEntries(['Library','Lessons'].map(name=>[name,gifts.filter(g=>g.source_campaign===name).reduce((s,g)=>s+g.amount_cents,0)]));assert.deepEqual(totals,{Library:57500,Lessons:77500})
   assert.equal(gifts.reduce((s,g)=>s+g.source_fee_cents,0),source==='givebutter'?4050:0)
   assert.equal(gift(7012).goods_cents,2500);assert.equal(gift(7012).goods_description,'Gala ticket');assert.equal(gift(7014).goods,'unknown');assert.equal(gift(7014).acknowledgment.acknowledged_on,null);assert.equal(gift(7014).acknowledgment.method,null)
   assert.deepEqual([gift(7011).acknowledgment.status,gift(7011).acknowledgment.acknowledged_on,gift(7011).acknowledgment.method],['acknowledged','2026-09-05','email'])
   assert.equal(gift(7011).acknowledgment.link.id,av.depth.interactions.find(i=>i.notes==='Source gift thank-you').id)
   const soft=bv.giftDepth.creditedGifts.find(s=>s.amount_cents===10000);assert.ok(soft);assert.deepEqual([soft.acknowledgment.status,soft.acknowledgment.acknowledgedOn,soft.acknowledgment.method],['acknowledged','2026-09-06','phone call']);assert.equal(soft.acknowledgment.link.id,bv.depth.interactions.find(i=>i.notes==='Independent credit thank-you').id)
   assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.reference).sort(),[7012,7014].map(n=>source+':'+key(n)))
   const hh=await h.get('/api/coffer/households/'+b.household_id);assert.equal(hh.household.head_donor_id,c.id);assert.equal(hh.household.head_source,source);assert.ok(hh.household.head_imported_at);assert.equal(hh.household.addressee_override,'The Reading Reeds');assert.equal(hh.household.informal_override,'Blake and Cleo');assert.equal((await h.get('/api/coffer/households/'+d.household_id)).household.head_donor_id,null);assert.equal(a.household_id,e.household_id);const inferred=(await h.get('/api/coffer/households/'+a.household_id)).household;assert.equal(inferred.head_donor_id,null);assert.equal(inferred.head_source,null,'Shared address never establishes source headship')
   assert.deepEqual(Object.fromEntries(bv.consents.map(p=>[p.channel,p.status])),{email:'unknown',mail:'withdrawn',sms:'unknown',phone:'withdrawn'});assert.ok(bv.consents.every(p=>p.captured_on==='2026-09-01'&&p.recorded_at&&p.method===source+' export'))
   const state=await history(h,a.id);assert.equal(state.gifts.length,1);assert.equal(state.plans.length,source==='givebutter'?1:0)
   if(source==='givebutter')assert.deepEqual([state.plans[0].frequency,state.plans[0].amount_cents,state.plans[0].customer_reference,state.plans[0].payment_method_reference],['monthly',1200,key(7072),key(7073)])
   assert.equal(av.subscriptions.length,0,'References never activate a replacement plan')
   await history(h,a.id,{as:member.cookie,status:403});await history(h,a.id,{as:admin.cookie,status:401})
   const journal=await h.get('/api/coffer/move-in/journal?id='+p.id);assert.equal(journal.job.check_report.matches,true,JSON.stringify(journal.job.check_report));assert.equal(JSON.stringify(journal).includes(key(7099)),false)
   const saved=await archive(h)
   await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await history(fresh,a.id)).plans,state.plans);assert.deepEqual((await history(fresh,a.id)).gifts,state.gifts);await post(fresh,'undo',{id:p.id});assert.equal((await h.get('/api/coffer/donors')).total,5);assert.equal((await fresh.get('/api/coffer/donors')).total,0);assert.equal((await history(fresh,a.id)).plans.length,0)})
   assert.equal((await apply(h,await post(h,'preview',f.input))).unchanged,true);assert.equal((await read(a.id)).gifts.length,1);assert.deepEqual((await history(h,a.id)).plans,state.plans)
   await post(h,'undo',{id:p.id});assert.equal((await h.get('/api/coffer/custom-fields')).fields.some(f=>f.key==='source_seating'),false,'Undo removes untouched source-created definitions');assert.equal((await h.get('/api/coffer/donors')).total,0);assert.equal((await history(h,a.id)).plans.length,0)
   await apply(h,await post(h,'preview',f.input))
   await h.command('household.update',{householdId:b.household_id,version:(await h.get('/api/coffer/households/'+b.household_id)).household.version,informal_override:'A later family greeting'})
   await post(h,'undo',{id:p.id},{status:409});assert.equal((await h.get('/api/coffer/households/'+b.household_id)).household.informal_override,'A later family greeting')
   const tribute=(await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Rain');assert.equal(tribute.totalCents,75000);assert.equal((await read(a.id)).giftDepth.tributes[0].amount_permission,0);assert.equal((await read(a.id)).giftDepth.tributes[0].source_group,key(7040))
   const notification=await h.command('tributeNotification.prepare',{giftId:gift(7011).id});const prepared=(await read(a.id)).tributeNotifications.find(n=>n.id===notification.id);assert.equal(prepared.recipient_name,'River Rain');assert.ok(!prepared.body.includes('$'));assert.equal(h.messages.filter(m=>JSON.stringify(m).includes('River Rain')).length,0)
   const appeal=await h.command('appeal.prepare',{name:'Imported preferences',channel:'email'});assert.equal(appeal.excluded['no consent recorded'],1);assert.equal((await h.get('/api/coffer/appeals/'+appeal.id)).recipients.some(r=>r.donor_id===b.id),false);await h.command('appeal.discard',{appealId:appeal.id,version:1})
   const mail=await h.command('appeal.prepare',{name:'Imported mail preferences',channel:'mail'},{status:409});assert.equal(mail.error,'NCOA_NOT_CONNECTED','Source preferences cannot bypass the before-mail address-processing guard');const outreach=(await history(h,b.id)).outreach;assert.equal(outreach.mail.excluded['consent withdrawn'],1);assert.equal(outreach.mail.recipients.length,0);assert.equal(outreach.email.excluded['no consent recorded'],1);assert.equal(outreach.email.recipients.length,0)
   const sms=await h.command('sms.prepare',{name:'Imported text preferences',purpose:'appeal',donorIds:[b.id],body:'Support our reading room.'});assert.equal(sms.recipients,0);assert.deepEqual(sms.excluded.map(r=>r.reason),['no SMS consent recorded'])
   await h.command('gift.reverse',{giftId:gift(7012).id,reason:'Source return'});assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Rain').totalCents,30000)
   await h.command('consent.record',{donorIds:[b.id],channel:'email',status:'withdrawn',method:'paper form',evidence:key(7081),capturedOn:'2026-09-02'})
   const changed=structuredClone(f.input);changed.files.push(file('changed-contact',[{'Constituent ID':key(7002),'Name':'Blake Reed','Email Preference':'yes'}]));const rejected=await post(h,'preview',changed,source==='givebutter'?{status:400}:{});if(source==='zeffy')assert.equal(rejected.canApply,false,'New review cannot overwrite a native preference')
   const target=await donor(h,'Avery Survivor',{email:email(7082)})
   const merge=await h.get('/api/coffer/duplicates/compare?source='+a.id+'&target='+target.id)
   await h.command('donor.merge',{sourceDonorId:a.id,donorId:target.id,sourceVersion:merge.source.version,version:merge.target.version,reason:'duplicate_record'})
   assert.equal((await history(h,target.id)).plans.length,state.plans.length);assert.equal((await history(h,a.id)).plans.length,state.plans.length,'Reviewed source aliases follow the merged person')
   await h.command('donor.erase',{donorId:target.id,confirm:'ERASE'})
   assert.equal((await history(h,target.id)).plans.length,0);assert.equal((await history(h,target.id)).gifts.length,0)
   const erased=JSON.stringify(await archive(h));assert.ok(!erased.includes(key(7072))&&!erased.includes(key(7073)),'Erasure removes processor references from portable custody');
   const replay=await post(h,'preview',f.input);assert.equal(replay.canApply,false);await post(h,'apply',{id:replay.id,fingerprint:replay.fingerprint},{status:409})
   assert.equal(JSON.stringify(f.plans),initialPlans,'Source plan remains unchanged')
  },source==='givebutter'?{outbound:f.outbound}:{})
 }
}
