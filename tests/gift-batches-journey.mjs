import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { run, donor, reviewed, archive, restore, installation } from './harness.mjs'
import { withBrowserWorker } from './browser-worker.mjs'

export async function giftBatchesJourney() {
 await run(async h=>{
  await reviewed(h)
  const csv='Account Number,Name,Email Address,Phone\n638101,Elena Legacy,elena.legacy@example.org,217-555-0138\n'
  const preview=await h.api('/api/coffer/move-in/preview',{source:'bloomerang',files:[{name:'constituents.csv',base64:Buffer.from(csv).toString('base64')}]})
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
  let imported=await h.api('/api/coffer/move-in/apply',{id:preview.id,fingerprint:preview.fingerprint})
  while(imported.state==='applying')imported=await h.api('/api/coffer/move-in/continue',{id:preview.id})
  assert.equal(imported.state,'completed')
  const legacy=(await h.get('/api/coffer/donors?q=638101')).donors[0]
  assert.equal(legacy.name,'Elena Legacy')
  assert.equal((await h.get('/api/coffer/donors?q=217-555-0138')).donors[0].id,legacy.id)
  const people=[legacy]
  for(const name of ['Maya Rivera','Daniel Rivera','Priya Chen','Sam Walker','Jo Patel','Iris Clarke','Lena Ortiz','Theo Brown','Ana Cruz','Kai Morgan'])people.push(await donor(h,name))
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Reading room checks',slug:'reading-room-checks',description:'Books for the reading room.',fund:'Reading',goal:'5000'})
  await h.command('appealCode.define',{code:'REPLY-26',name:'Reply cards'})
  const member=await h.person('batch-entry@example.test'), agent=await h.command('agent.create',{label:'Batch reader'})
  await h.command('giftBatch.create',{},{as:'',status:401})
  await h.command('giftBatch.create',{},{as:'',headers:{authorization:'Bearer '+agent.token},status:403})
  let batch
  await h.command('giftBatch.create',{name:'Cash table',receivedOn:'2026-10-01',fund:'Reading',method:'cash',expected:'25'},{as:member.cookie})
  const state=()=>h.get('/api/coffer/gift-batches?id='+batch.id)
  const directory=process.env.COFFER_BATCH_BROWSER??'.cache/gift-batches'
  await mkdir(directory,{recursive:true})
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage()
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/gifts/batches')
    await page.screenshot({path:`${directory}/batch-start-${width}.png`,fullPage:true})
   }
   await page.setViewportSize({width:1440,height:1000})
   await page.getByLabel('Batch name',{exact:true}).fill('October reply cards')
   await page.getByLabel('Received on',{exact:true}).fill('2026-10-01')
   await page.getByLabel('Fund',{exact:true}).fill('Reading')
   await page.locator('select[name=campaignId]').selectOption(campaign.id)
   await page.locator('select[name=appeal]').selectOption('REPLY-26')
   await page.getByLabel('Expected deposit total (USD)',{exact:true}).fill('1250')
   await page.getByRole('button',{name:'Start batch',exact:true}).press('Enter')
   await page.getByRole('heading',{name:'October reply cards',exact:true}).waitFor()
   batch={id:new URL(page.url()).searchParams.get('id')}
   const path=`${origin}/app/gifts/batches?id=${batch.id}`
   // Every check is entered through native forms using the keyboard, including legacy lookup.
   for(let n=0;n<12;n++){
    if(n===11){
     await page.getByText('Add a new donor here',{exact:true}).press('Enter')
     await page.getByLabel('New donor name',{exact:true}).fill('Nora New')
     await page.getByLabel('New donor email',{exact:true}).fill('nora.new@example.org')
     await page.getByRole('button',{name:'Add donor and return to batch'}).press('Enter')
    }else{
     await page.getByLabel('Find donor by name, email, phone or legacy ID').fill(n===0?'638101':(await h.get('/api/coffer/donors/'+people[n].id)).donor.name)
     await page.getByRole('button',{name:'Find donor',exact:true}).press('Enter')
     await page.getByRole('link',{name:'Select '+(n===0?'Elena Legacy':(await h.get('/api/coffer/donors/'+people[n].id)).donor.name),exact:true}).press('Enter')
    }
    await page.getByLabel('Gift amount (USD)',{exact:true}).fill('100')
    await page.keyboard.press('Tab');await page.keyboard.type(String(638200+n))
    if(n===0)await page.screenshot({path:`${directory}/batch-entry-1440.png`,fullPage:true})
    await page.getByRole('button',{name:'Add gift',exact:true}).press('Enter')
   }
   assert.equal((await state()).total_cents,120000)
   assert.equal((await h.get('/api/coffer/donors/'+legacy.id)).gifts.length,0,'Draft checks are not ledger money')
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(path)
    await page.getByRole('button',{name:'Close batch',exact:true}).press('Enter')
    await page.getByRole('alert').filter({hasText:'running total must equal'}).waitFor()
    assert.equal((await state()).status,'open')
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`${directory}/batch-unbalanced-${width}.png`,fullPage:true})
   }
   await page.getByRole('link',{name:'Correct row',exact:true}).last().press('Enter')
   await page.getByLabel('Gift amount (USD)',{exact:true}).fill('150')
   await page.getByRole('button',{name:'Save correction'}).press('Enter')
   const stale=(await state()).version-1
   await h.command('giftBatch.close',{batchId:batch.id,version:stale},{status:409})
   await page.getByRole('button',{name:'Close batch',exact:true}).press('Enter')
   await page.getByRole('status').filter({hasText:'Closed deposit'}).waitFor()
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto(path)
    assert.match(await page.locator('main').innerText(),/Closed deposit · 12 gifts · \$1,250\.00/)
    assert.equal(await page.getByRole('link',{name:'Open gift',exact:true}).count(),12)
    for(let n=0;n<12;n++)assert.match(await page.locator('main').innerText(),new RegExp('Check '+(638200+n)))
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`${directory}/batch-deposit-${width}.png`,fullPage:true})
    await page.goto(origin+'/app/gifts')
    await page.getByLabel('Find a check number',{exact:true}).fill('638200')
    await page.getByRole('button',{name:'Find check',exact:true}).press('Enter')
    assert.equal(await page.locator('.cf-ledger-table tbody tr').count(),1)
    assert.match(await page.locator('.cf-ledger-table').innerText(),/Elena Legacy/)
    await page.screenshot({path:`${directory}/batch-check-search-${width}.png`,fullPage:true})
   }
  })
  const closed=await state()
  assert.equal(closed.depositId,batch.id);assert.equal(closed.total_cents,125000)
  assert.equal((await h.get('/api/coffer/gift-batches')).batches.filter(b=>b.status==='closed').length,1)
  for(const row of closed.entries){
   const gift=(await h.get('/api/coffer/donors/'+row.donor_id)).gifts.find(g=>g.id===row.gift_id)
   assert.equal(gift.reference,row.reference);assert.equal(gift.fund,'Reading');assert.equal(gift.received_on,'2026-10-01');assert.equal(gift.method,'check');assert.equal(gift.appeal,'Reply cards')
  }
  await h.command('giftBatch.close',{batchId:batch.id,version:closed.version},{status:409})
  await h.command('giftBatch.add',{batchId:batch.id,version:closed.version,donorId:legacy.id,amount:'1',reference:'another',goods:'none'},{status:409})
  const report=await h.get('/api/coffer/reports/attribution?from=2026-10-01&to=2026-10-01')
  assert.equal(report.campaign.find(x=>x.key===campaign.id).amountCents,125000)
  const saved=await archive(h),fresh=await installation()
  try{await restore(fresh,saved);assert.equal((await fresh.get('/api/coffer/gift-batches?id='+batch.id)).entries.length,12)}finally{await fresh.close()}
 })
}
