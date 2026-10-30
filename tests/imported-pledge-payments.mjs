import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
const key=n=>'synthetic-coffer-'+n
const file=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.join(',')).join('\r\n')+'\r\n').toString('base64')})
const post=(h,action,body,options)=>h.api('/api/coffer/move-in/'+action,body,options)
const apply=async(h,p)=>{let j=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'});while(j.state==='applying')j=await post(h,'continue',{id:p.id});assert.equal(j.state,'completed');return j}
const input=(n,linked)=>({source:'bloomerang',files:[
 file('constituents.csv',[['Account Number','Name'],[key(9000),'Imported pledge donor']]),
 file('pledges.csv',[['Transaction Number','Account Number','Transaction Type','Date','Amount','Fund'],[key(9001),key(9000),'Pledge','2025-01-01','1000','Library']]),
 file('installments.csv',[['Installment ID','Pledge ID','Due Date','Installment Amount'],[key(9002),key(9001),'2025-02-01','500'],[key(9003),key(9001),'2025-03-01','500']]),
 file((linked?'linked':'unlinked')+'-payments.csv',[['Transaction Number','Account Number','Transaction Type','Date','Amount','Fund','Pledge Number','Installment ID','Non-Deductible Amount'],[key(n),key(9000),'Pledge Payment','2025-02-01','500','Library',key(9001),linked?key(9002):'','0']]),
]})

/** The actual reviewed importer, ledger reads, pledge page and portable history. */
export async function importedPledgePayments(){
 for(const linkedFirst of [false,true])await run(async h=>{
  const first=await post(h,'preview',input(9010,linkedFirst));assert.equal(first.canApply,true,JSON.stringify(first.diagnostics));await apply(h,first)
  const donor=(await h.get('/api/coffer/donors')).donors[0]
  const current=()=>h.get('/api/coffer/donors/'+donor.id)
  let history=await current(),p=history.pledges[0]
  assert.equal(p.paid_cents,50000);assert.equal(p.remaining_cents,50000)
  const original=p.allocations[0];assert.equal(original.amount_cents,50000)
  const secondInput=input(9011,!linkedFirst)
  secondInput.files=secondInput.files.filter(f=>!['pledges.csv','installments.csv'].includes(f.name))
  const second=await post(h,'preview',secondInput)
  assert.equal(second.canApply,true,JSON.stringify(second.diagnostics))
  // Unsafe money writes are attempted, refused, and compared with real state.
  const member=await h.person([key(9090),'example.test'].join('@'))
  const admin=await h.person([key(9091),'example.test'].join('@'),'admin')
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'apply',{id:second.id,fingerprint:second.fingerprint},{as:member.cookie,status:403})
  await post(h,'apply',{id:second.id,fingerprint:second.fingerprint},{as:admin.cookie,status:401})
  await post(h,'apply',{id:second.id,fingerprint:'stale'},{status:409})
  assert.deepEqual(await current(),history)
  await apply(h,second)
  history=await current();p=history.pledges[0]
  const active=p.allocations.filter(a=>!a.replaced_at),i=p.installments.find(i=>i.position===1)
  assert.equal(active.filter(a=>a.installment_id===i.id).length,1,'Installment one has one current allocation, never two same-amount payments')
  assert.equal(i.paid_cents,50000);assert.equal(i.remaining_cents,0)
  assert.equal(p.paid_cents,100000,'A fully paid pledge retains all received money')
  assert.equal(p.remaining_cents,0,'A fully paid pledge has no phantom unpaid balance')
  assert.deepEqual(p.installments.map(i=>[i.paid_cents,i.remaining_cents]),[[50000,0],[50000,0]])
  assert.equal(history.summary.openPledgeCents,0)
  assert.equal(history.gifts.length,2);assert.equal(history.gifts.reduce((n,g)=>n+g.amount_cents,0),100000)
  if(!linkedFirst){
   const old=p.allocations.find(a=>a.id===original.id)
   assert.equal(old.amount_cents,50000);assert.equal(old.gift_id,original.gift_id);assert.equal(old.installment_id,original.installment_id)
   assert.equal(old.import_id,first.id);assert.equal(old.source_file,'unlinked-payments.csv')
   assert.equal(old.replaced_by_import,second.id);assert.equal(old.replacement_file,'linked-payments.csv')
   assert.equal(old.source,'bloomerang');assert.equal(old.replacement_source,'bloomerang')
   assert.equal(p.allocations.length,3,'The earlier allocation remains history alongside the two current allocations')
  }
  await apply(h,second);assert.deepEqual(await current(),history,'Replaying an import cannot replace or count money twice')
  const replay=await post(h,'preview',secondInput);assert.equal(replay.canApply,true,JSON.stringify(replay.diagnostics))
  await apply(h,replay);assert.deepEqual(await current(),history)
  // A conflicting explicit payment is refused without disturbing paid money.
  const conflict=await post(h,'preview',input(9012,true));assert.equal(conflict.canApply,false)
  await post(h,'apply',{id:conflict.id,fingerprint:conflict.fingerprint},{status:409});assert.deepEqual(await current(),history)
  if(!linkedFirst){
   await post(h,'undo',{id:second.id},{status:409});assert.deepEqual(await current(),history)
   const directory=process.env.COFFER_ALLOCATION_SHOTS;if(directory)await mkdir(directory,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{
    const page=await context.newPage();await page.goto(origin+'/app/donors/'+donor.id)
    const panel=page.locator('#pledges');await panel.getByText('Payment history',{exact:true}).click()
    assert.ok((await panel.textContent()).includes('$1,000.00 paid · $0.00 still to come'))
    assert.ok((await panel.textContent()).includes('unlinked-payments.csv'));assert.ok((await panel.textContent()).includes('Replaced by bloomerang: linked-payments.csv'))
    for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await panel.screenshot({path:directory+'/payment-history-'+width+'.png'})}
    await page.close()
   })
   const saved=await archive(h)
   await run(async destination=>{await restore(destination,saved);assert.deepEqual((await destination.get('/api/coffer/donors/'+donor.id)).pledges,[p])})
   await h.command('donor.erase',{donorId:donor.id,version:history.donor.version,confirm:'ERASE'})
   const erased=await post(h,'preview',secondInput);assert.equal(erased.canApply,false)
   await post(h,'apply',{id:erased.id,fingerprint:erased.fingerprint},{status:409})
   assert.equal((await h.get('/api/coffer/donors')).total,0)
  }
 })
}
