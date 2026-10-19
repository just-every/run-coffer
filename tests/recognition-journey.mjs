import {readFile,readdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore,imported} from './harness.mjs'
import {recognitionEdges,giveRecognition,recognitionMember,form} from './recognition-edge.mjs'

export async function recognitionJourney(){
 const edge=recognitionEdges()
 await run(async h=>{
  await reviewed(h)
  const staff=await recognitionMember(h,edge)
  const ada=await donor(h,'Ada Rivera'),ben=await donor(h,'Ben Wells'),cora=await donor(h,'Cora Chen'),privateDonor=await donor(h,'Dina Private')
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Autumn reading',slug:'autumn-reading',description:'Keep the community reading room open through autumn.',fund:'Reading',goal:'60000'})
  const preference=(d,anonymous,recognitionName)=>h.command('recognition.donor',{donorId:d.id,version:0,anonymous,recognitionName,honorRollOptIn:true},{as:staff})
  await preference(ada,true,'The Rivera Family');await preference(ben,false,'The Wells Family');await preference(cora,false,'Library Friends')
  await h.command('recognition.donor',{donorId:ada.id,version:0,anonymous:false},{status:409})
  const emptyWall=await (await h.request('/give/autumn-reading',{as:''})).text();assert.match(emptyWall,/No gifts have been shared/)
  const receiptCount=edge.messages.length
  const paid=[]
  for(const [d,amount,recognitionName,wallOptIn] of [[ada,'250','The Rivera Family','yes'],[ben,'175','The Wells Family','yes'],[cora,'125','Library Friends','yes'],[privateDonor,'80','Dina private alias','no']]){
   paid.push(await giveRecognition(h,{name:(await h.get(`/api/coffer/donors/${d.id}`)).donor.name,email:(await h.get(`/api/coffer/donors/${d.id}`)).donor.email,amount,recognitionName,wallOptIn}))
  }
  const giftOf=async d=>(await h.get(`/api/coffer/donors/${d.id}`)).gifts.find(g=>g.kind==='gift')
  const benGift=await giftOf(ben),adaGift=await giftOf(ada),coraGift=await giftOf(cora)
  await h.command('recognition.gift',{giftId:benGift.id,anonymous:true,wallOptIn:true,recognitionName:'The Wells Family'},{as:staff})
  await h.command('recognition.gift',{giftId:(await giftOf(privateDonor)).id,wallOptIn:true,recognitionName:'Dina private alias'},{status:409})
  const changed=await h.request('/give/autumn-reading/checkout',form({...paid[0].input,anonymous:'yes'}));assert.equal(changed.status,409,'Checkout replay cannot change the frozen publication choices')
  const pageHtml=await (await h.request('/give/autumn-reading',{as:''})).text(),wall=pageHtml.match(/<section[^>]*aria-label="Donor wall"[^>]*>([\s\S]*?)<\/section>/)[1]
  assert.match(wall,/Anonymous/);assert.match(wall,/Library Friends/)
  for(const secret of ['Ada Rivera','Ben Wells','Cora Chen','Dina Private','The Rivera Family','The Wells Family','Dina private alias',ada.id,benGift.id])assert.ok(!wall.includes(secret),secret)
  assert.equal(edge.messages.length-receiptCount,4,'Each gift retains its usual receipt')
  for(const [d,amount] of [[ada,25000],[ben,17500],[cora,12500],[privateDonor,8000]]){
   const state=await h.get(`/api/coffer/donors/${d.id}`),letter=(await h.get(`/api/coffer/letters/${state.gifts[0].ack_batch}`)).letters[0]
   assert.equal(state.totals.lifetimeCents,amount);assert.equal(letter.recipient_name,state.donor.name)
   assert.ok(letter.body.includes(state.donor.name));assert.equal(letter.amount_cents,amount)
   assert.ok((await (await h.request(`/app/donors/${d.id}`)).text()).includes(state.donor.name))
  }
  const query='from=2026-01-01&through=2026-12-31&levels='+encodeURIComponent(JSON.stringify([{name:'Supporter',minimumCents:0},{name:'Leadership',minimumCents:17500}]))
  const reportPath='/api/coffer/reports/honor-roll?'+query,report=await h.get(reportPath)
  assert.equal(report.totalCents,63000);assert.equal(report.rows.length,4)
  assert.equal(report.rows.find(r=>r.name==='Library Friends').amountCents,12500)
  assert.deepEqual(report.rows.filter(r=>r.name==='Anonymous').map(r=>[r.amountCents,r.level]).sort((a,b)=>a[0]-b[0]),[[8000,'Supporter'],[17500,'Leadership'],[25000,'Leadership']])
  const csvResponse=await h.request('/api/coffer/reports/honor-roll.csv?'+query),csv=await csvResponse.text();assert.equal(csvResponse.status,200)
  assert.match(csv,/Library Friends/);assert.ok(!csv.includes('Ada Rivera'));assert.ok(!csv.includes('The Wells Family'))
  const secondAnonymous=await h.command('gift.record',{donorId:ada.id,amount:'25',receivedOn:'2026-09-15',method:'check',goods:'none',fund:'Reading'})
  await h.command('recognition.gift',{giftId:secondAnonymous.id,anonymous:true})
  assert.deepEqual((await h.get(reportPath)).rows.filter(r=>r.name==='Anonymous').map(r=>r.amountCents).sort((a,b)=>a-b),[2500,8000,17500,25000],'Anonymous gifts remain separate even when their donor is anonymous too')
  await h.get(reportPath,{as:staff,status:403});await h.get(reportPath,{as:'',status:401})
  const key=await h.command('agent.create',{label:'Recognition authority'}),agent={as:'',headers:{authorization:`Bearer ${key.token}`}}
  await h.get(reportPath,{...agent,status:403});await h.command('recognition.donor',{donorId:ada.id,version:1,anonymous:false},{...agent,status:403})
  assert.ok((await h.get('/api/coffer/audit?action=recognition.honorRoll')).rows.length>0)
  // Monetary recognition follows the actual remaining gift balance, including reversals.
  const coraBatch=await h.get(`/api/coffer/letters/${coraGift.ack_batch}`);await h.command('ack.export',{batchId:coraGift.ack_batch,version:coraBatch.batch.version})
  await h.command('gift.reverse',{giftId:coraGift.id,reason:'Returned to donor'})
  assert.equal((await h.get(reportPath)).totalCents,53000)
  assert.ok(!(await h.get(reportPath)).rows.some(r=>r.name==='Library Friends'))
  assert.ok(!(await (await h.request('/give/autumn-reading',{as:''})).text()).includes('Library Friends'))
  // Current property originals also accept anonymity without inventing monetary value.
  const property=await h.command('inKind.save',{donorId:ada.id,description:'Books for the reading room',quantity:'12',statedValue:'900',receivedOn:'2026-09-15',fund:'Reading',goods:'none',form8283:'not_section_b'})
  await h.command('recognition.gift',{giftId:property.id,anonymous:true},{as:staff})
  assert.equal((await h.get(reportPath)).totalCents,53000)
  assert.equal((await h.get(`/api/coffer/donors/${ada.id}`)).gifts.find(g=>g.id===property.id).recognition.anonymous,1)
  if(process.env.COFFER_RECOGNITION_BROWSER){const {recognitionBrowser}=await import('./recognition-browser.mjs');await recognitionBrowser(h,edge,ada.id,ben.id,process.env.COFFER_RECOGNITION_BROWSER)}
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);assert.equal((await fresh.get(`/api/coffer/donors/${ada.id}`)).recognition.anonymous,1);assert.equal((await fresh.get(reportPath)).totalCents,(await h.get(reportPath)).totalCents);const restoredWall=await (await fresh.request('/give/autumn-reading',{as:''})).text();assert.ok(!restoredWall.includes('<strong>The Rivera Family</strong>'))},{bindings:{STRIPE_SECRET_KEY:'sk_test_recognition_edge'}})
  const comparison=await h.get(`/api/coffer/duplicates/compare?source=${ada.id}&target=${ben.id}`)
  const merge=await h.command('donor.merge',{sourceDonorId:ada.id,donorId:ben.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.equal((await h.get(`/api/coffer/donors/${ben.id}`)).recognition.anonymous,1)
  assert.ok(!(await (await h.request('/give/autumn-reading',{as:''})).text()).includes('<strong>The Rivera Family</strong>'))
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'})
  assert.equal((await h.get(`/api/coffer/donors/${ben.id}`)).recognition.anonymous,0)
  assert.equal((await h.get(`/api/coffer/donors/${ada.id}`)).recognition.anonymous,1)
  const importedJob=await imported(h),importedEmails=new Set(importedJob.input.customers.flatMap(p=>p.data).map(c=>c.email)),stripeDonor=(await h.get('/api/coffer/donors')).donors.find(d=>importedEmails.has(d.email))
  assert.ok(stripeDonor,'The selected donor belongs to this saved-page move-in')
  await h.command('recognition.donor',{donorId:stripeDonor.id,version:0,anonymous:true})
  await h.api('/api/coffer/imports/undo',{id:importedJob.job.id},{status:409})
  assert.equal((await h.get(`/api/coffer/donors/${stripeDonor.id}`)).recognition.anonymous,1)
  await run(async fresh=>{
   const directory='tests/fixtures/move-in/lgl',files=await Promise.all((await readdir(directory)).filter(name=>name.endsWith('.csv')).map(async name=>({name,base64:(await readFile(`${directory}/${name}`)).toString('base64')})))
   const preview=await fresh.api('/api/coffer/move-in/preview',{source:'lgl',files});assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
   let moved=await fresh.api('/api/coffer/move-in/apply',{id:preview.id,fingerprint:preview.fingerprint})
   while(moved.state==='applying')moved=await fresh.api('/api/coffer/move-in/continue',{id:preview.id})
   const importedDonor=(await fresh.get('/api/coffer/donors')).donors.find(d=>d.total_cents>0),history=await fresh.get(`/api/coffer/donors/${importedDonor.id}`),gift=history.gifts.find(g=>g.kind==='gift')
   await fresh.command('recognition.gift',{giftId:gift.id,anonymous:true})
   await fresh.api('/api/coffer/move-in/undo',{id:preview.id},{status:409})
   assert.equal((await fresh.get(`/api/coffer/donors/${importedDonor.id}`)).gifts.find(g=>g.id===gift.id).recognition.anonymous,1)
  })

  await h.command('donor.erase',{donorId:ada.id,confirm:'ERASE'})
  assert.ok(!JSON.stringify(await archive(h)).includes('The Rivera Family'))
  assert.ok(!(await (await h.request('/give/autumn-reading',{as:''})).text()).includes('<strong>The Rivera Family</strong>'))
  assert.equal((await h.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.id===campaign.id).raised_cents,50500+(edge.sessions.size-4)*2000)
 },{bindings:{STRIPE_SECRET_KEY:'sk_test_recognition_edge',MAIL_PROVIDER:'sendgrid'},outbound:edge.outbound})
}
