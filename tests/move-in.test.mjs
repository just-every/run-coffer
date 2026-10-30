import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'
import {mkdir} from 'node:fs/promises'
import {run,donor,archive,restore} from './harness.mjs'

export async function exportInput(source,format='csv') {
 const dir=`tests/fixtures/move-in/${source}`
 const files=await Promise.all((await readdir(dir)).filter(name=>name.endsWith(`.${format}`)).sort().map(async name=>({name,base64:(await readFile(`${dir}/${name}`)).toString('base64')})))
 return {source,files}
}
const endpoint='/api/coffer/move-in'
const post=(h,action,input,options)=>h.api(`${endpoint}/${action}`,input,options)
// Applies a reviewed move-in through its last part, as the Continue button does.
async function moveIn(h,preview,extra={}){
 let job=await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint,...extra})
 while(job.state==='applying')job=await post(h,'continue',{id:preview.id})
 return job
}

// ACK-001 / MOVE-001..003 / MOVE-007: configured source columns preserve facts,
// reject unknown states and keep both per-gift exclusions and the reviewed cutoff.
async function sourceAcknowledgments(h,source) {
 const [donorId,giftId,type,status,date,method,reason,label,reference,optOut]=({
  lgl:['LGL Constituent ID','LGL Gift ID','Gift','Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Reason','Little Green Light','Acknowledgment Template','Do Not Acknowledge via LGL'],
  bloomerang:['Account Number','Transaction Number','Donation','Acknowledged?','Acknowledgement Date','Acknowledgement Method','Acknowledgement Reason','Bloomerang','Acknowledgment Interaction ID','Do Not Acknowledge'],
  're-nxt':['Constituent ID','Gift ID','Cash','Acknowledgement','Acknowledged Date','Acknowledgement Method','Acknowledgement Reason',"Raiser's Edge NXT",'Acknowledgment Letter','Do Not Acknowledge'],
 })[source]
 const rows=[
  ['ACK_FULL','2026-09-01','500','0','acknowledged','2026-09-02','personal email','Source thank-you'],
  ['ACK_NO_DETAILS','2026-09-03','300','0','acknowledged','','',''],
  ['ACK_SKIP','2026-09-04','250','0',source==='lgl'?'do not acknowledge via LGL':'do not acknowledge','','','Donor requested no letter'],
  ['ACK_DUE','2026-09-05','250','60','not acknowledged','','',''],
  ['ACK_OLD','2024-09-01','250','0','not acknowledged','','',''],
  ['ACK_UNKNOWN','2026-09-06','250','','not acknowledged','','',''],
  ['ACK_ABSENT','2026-09-07','250','0','','','',''],
 ].map(r=>source==='bloomerang'?r.map((v,i)=>i===4?({'acknowledged':'Yes','not acknowledged':'No','do not acknowledge':'Do Not Acknowledge'}[v]??v):v):r)
 if(source==='bloomerang')rows[0].push('interaction-48','')
 const vendorRows=source==='lgl'?[
  ['ACK_TEMPLATE','2026-09-08','500','0','','2026-09-09','','','Spring thank-you',''],
  ['ACK_TEMPLATE_NO_DATE','2026-09-08','500','0','','','','','Spring thank-you',''],
  ['ACK_TEMPLATE_SKIP','2026-09-09','500','0','not acknowledged','2026-09-10','','Donor opted out','Spring thank-you','Yes'],
 ]:source==='re-nxt'?[
  ['ACK_DATE','2026-09-08','500','0','','2026-09-09','','','',''],
  ['ACK_LINK','2026-09-09','500','0','not acknowledged','','','','Legacy letter 42',''],
  ['ACK_DATE_SKIP','2026-09-10','500','0','do not acknowledge','2026-09-11','','Donor opted out','Legacy letter 43',''],
  ['ACK_FLAG_SKIP','2026-09-11','500','0','not acknowledged','2026-09-12','','Donor opted out','Legacy letter 44','Yes'],
 ]:[]
 rows.push(...vendorRows)
 const file=(name,values)=>({name,base64:Buffer.from(values.map(r=>r.join(',')).join('\r\n')+'\r\n').toString('base64')})
 const input=(giftRows=rows)=>({source,files:[file('constituents.csv',[[donorId,'Name'],['ACK_PERSON','Imported acknowledgment donor']]),file('gifts.csv',[
  [giftId,donorId,'Gift Type','Gift Date','Amount','Payment Method','Non-Deductible Amount','Goods Description',status,date,method,reason,reference,optOut],
  ...giftRows.map(([id,on,amount,goods,...ack])=>[id,'ACK_PERSON',type,on,amount,'Check',goods,goods==='60'?'Dinner':'',...ack]),
 ]),...(source==='bloomerang'?[file('interactions.csv',[['Interaction ID',donorId,'Interaction Date','Interaction Type','Note'],['interaction-48','ACK_PERSON','2026-09-02','email','Source thank-you email']])]:[])]})
 for(const broken of [rows.map((r,i)=>i===0?r.map((v,j)=>j===4?'queued':v):r),rows.map((r,i)=>i===0?r.map((v,j)=>j===5?'2026-02-30':v):r),rows.map((r,i)=>i===0?[...r.slice(0,8),'','sometimes']:r)]) {
  const review=await post(h,'preview',input(broken))
  assert.equal(review.canApply,false,'Unknown status, invalid source date and unknown opt-out flag require review')
  assert.ok(review.diagnostics.some(d=>d.severity==='error'&&['ACKNOWLEDGMENT_STATUS','DATE'].includes(d.code)&&d.file==='gifts.csv'&&d.row===2))
  await post(h,'apply',{id:review.id,fingerprint:review.fingerprint,acceptedReason:'Do not silently accept unknown acknowledgment facts'},{status:409})
 }
 const checked=await post(h,'preview',{...input(),noGoodsOrServices:true})
 assert.equal(checked.gifts.find(g=>g.externalId==='ACK_DUE').goodsCents,6000,'Source goods value survives the upload checkbox')
 assert.equal(checked.gifts.find(g=>g.externalId==='ACK_UNKNOWN').goodsCents,0,'The checkbox fills only an absent source answer')
 const preview=await post(h,'preview',input())
 assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
 assert.equal(preview.needsAcceptance,false,JSON.stringify(preview.unmapped))
 await moveIn(h,preview,{acknowledged:'yes',acknowledgedBefore:'2025-01-01'})
 const person=(await h.get('/api/coffer/donors')).donors[0]
 const history=await h.get(`/api/coffer/donors/${person.id}`),gifts=Object.fromEntries(history.gifts.map(g=>[g.reference.split(':')[1],g]))
 assert.equal(history.totals.lifetimeCents,205000+vendorRows.length*50000)
 assert.deepEqual(['ACK_FULL','ACK_NO_DETAILS','ACK_SKIP','ACK_DUE'].map(k=>gifts[k].acknowledgment.status),['acknowledged','acknowledged','do not acknowledge','not acknowledged'])
 assert.deepEqual(['acknowledged_on','method','reason','source','batch_id','letter_id'].map(k=>gifts.ACK_FULL.acknowledgment[k]),['2026-09-02','email','Source thank-you',label,null,null])
 assert.deepEqual(['acknowledged_on','method','reason'].map(k=>gifts.ACK_NO_DETAILS.acknowledgment[k]),[null,null,null],'An acknowledged source gift never invents missing details')
 assert.equal(gifts.ACK_SKIP.acknowledgment.reason,'Donor requested no letter')
 assert.equal(gifts.ACK_OLD.before_acknowledge_from,true);assert.equal(gifts.ACK_DUE.before_acknowledge_from,false)
 assert.equal(gifts.ACK_ABSENT.acknowledgment.status,'not acknowledged','A missing source status defaults to not acknowledged')
 if(source==='lgl') {
  assert.deepEqual(['status','acknowledged_on','method','source_reference'].map(k=>gifts.ACK_TEMPLATE.acknowledgment[k]),['acknowledged','2026-09-09','letter','Spring thank-you'])
  assert.deepEqual(['status','acknowledged_on','method','source_reference'].map(k=>gifts.ACK_TEMPLATE_NO_DATE.acknowledgment[k]),['acknowledged',null,'letter','Spring thank-you'],'An assigned LGL template never invents an absent acknowledged date')
  assert.equal(gifts.ACK_TEMPLATE_SKIP.acknowledgment.status,'do not acknowledge','Do not acknowledge via LGL wins over an assigned template and date')
  assert.equal(gifts.ACK_TEMPLATE_SKIP.acknowledgment.source_reference,'Spring thank-you')
 } else if(source==='re-nxt') {
  assert.deepEqual(['status','acknowledged_on','method','source_reference'].map(k=>gifts.ACK_DATE.acknowledgment[k]),['acknowledged','2026-09-09',null,null],'NXT date alone establishes acknowledged without inventing a method')
  assert.deepEqual(['status','acknowledged_on','method','source_reference'].map(k=>gifts.ACK_LINK.acknowledgment[k]),['acknowledged',null,null,'Legacy letter 42'],'A linked NXT letter establishes acknowledged without inventing a date or method')
  assert.equal(gifts.ACK_DATE_SKIP.acknowledgment.status,'do not acknowledge','NXT status wins over date and linked letter')
  assert.equal(gifts.ACK_FLAG_SKIP.acknowledgment.status,'do not acknowledge','NXT opt-out flag wins over date and linked letter')
 } else {
  assert.equal(gifts.ACK_FULL.acknowledgment.source_reference,'Interaction: interaction-48','Bloomerang keeps the source interaction reference')
  assert.equal(gifts.ACK_FULL.acknowledgment.link.id,history.depth.interactions.find(i=>i.notes==='Source thank-you email').id,'The source ID resolves to the imported native conversation')
 }
 assert.deepEqual(['goods','goods_cents','goods_description'].map(k=>gifts.ACK_DUE[k]),['provided',6000,'Dinner'])
 assert.equal(gifts.ACK_NO_DETAILS.goods,'none')
 assert.equal(gifts.ACK_UNKNOWN.goods,'unknown')
 assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.reference).sort(),['ACK_DUE','ACK_UNKNOWN','ACK_ABSENT'].map(k=>`${source}:${k}`).sort(),'Only eligible gifts after the cutoff remain due')
 const saved=await archive(h)
 await run(async fresh=>{
  await restore(fresh,saved)
  assert.deepEqual((await fresh.get(`/api/coffer/donors/${person.id}`)).gifts,history.gifts,'Export and restore retain exact source statuses, dates, methods, reasons and goods')
  await post(fresh,'undo',{id:preview.id})
  assert.equal((await fresh.get('/api/coffer/donors')).total,0,'Restored imports undo their acknowledgment rows before their gifts')
 })
 await post(h,'undo',{id:preview.id})
 assert.equal((await h.get('/api/coffer/donors')).total,0)
 assert.equal((await h.get('/api/coffer/letters')).due.length,0)
 assert.ok((await h.get(`${endpoint}/journal?id=${preview.id}`)).records.every(r=>r.n===0),'Undo removes every owned source acknowledgment record')
}

for(const source of ['lgl','bloomerang','re-nxt'])test(`ACK-001 / MOVE-001..003 / MOVE-007 — ${source}: exports reconcile, source acknowledgment facts govern due gifts, export exactly and undo`,()=>run(async h=>{
 for(const format of ['csv','xlsx']) {
  const input=await exportInput(source,format)
  await post(h,'preview',input,{as:'',status:401})
  const preview=await post(h,'preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
  assert.equal(preview.needsAcceptance,false,JSON.stringify(preview.unmapped))
  assert.deepEqual(preview.counts,{donors:3,households:1,householdsWithHead:0,householdsWithoutHead:1,gifts:3,pledges:1,installments:2,relationships:1,softCredits:1,notes:3,solicitations:0,channelWithdrawals:0})
  assert.equal(preview.sourceTotals.amountCents,90000)
  assert.equal(preview.sourceTotals.giftCount,3)
  assert.ok(preview.reconciliation.length>=13)
  assert.ok(preview.reconciliation.every(r=>r.matches),JSON.stringify(preview.reconciliation))
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  const applied=await moveIn(h,preview)
  assert.equal(applied.state,'completed')
  assert.equal((await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint})).unchanged,true)
  assert.ok((await h.get(`${endpoint}/journal?id=${applied.id}`)).job.check_report.matches)
  const donors=(await h.get('/api/coffer/donors')).donors
  assert.equal(donors.length,3)
  assert.equal(donors.reduce((sum,d)=>sum+d.total_cents,0),90000)
  const maya=donors.find(d=>d.name==='Maya Rivera'),priya=donors.find(d=>d.name==='Priya Chen')
  const history=await h.get(`/api/coffer/donors/${maya.id}`)
  assert.equal(history.household.length,1)
  assert.equal(history.depth.relationships[0].other_name,'Daniel Rivera')
  assert.equal(history.depth.interactions[0].kind,'call')
  assert.match(history.depth.interactions[0].notes,/Discussed pledge/)
  assert.match(history.notes[0].body,/family literacy/)
  assert.equal(history.firstGift.received_on,'2024-12-12')
  assert.equal(history.firstGift.amount_cents,50000)
  assert.equal(history.pledges[0].remaining_cents,15000)
  assert.equal(history.pledges[0].installments.length,2)
  assert.equal((await h.get(`/api/coffer/donors/${priya.id}`)).giftDepth.recognitionCents,10000)
  const daniel=await h.get(`/api/coffer/donors/${donors.find(d=>d.name==='Daniel Rivera').id}`)
  assert.equal(daniel.gifts[0].goods,'provided')
  assert.equal(daniel.gifts[0].goods_cents,6000)
  assert.equal(daniel.gifts[0].appeal,'Community breakfast')
  const repeatPreview=await post(h,'preview',input)
  assert.equal(repeatPreview.prior.state,'completed')
  const repeated=await post(h,'apply',{id:repeatPreview.id,fingerprint:repeatPreview.fingerprint})
  assert.equal(repeated.id,applied.id)
  assert.equal(repeated.unchanged,true)
  const renamed={...input,files:input.files.map(f=>({...f,name:`copy-${f.name}`}))}
  const renamedPreview=await post(h,'preview',renamed)
  assert.equal((await post(h,'apply',{id:renamedPreview.id,fingerprint:renamedPreview.fingerprint})).unchanged,true)
  assert.equal((await h.get('/api/coffer/donors')).donors.reduce((s,d)=>s+d.total_cents,0),90000)
  await post(h,'undo',{id:applied.id})
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  assert.equal((await h.get(`${endpoint}/journal?id=${applied.id}`)).job.state,'undone')
 }
 await sourceAcknowledgments(h,source)
 if(source==='lgl') {
  const input=await exportInput(source)
  const extra={name:'unmapped.csv',base64:Buffer.from('LGL Constituent ID,Name,Favorite Color\r\n104,Jordan Kim,Green\r\n').toString('base64')}
  const different={...input,files:[...input.files,extra].map(f=>f.name==='totals.csv'?{...f,base64:Buffer.from(Buffer.from(f.base64,'base64').toString().replace('3,900.00','3,901.00')).toString('base64')}:f)}
  const p=await post(h,'preview',different)
  assert.ok(p.reconciliation.some(r=>!r.matches))
  assert.ok(p.unmapped.some(r=>r.file==='unmapped.csv'&&r.column==='Favorite Color'&&r.row===2))
  await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{status:409})
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  const accepted=await moveIn(h,p,{acceptedReason:'Source summary includes a $1 adjustment outside the received gifts. Color is intentionally omitted.'})
  assert.match((await h.get(`${endpoint}/journal?id=${accepted.id}`)).job.accepted_reason,/Source summary/)
  const importedDonor=(await h.get('/api/coffer/donors')).donors[0]
  const owner=(await h.get('/auth/session')).operator
  const prospect=await h.command('prospect.save',{donorId:importedDonor.id,ownerId:owner.id,stage:'cultivate',askAmount:'5000',expectedCloseOn:'2026-12-01',nextStep:'Discuss the library renewal.'})
  await post(h,'undo',{id:accepted.id},{status:409})
  assert.ok((await h.get('/api/coffer/prospects')).some(p=>p.id===prospect.id))
  await h.command('gift.record',{donorId:(await h.get('/api/coffer/donors')).donors[0].id,amount:'10',receivedOn:'2026-10-01',method:'check',goods:'none'})
  await post(h,'undo',{id:accepted.id},{status:409})
  assert.equal((await h.get('/api/coffer/donors')).total,4)
  assert.equal((await h.get('/api/coffer/donors')).donors.reduce((s,d)=>s+d.total_cents,0),91000)
 }
}))

// A synthetic Little Green Light export in LGL's own layout, large enough to go in several parts.
test('lgl: a large export moves in part by part, with pledges, soft credits, spouse households and already-thanked history',()=>run(async h=>{
 const {syntheticLgl}=await import('../scripts/synthetic-lgl.mjs')
 const input={source:'lgl',files:Object.entries(syntheticLgl(1000,2500)).map(([name,text])=>({name,base64:Buffer.from(text).toString('base64')}))}
 const preview=await post(h,'preview',input)
 assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics.slice(0,3)))
 assert.equal(preview.unmapped.length,0,JSON.stringify(preview.unmapped.slice(0,3)))
 assert.ok(preview.parts>4,`parts ${preview.parts}`)
 assert.deepEqual([preview.counts.donors,preview.counts.gifts,preview.counts.pledges,preview.counts.households],[1000,2500,25,100])
 assert.ok(preview.counts.softCredits>0)
 const first=await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint,acknowledged:'yes',acknowledgedBefore:'2026-10-01'})
 let job=first
 while(job.state==='applying')job=await post(h,'continue',{id:preview.id})
 const journal=(await h.get(`${endpoint}/journal?id=${preview.id}`)).job
 assert.equal(journal.state,'completed')
 assert.equal(journal.applied_parts,journal.parts)
 assert.ok(journal.check_report.matches,JSON.stringify(journal.check_report.rows.filter(r=>!r.matches).slice(0,3)))
 assert.equal((await h.get('/api/coffer/donors')).total,1000)
 assert.equal((await h.get('/api/coffer/letters')).due.length,0,'History thanked in LGL is not listed as letters due')
 await post(h,'undo',{id:preview.id})
 assert.equal((await h.get('/api/coffer/donors')).total,0)
}))

// The page-alone path a newcomer takes with a real export: every blocking row listed and downloadable,
// spouses sharing one email moved in as one household, and the gift report moved in one span of years at a time.
test('lgl: the review lists every row to fix, spouses share an email, and a later year finds earlier donors and pledges',()=>run(async h=>{
 const {syntheticLgl}=await import('../scripts/synthetic-lgl.mjs')
 const files=syntheticLgl(300,900), lines=t=>t.trimEnd().split('\r\n'), text=rows=>rows.join('\r\n')+'\r\n'
 const input=set=>({source:'lgl',files:Object.entries(set).map(([name,t])=>({name,base64:Buffer.from(t).toString('base64')}))})
 const people=lines(files['constituents.csv']), gifts=lines(files['gifts.csv']), shared=people[1].split(',')[3]
 people[2]=people[2].split(',').map((v,i)=>i===3?shared:v).join(',')
 let zeroed=0
 const broken=gifts.map((row,i)=>{const c=row.split(',');if(i&&c[2]==='Gift'&&!c[9]&&zeroed<60){zeroed++;c[10]='0.00'}return c.join(',')})
 broken.push(gifts.find(r=>r.split(',')[2]==='Soft credit').replace(/^S\d+/,'S9999'))
 const blocked=await post(h,'preview',input({'constituents.csv':text(people),'gifts.csv':text(broken),'relationships.csv':files['relationships.csv']}))
 assert.equal(blocked.canApply,false)
 assert.ok(blocked.diagnostics.some(d=>d.code==='SHARED_EMAIL_HOUSEHOLD'&&d.severity==='warning'))
 const first=await h.get(`${endpoint}/issues?id=${blocked.id}&severity=error`)
 assert.deepEqual([first.total,first.pages],[61,2])
 assert.deepEqual(first.codes.filter(c=>c.severity==='error').map(c=>[c.code,c.n]).sort(),[['GOODS_VALUE',60],['SOFT_DUPLICATE',1]])
 assert.equal((await h.get(`${endpoint}/issues?id=${blocked.id}&severity=error&page=2`)).rows.length,11)
 const download=(await (await h.request(`/app/move-in/crm/issues.csv?id=${blocked.id}&show=error`)).text()).trimEnd().split('\r\n')
 assert.equal(download.length,62)
 assert.ok(download.slice(1).every(r=>/^gifts\.csv,,\d+,/.test(r)),download[1])
 assert.match(await (await h.request(`/app/move-in/crm/review?id=${blocked.id}`)).text(),/61 rows must be fixed/)
 await post(h,'apply',{id:blocked.id,fingerprint:blocked.fingerprint,acceptedReason:'x'},{status:409})
 const [header,...body]=gifts, year=r=>r.split(',')[3].slice(0,4)
 const early=await post(h,'preview',input({'constituents.csv':text(people),'relationships.csv':files['relationships.csv'],'gifts-2019-2024.csv':text([header,...body.filter(r=>year(r)<'2025')])}))
 assert.equal(early.canApply,true,JSON.stringify(early.diagnostics.filter(d=>d.severity==='error').slice(0,3)))
 assert.equal((await moveIn(h,early)).state,'completed')
 const later=await post(h,'preview',input({'constituents.csv':text(people),'gifts-2025-2026.csv':text([header,...body.filter(r=>year(r)>='2025')])}))
 assert.equal(later.canApply,true,JSON.stringify(later.diagnostics.filter(d=>d.severity==='error').slice(0,3)))
 assert.ok(later.gifts.some(g=>g.pledgeExternalId),'A 2025 payment pays a 2024 pledge')
 assert.equal((await moveIn(h,later)).state,'completed')
 const check=(await h.get(`${endpoint}/journal?id=${later.id}`)).job.check_report
 assert.ok(check.matches,JSON.stringify(check.rows.filter(r=>!r.matches).slice(0,3)))
 assert.equal(check.donors.matching,check.donors.total)
 const earlyCheck=(await h.get(`${endpoint}/journal?id=${early.id}`)).job.check_report, cents=body.filter(r=>r.split(',')[2]==='Gift').reduce((n,r)=>n+Math.round(Number(r.split(',')[4])*100),0)
 assert.equal(earlyCheck.rows.find(r=>r.scope==='all').cofferCents+check.rows.find(r=>r.scope==='all').cofferCents,cents)
 assert.equal((await h.get('/api/coffer/donors')).total,300)
 const spouses=(await h.get(`/api/coffer/donors?q=${encodeURIComponent(shared)}`)).donors
 assert.equal(spouses.length,2,'Both source spouses retain their shared email as separate people')
 for(const spouse of spouses){assert.equal(spouse.email,shared);assert.equal((await h.get(`/api/coffer/donors/${spouse.id}`)).household.length,1)}
}))


test('DONOR-013: LGL and Bloomerang contact reports preserve three typed emails and two addresses through reviewed replay and guarded undo',async()=>{
 for(const source of ['lgl','bloomerang','re-nxt'])await run(async h=>{
  const idColumn=source==='lgl'?'LGL Constituent ID':source==='bloomerang'?'Account Number':'Constituent ID'
  const header=[idColumn,'Name','Email','Email Type','Email 2','Email 2 Type','Email 2 Primary','Email 3','Email 3 Type','Address','City','State','ZIP','Address Type','Address 2 Street','Address 2 City','Address 2 State','Address 2 Postal Code','Address 2 Type']
  const values=['synthetic-coffer-1001','Synthetic Contact Import',('synthetic-coffer-1001'+String.fromCharCode(64)+'example.test'),'personal',('synthetic-coffer-1002'+String.fromCharCode(64)+'example.test'),'work','Yes',('synthetic-coffer-1003'+String.fromCharCode(64)+'example.test'),'other','1 Main Street','Springfield','IL','62701','home','2 Vacation Street','Madison','WI','53703','vacation']
  const input={source,files:[{name:'constituents.csv',base64:Buffer.from(header.join(',')+'\r\n'+values.join(',')+'\r\n').toString('base64')}]}
  const preview=await post(h,'preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.equal(preview.unmapped.length,0)
  assert.equal(preview.donors[0].contacts.length,5);assert.equal(preview.donors[0].email,('synthetic-coffer-1002'+String.fromCharCode(64)+'example.test'))
  await moveIn(h,preview)
  const person=(await h.get('/api/coffer/donors?q=Synthetic%20Contact%20Import')).donors[0]
  const details=await h.get('/api/coffer/donors/'+person.id),points=details.contactPoints
  assert.equal(points.length,5);assert.equal(points.filter(p=>p.kind==='email'&&p.is_primary).length,1)
  assert.equal(points.find(p=>p.kind==='email'&&p.is_primary).type,'work');assert.equal(points.find(p=>p.kind==='address'&&p.is_primary).type,'home')
  assert.deepEqual(points.filter(p=>p.kind==='email').map(p=>p.type).sort(),['other','personal','work'])
  assert.ok(points.every(p=>p.source===source+' move-in'));assert.equal(details.contactHistory.length,5)
  assert.equal((await h.get('/api/coffer/donors?q=synthetic-coffer-1003')).donors[0].id,person.id)
  assert.equal((await post(h,'preview',input)).prior.state,'completed','Replay retains the same source contact mappings')
  const csv=await h.request('/api/coffer/exports/constituents.csv?q=Synthetic%20Contact%20Import');assert.match(await csv.text(),new RegExp('synthetic-coffer-1003'+String.fromCharCode(64)+'example.test'))
  if(process.env.COFFER_CONTACT_IMPORT_BROWSER&&source==='lgl'){
   const directory=process.env.COFFER_CONTACT_IMPORT_BROWSER;await mkdir(directory,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){await page.setViewportSize({width,height:1000});for(const [name,path] of [['review','/app/move-in/crm/review?id='+preview.id],['journal','/app/move-in/crm/journal?id='+preview.id],['contacts','/app/donors/'+person.id]]){await page.goto(origin+path);if(name==='review'){await page.getByText('Donors · 1',{exact:true}).click();assert.match(await page.locator('body').innerText(),/email · work · primary/)}assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits '+width);await page.screenshot({path:directory+'/DONOR-013-import-'+name+'-'+width+'.png',fullPage:true})}}await page.close()})
  }
  const saved=await archive(h);await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+person.id)).contactPoints,points)})
  await post(h,'undo',{id:preview.id});assert.equal((await h.get('/api/coffer/donors')).total,0)
  const again=await post(h,'preview',input);await moveIn(h,again)
  const d=await h.get('/api/coffer/donors/'+person.id),point=d.contactPoints.find(p=>p.kind==='email'&&!p.is_primary)
  await h.command('contact.save',{donorId:person.id,donorVersion:d.donor.version,contactId:point.id,version:point.version,kind:point.kind,type:point.type,value:point.value,source:'synthetic-coffer-1004'})
  await post(h,'undo',{id:again.id},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,1,'A later contact edit prevents deleting the imported person')
  await h.command('donor.erase',{donorId:person.id,confirm:'ERASE'})
  assert.equal((await post(h,'preview',input)).canApply,false,'Erasure prevents contact import resurrection')
 })
})

// Synthetic, configurable incumbent reports exercise the actual CSV and XLSX upload doors.
async function customReportFiles(tables,format) {
 const column=index=>{let value='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))value=String.fromCharCode(65+(n-1)%26)+value;return value}
 if(format==='csv')return tables.map(([name,rows])=>({name:name+'.csv',base64:Buffer.from(rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')).toString('base64')}))
 const {zipSync,strToU8}=await import('fflate'),xml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
 const files={
  '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+tables.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>'),
  '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
  'xl/workbook.xml':strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+tables.map(([name],i)=>`<sheet name="${name}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>'),
  'xl/_rels/workbook.xml.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+tables.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+'</Relationships>'),
 }
 for(const [i,[,rows]] of tables.entries())files[`xl/worksheets/sheet${i+1}.xml`]=strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows.map((row,r)=>`<row r="${r+1}">`+row.map((value,c)=>`<c r="${column(c)}${r+1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>')
 return [{name:'synthetic-coffer-1400.xlsx',base64:Buffer.from(zipSync(files)).toString('base64')}]
}

test('DONOR-005: reviewed incumbent custom columns retain typed source values, replay and archive custody, and guard undo',async()=>{
 for(const source of ['lgl','bloomerang','re-nxt'])await run(async h=>{
  const donorColumn=source==='lgl'?'LGL Constituent ID':source==='bloomerang'?'Account Number':'Constituent ID',giftColumn=source==='lgl'?'LGL Gift ID':source==='bloomerang'?'Transaction Number':'Gift ID'
  const field=(column,key,kind,type,entry='free-form',choices=[])=>({source,column,key,label:column,kind,type,entry,choices})
  const mappings=[field('Custom membership','import_membership','constituent','text','pick-one',['Board','Volunteer']),field('Custom interests','import_interests','constituent','text','pick-many',['Books','Music']),field('Custom score','import_score','constituent','number'),field('Custom renewed','import_renewed','constituent','date'),field('Custom active','import_active','constituent','checkbox'),field('Custom gift USD','import_gift_usd','gift','currency'),field('Custom pledge year','import_pledge_year','pledge','year'),field('Custom conversation','import_conversation','interaction','text'),field('Custom note','import_note','note','text')]
  await h.command('custom.define',{...mappings[0]});mappings[0].version=1
  const tables=(membership='Board',currency='123.45')=>[
   ['constituents',[[donorColumn,'Name','Custom membership','Custom interests','Custom score','Custom renewed','Custom active'],['synthetic-coffer-1401','Synthetic Custom Import',membership,JSON.stringify(['Books','Music']),'12.5','2026-10-01','false']]],
   ['gifts',[[giftColumn,donorColumn,'Gift Type','Gift Date','Amount','Payment Method','Non-Deductible Amount','Custom gift USD'],['synthetic-coffer-1402','synthetic-coffer-1401','Gift','2026-10-01','50','Check','0',currency]]],
   ['pledges',[['Pledge ID',donorColumn,'Gift Type','Pledge Date','Amount','Fund','Custom pledge year'],['synthetic-coffer-1403','synthetic-coffer-1401','Pledge','2026-10-01','100','Library','2027']]],
   ['conversations',[['Note ID',donorColumn,'Note','Note Date','Note Type','Custom conversation'],['synthetic-coffer-1404','synthetic-coffer-1401','Met the board','2026-10-01','meeting','Books <and> music']]],
   ['notes',[['Note ID',donorColumn,'Note','Note Date','Note Type','Custom note'],['synthetic-coffer-1405','synthetic-coffer-1401','Original source note','2026-10-01','general','Preserve original']]],
  ]
  for(const format of ['csv','xlsx']){
   const input={source,customFields:mappings,files:await customReportFiles(tables(),format)}
   for(const [membership,currency,column] of [['Unknown','123.45','Custom membership'],['Board','123.456','Custom gift USD']]){
    const invalid=await post(h,'preview',{...input,files:await customReportFiles(tables(membership,currency),format)})
    assert.equal(invalid.canApply,false);assert.ok(invalid.diagnostics.some(d=>d.code==='CUSTOM_VALUE'&&d.column===column&&d.row===2),JSON.stringify(invalid.diagnostics))
    await post(h,'apply',{id:invalid.id,fingerprint:invalid.fingerprint,acceptedReason:'Do not drop custom values'},{status:409})
   }
   const preview=await post(h,'preview',input);assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.equal(preview.unmapped.length,0)
   assert.equal(preview.customFields.length,9);assert.equal((await h.get('/api/coffer/donors')).total,0)
   const review=await h.request('/app/move-in/crm/review?id='+preview.id);assert.match(await review.text(),/Reviewed custom fields/)
   if(process.env.COFFER_CUSTOM_IMPORT_BROWSER&&source==='bloomerang'&&format==='csv'){const {customImportBrowser}=await import('./custom-import-browser.mjs');await customImportBrowser(h,input,preview,process.env.COFFER_CUSTOM_IMPORT_BROWSER)}
   await moveIn(h,preview)
   const person=(await h.get('/api/coffer/donors')).donors[0],details=await h.get('/api/coffer/donors/'+person.id)
   const values=Object.fromEntries(details.customValues.map(v=>[v.field_key,JSON.parse(v.value)]))
   assert.deepEqual(values,{import_active:'false',import_conversation:'Books <and> music',import_gift_usd:'12345',import_interests:['Books','Music'],import_membership:'Board',import_note:'Preserve original',import_pledge_year:'2027',import_renewed:'2026-10-01',import_score:'12.5'})
   const giftValue=details.customValues.find(v=>v.field_key==='import_gift_usd');assert.equal(giftValue.record_id,details.gifts[0].id)
   const provenance=JSON.parse(giftValue.source);assert.equal(provenance.original,'123.45');assert.equal(provenance.sourceRecordId,'synthetic-coffer-1402');assert.equal(provenance.sourceDonorId,'synthetic-coffer-1401');assert.equal(provenance.source,source)
   const saved=await archive(h);await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+person.id)).customValues,details.customValues);await post(fresh,'undo',{id:preview.id});assert.equal((await fresh.get('/api/coffer/donors')).total,0)})
   await run(async h=>{
    await restore(h,saved)
   const definition=(await h.get('/api/coffer/custom-fields')).fields.find(f=>f.key==='import_note')
   await h.command('custom.define',{...definition,label:'Renamed source note',choices:[],version:definition.version})
   const repeat=await post(h,'preview',{...input,files:input.files.map(f=>({...f,name:'renamed-'+f.name}))});assert.equal(repeat.prior.state,'completed')
   assert.equal((await moveIn(h,repeat)).unchanged,true);assert.deepEqual((await h.get('/api/coffer/donors/'+person.id)).customValues,details.customValues)
   await post(h,'undo',{id:preview.id},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,1,'A renamed import-created definition prevents undo')
   })
   await post(h,'undo',{id:preview.id});assert.equal((await h.get('/api/coffer/donors')).total,0)
   if(format==='xlsx'){
    const again=await post(h,'preview',{...input,customFields:mappings});assert.equal(again.canApply,true,JSON.stringify(again.diagnostics));await moveIn(h,again)
    await h.command('custom.set',{key:'import_gift_usd',recordId:giftValue.record_id,version:1,value:'200',source:'synthetic-coffer-1406'})
    await post(h,'undo',{id:again.id},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,1,'Post-import custom edits prevent undo')
   }
  }
 })
})


test('DONOR-001 / DONOR-006: asynchronous incumbent imports keep distinct shared-contact identities and gifts in duplicate review',async()=>{
 for(const source of ['lgl','bloomerang','re-nxt'])await run(async h=>{
  const donorColumn=source==='lgl'?'LGL Constituent ID':source==='bloomerang'?'Account Number':'Constituent ID',giftColumn=source==='lgl'?'LGL Gift ID':source==='bloomerang'?'Transaction Number':'Gift ID'
  const shared=('synthetic-coffer-1501'+String.fromCharCode(64)+'example.test'),family=('synthetic-coffer-1502'+String.fromCharCode(64)+'example.test')
  const staff=await donor(h,'Synthetic Existing Identity',{email:shared})
  await donor(h,'Synthetic Refused Staff Identity',{email:shared},{status:409})
  const csv=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.join(',')).join('\r\n')+'\r\n').toString('base64')})
  const input={source,files:[csv('constituents.csv',[
   [donorColumn,'Name','Email','Email 2','Email 2 Type','Phone','Address','City','State','ZIP','Household ID','Household Name'],
   ['synthetic-coffer-1503','Synthetic Source Identity',shared,('synthetic-coffer-1505'+String.fromCharCode(64)+'example.test'),'work','202-555-0151','151 Shared Street','Madison','WI','53703','synthetic-coffer-1511','Unrelated Source One'],
   ['synthetic-coffer-1504','Synthetic Source Identity',shared,('synthetic-coffer-1505'+String.fromCharCode(64)+'example.test'),'work','202-555-0151','151 Shared Street','Madison','WI','53703','synthetic-coffer-1512','Unrelated Source Two'],
   ['synthetic-coffer-1506','Synthetic Household One',family,'','','202-555-0152','152 Family Street','Madison','WI','53703','synthetic-coffer-1510','Synthetic Import Family'],
   ['synthetic-coffer-1507','Synthetic Household Two',family,'','','202-555-0152','152 Family Street','Madison','WI','53703','synthetic-coffer-1510','Synthetic Import Family'],
  ]),csv('gifts.csv',[[giftColumn,donorColumn,'Gift Type','Gift Date','Amount','Payment Method','Non-Deductible Amount'],
   ['synthetic-coffer-1508','synthetic-coffer-1503','Gift','2026-10-01','21','Check','0'],
   ['synthetic-coffer-1509','synthetic-coffer-1504','Gift','2026-10-01','32','Check','0'],
  ])]}
  const preview=await post(h,'preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.ok(preview.diagnostics.some(d=>d.code==='SHARED_EMAIL'&&d.severity==='warning'))
  await moveIn(h,preview)
  const people=(await h.get('/api/coffer/donors')).donors
  assert.equal(people.length,5,'Distinct source IDs remain distinct even when their names and contacts are identical')
  const imported=people.filter(d=>d.name==='Synthetic Source Identity');assert.equal(imported.length,2)
  const histories=await Promise.all(imported.map(d=>h.get('/api/coffer/donors/'+d.id)))
  assert.deepEqual(histories.map(d=>d.gifts.reduce((n,g)=>n+g.amount_cents,0)).sort((a,b)=>a-b),[2100,3200])
  assert.ok(histories.every(d=>d.contactPoints.some(p=>p.kind==='email'&&p.value===('synthetic-coffer-1505'+String.fromCharCode(64)+'example.test'))))
  assert.equal((await h.get('/api/coffer/donors/'+staff.id)).gifts.length,0,'A shared email never transfers the imported gifts to staff’s existing person')
  const pairs=(await h.get('/api/coffer/duplicates')).pairs,between=(a,b)=>pairs.find(p=>[p.source.id,p.target.id].includes(a)&&[p.source.id,p.target.id].includes(b))
  assert.ok(between(imported[0].id,imported[1].id).reasons.some(r=>r.code==='email'))
  assert.ok(between(imported[0].id,imported[1].id).reasons.some(r=>r.code==='phone'))
  assert.ok(between(imported[0].id,imported[1].id).reasons.some(r=>r.code==='address'))
  assert.ok(imported.every(d=>between(staff.id,d.id)))
  const household=people.filter(d=>d.name.startsWith('Synthetic Household'));assert.equal(household.length,2);assert.ok(!between(household[0].id,household[1].id),'Household contacts keep two people without a duplicate flag')
  const saved=await archive(h);await run(async fresh=>{await restore(fresh,saved);assert.equal((await fresh.get('/api/coffer/donors')).total,5);assert.ok((await fresh.get('/api/coffer/duplicates')).pairs.some(p=>[p.source.id,p.target.id].includes(imported[0].id)&&[p.source.id,p.target.id].includes(imported[1].id)))})
  await post(h,'undo',{id:preview.id});assert.deepEqual((await h.get('/api/coffer/donors')).donors.map(d=>d.id),[staff.id])
  await donor(h,'Synthetic Staff Refusal After Import',{email:shared},{status:409})
 })
})

test('MOVE-010: Bloomerang source definitions, remediation and custody',async()=>{
 const {sourceCustomJourney}=await import('./custom-source-journey.mjs');await sourceCustomJourney()
})
test('MOVE-010: Little Green Light categories and attributes',async()=>{
 const {lglCustomJourney}=await import('./custom-source-lgl.mjs');await lglCustomJourney()
})
test('MOVE-010: NXT code tables and explicit action provenance',async()=>{
 const {nxtCustomJourney}=await import('./custom-source-nxt.mjs');await nxtCustomJourney()
})
test('MOVE-010: Neon account, donation and activity definitions',async()=>{
 const {neonCustomJourney}=await import('./custom-source-neon.mjs');await neonCustomJourney()
})
test('MOVE-010: Spreadsheet declarations retain typed values and waiting rows',async()=>{
 const {spreadsheetCustomJourney}=await import('./custom-source-spreadsheet.mjs');await spreadsheetCustomJourney()
})

test('MOVE-006: mapped spreadsheets reconcile gift history, native matches, source preferences and guarded custody',async()=>{
 const {spreadsheetJourney}=await import('./spreadsheet-journey.mjs')
 await spreadsheetJourney(customReportFiles)
 const {spreadsheetRecordsJourney,spreadsheetAddressJourney}=await import('./spreadsheet-records-journey.mjs')
 await spreadsheetRecordsJourney(customReportFiles)
 await spreadsheetAddressJourney(customReportFiles)
})

test('MOVE-005: Givebutter and Zeffy history reconciles reviewed cash, source acknowledgments, households and recurring custody',async()=>{
 const {platformHistoryJourney}=await import('./platform-history-journey.mjs')
 await platformHistoryJourney()
})

test('MOVE-004: reviewed Neon history preserves money, source acknowledgment, preferences and household custody',async()=>{
 const {neonJourney}=await import('./neon-journey.mjs')
 await neonJourney()
})

test('MOVE-003: reviewed SKY history preserves parent cash, designation splits, opportunities and source custody',async()=>{
 const {blackbaudJourney}=await import('./blackbaud-journey.mjs')
 await blackbaudJourney()
})
