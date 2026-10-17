import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {run} from './harness.mjs'

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

for(const source of ['lgl','bloomerang','re-nxt'])test(`${source}: exports preview, reconcile, apply atomically, repeat without duplicates, and undo in one step`,()=>run(async h=>{
 for(const format of ['csv','xlsx']) {
  const input=await exportInput(source,format)
  await post(h,'preview',input,{as:'',status:401})
  const preview=await post(h,'preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
  assert.equal(preview.needsAcceptance,false,JSON.stringify(preview.unmapped))
  assert.deepEqual(preview.counts,{donors:3,households:1,gifts:3,pledges:1,installments:2,relationships:1,softCredits:1,notes:3})
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
