import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

const row = (page,kind,id) => page.locator(`[id=${JSON.stringify('webhook-'+kind+'-'+id)}]`)
const state = h => h.get('/api/coffer/webhooks')
const terminal = new Set(['delivered','exhausted','held'])

async function fits(page,width){
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Webhook screen fits '+width)
 const unnamed=await page.locator('main button,main a').evaluateAll(nodes=>nodes.filter(node=>node.checkVisibility()&&!node.textContent.trim()).length)
 assert.equal(unnamed,0,'Webhook controls have visible text')
}

async function submit(page,button,keyboard=false){
 const [response]=await Promise.all([
  page.waitForResponse(response=>new URL(response.url()).pathname==='/app/actions'&&response.request().method()==='POST'),
  page.waitForNavigation({waitUntil:'load'}),
  keyboard?page.keyboard.press('Enter'):button.click(),
 ])
 assert.ok([200,303].includes(response.status()),'Webhook action completes through its real command; HTTP '+response.status())
}

export async function webhooksBrowser(h,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  page.setDefaultTimeout(15000)
  const replayed=new Set()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/settings')
   await fits(page,width)
   await page.screenshot({path:`${directory}/API-002-settings-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Webhooks',exact:true}).click()
   await page.waitForURL('**/app/webhooks')
   const panel=page.locator('#webhook-connect'),add=panel.getByText('Add an endpoint',{exact:true})
   if(await add.count())await add.click()
   const name=panel.getByLabel('Endpoint name',{exact:true}),endpoint=panel.getByLabel('Endpoint URL',{exact:true})
   await name.focus()
   await name.fill('synthetic-coffer-'+width)
   await page.keyboard.press('Tab')
   assert.equal(await endpoint.evaluate(node=>node===document.activeElement),true,'Endpoint URL follows name in keyboard order')
   await endpoint.fill('https://receiver.example.test/synthetic-coffer-'+width)
   const eventInputs=panel.locator('input[name=events]'),selected=[]
   for(let index=0;index<await eventInputs.count();index++){
    await page.keyboard.press('Tab')
    const input=eventInputs.nth(index)
    assert.equal(await input.evaluate(node=>node===document.activeElement),true,'Every event choice is keyboard accessible')
    if([0,3].includes(index)){
     selected.push(await input.getAttribute('value'))
     await page.keyboard.press('Space')
    }
   }
   await page.keyboard.press('Tab')
   const reviewed=panel.locator('input[name=reviewed]'),connect=panel.getByRole('button',{name:'Connect endpoint',exact:true})
   assert.equal(await reviewed.evaluate(node=>node===document.activeElement),true,'Disclosure approval follows event choices')
   const before=await state(h)
   await connect.click()
   assert.equal(await reviewed.evaluate(node=>node.validity.valueMissing),true,'Subscription requires explicit disclosure approval')
   assert.equal((await state(h)).subscriptions.length,before.subscriptions.length,'Unchecked approval does not connect an endpoint')
   await page.keyboard.press('Escape')
   await fits(page,width)
   await panel.screenshot({path:`${directory}/API-002-connect-${width}.png`})
   await reviewed.focus()
   await page.keyboard.press('Space')
   await page.keyboard.press('Tab')
   assert.equal(await connect.evaluate(node=>node===document.activeElement),true,'Connect button follows approval in keyboard order')
   await submit(page,connect,true)
   const secret=page.locator('[data-webhook-secret]')
   await secret.waitFor()
   assert.equal(await secret.evaluate(node=>node.readOnly&&node.value.length>0),true,'Signing secret is shown once in a read-only field')
   const originalSecret=await secret.inputValue()
   await secret.focus()
   await page.keyboard.press('Tab')
   const back=page.getByRole('link',{name:'Back to webhooks',exact:true})
   assert.equal(await back.evaluate(node=>node===document.activeElement),true,'The secret result has a keyboard return path')
   await fits(page,width)
   await page.screenshot({path:`${directory}/API-002-secret-${width}.png`,fullPage:true,mask:[secret]})
   await page.keyboard.press('Enter')
   await page.waitForURL('**/app/webhooks')
   assert.equal(await page.locator('[data-webhook-secret]').count(),0,'The normal screen does not reveal the signing secret')
   const connected=(await state(h)).subscriptions.find(subscription=>subscription.name==='synthetic-coffer-'+width)
   assert.ok(connected,'Native subscription form persists its endpoint')
   assert.deepEqual([...connected.events].sort(),selected.sort(),'Repeated event checkboxes persist every selected event')
   const pause=row(page,'endpoint',connected.id).getByRole('button',{name:'Pause endpoint',exact:true})
   await pause.focus()
   await submit(page,pause,true)
   assert.equal((await state(h)).subscriptions.find(subscription=>subscription.id===connected.id).enabled,0,'Native pause stops this subscription')
   assert.equal(await row(page,'endpoint',connected.id).getByRole('button',{name:'Pause endpoint',exact:true}).count(),0,'Paused endpoints do not offer another pause action')
   await page.locator('#webhook-connect').getByText('Add an endpoint',{exact:true}).click()
   await panel.getByLabel('Endpoint name',{exact:true}).fill('Replacement '+width)
   await panel.getByLabel('Endpoint URL',{exact:true}).fill(connected.endpoint)
   await panel.locator('input[name=events]').first().check()
   await panel.locator('input[name=reviewed]').check()
   await submit(page,panel.getByRole('button',{name:'Connect endpoint',exact:true}))
   const replacementSecret=page.locator('[data-webhook-secret]')
   assert.notEqual(await replacementSecret.inputValue(),originalSecret,'Replacement approval produces a new key')
   await fits(page,width)
   await page.screenshot({path:`${directory}/API-002-replacement-${width}.png`,fullPage:true,mask:[replacementSecret]})
   await page.getByRole('link',{name:'Back to webhooks',exact:true}).click()
   await page.waitForURL('**/app/webhooks')
   const replacement=(await state(h)).subscriptions.find(item=>item.name==='Replacement '+width)
   await submit(page,row(page,'endpoint',replacement.id).getByRole('button',{name:'Pause endpoint',exact:true}))
   const current=await state(h)
   const delivery=current.deliveries.find(delivery=>terminal.has(delivery.status)&&!replayed.has(delivery.id)&&current.subscriptions.some(subscription=>subscription.id===delivery.subscription_id&&subscription.enabled&&subscription.approved))
   assert.ok(delivery,'The fixture supplies an enabled endpoint with a terminal delivery for each viewport')
   replayed.add(delivery.id)
   for(const item of current.deliveries){
    const enabled=current.subscriptions.some(subscription=>subscription.id===item.subscription_id&&subscription.enabled&&subscription.approved)
    if(!enabled||!terminal.has(item.status))assert.equal(await row(page,'delivery',item.id).getByText('Replay this delivery',{exact:true}).count(),0,'In-flight and paused deliveries cannot be replayed')
   }
   const original=row(page,'delivery',delivery.id)
   await original.getByText('Replay this delivery',{exact:true}).click()
   const approve=original.getByRole('checkbox',{name:/I checked the receiver/}),queue=original.getByRole('button',{name:'Queue replay',exact:true})
   await queue.click()
   assert.equal(await approve.evaluate(node=>node.validity.valueMissing),true,'Manual replay requires duplicate acknowledgment')
   assert.equal((await state(h)).deliveries.length,current.deliveries.length,'Unchecked approval does not queue a replay')
   await page.keyboard.press('Escape')
   await approve.focus()
   await page.keyboard.press('Space')
   await page.keyboard.press('Tab')
   assert.equal(await queue.evaluate(node=>node===document.activeElement),true,'Replay approval leads to its keyboard action')
   await submit(page,queue,true)
   const after=await state(h),replay=after.deliveries.find(item=>item.replay_of===delivery.id&&!current.deliveries.some(old=>old.id===item.id))
   assert.ok(replay,'Replay creates a separate delivery with lineage')
   assert.equal(replay.status,'pending','Manual replay is queued')
   assert.equal(after.deliveries.find(item=>item.id===delivery.id).status,delivery.status,'Replay preserves the original result')
   await row(page,'delivery',replay.id).getByText('Replay of',{exact:false}).waitFor()
   const history=page.locator('#webhook-deliveries summary').filter({hasText:'Attempt history ('})
   if(await history.count())await history.first().click()
   await fits(page,width)
   await page.locator('#webhook-deliveries').screenshot({path:`${directory}/API-002-deliveries-${width}.png`})
   await row(page,'endpoint',connected.id).screenshot({path:`${directory}/API-002-paused-${width}.png`})
  }
  await page.close()
 })
}

export async function webhooksHistoryBrowser(h,directory){
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/webhooks')
   await page.getByText('Delivery and retention policy',{exact:true}).click()
   await page.getByText('History stays in this installation until the associated donor is erased.',{exact:false}).waitFor()
   await fits(page,width)
   await page.getByRole('link',{name:'Older deliveries',exact:true}).click()
   await page.getByRole('link',{name:'Newest deliveries',exact:true}).waitFor()
   assert.ok(await page.locator('#webhook-deliveries tr[id]').count(),'Older retained deliveries are browsable')
   await fits(page,width)
   await page.screenshot({path:`${directory}/API-002-history-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Newest deliveries',exact:true}).click()
   assert.equal(new URL(page.url()).search,'','Newest history returns without a cursor')
  }
  await page.close()
 })
}


export async function webhooksContinuityBrowser(h,directory,{targetId,deliveryId,recoveryIds}={}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  page.setDefaultTimeout(15000)
  for(const [index,width] of [1440,390].entries()){
   await page.setViewportSize({width,height:1000})
   let endpoint
   if(recoveryIds)endpoint={id:recoveryIds[index]}
   else endpoint=await h.command('webhook.subscribe',{name:'synthetic-coffer-'+(2340+index),endpoint:'https://receiver.example.test/synthetic-coffer-'+(2340+index),events:['donor.updated'],reviewed:'yes'})
   await page.goto(origin+'/app/settings')
   await page.getByRole('link',{name:'Webhooks',exact:true}).click()
   const endpointRow=row(page,'endpoint',endpoint.id)
   await endpointRow.getByText('Manage signing keys',{exact:true}).click()
   const action=recoveryIds?'Approve fresh key':'Rotate signing key'
   const actionForm=endpointRow.locator('form').filter({has:page.getByRole('button',{name:action,exact:true})})
   if(!recoveryIds){
    const minutes=actionForm.getByLabel('Overlap minutes',{exact:true})
    await minutes.focus();await minutes.fill('10');await page.keyboard.press('Tab')
    assert.equal(await actionForm.locator('input[name=reviewed]').evaluate(node=>node===document.activeElement),true,'Overlap choice leads to explicit approval by keyboard')
   }
   const approved=actionForm.locator('input[name=reviewed]'),button=actionForm.getByRole('button',{name:action,exact:true})
   await button.click()
   assert.equal(await approved.evaluate(node=>node.validity.valueMissing),true,'Key custody changes require explicit approval')
   await page.keyboard.press('Escape');await approved.focus();await page.keyboard.press('Space');await page.keyboard.press('Tab')
   assert.equal(await button.evaluate(node=>node===document.activeElement),true,'Custody approval leads to its keyboard action')
   await submit(page,button,true)
   const secret=page.locator('[data-webhook-secret]')
   assert.equal(await secret.evaluate(node=>node.readOnly&&node.value.length>0),true)
   await fits(page,width)
   await page.screenshot({path:`${directory}/API-002-${recoveryIds?'recovery':'rotation'}-secret-${width}.png`,fullPage:true,mask:[secret]})
   await page.getByRole('link',{name:'Back to webhooks',exact:true}).click()
   assert.equal(await page.locator('[data-webhook-secret]').count(),0)
   await endpointRow.getByText('Manage signing keys',{exact:true}).click()
   const saved=(await state(h)).subscriptions.find(item=>item.id===endpoint.id)
   if(recoveryIds){
    assert.equal(saved.enabled,0,'Recovery stays paused for receiver setup')
    assert.equal(saved.key_available,true)
    await fits(page,width)
    await endpointRow.screenshot({path:`${directory}/API-002-recovery-paused-${width}.png`})
    continue
   }
   assert.equal(saved.previous_key,1,'Reviewed overlap retains both signing keys')
   await fits(page,width)
   await endpointRow.screenshot({path:`${directory}/API-002-overlap-${width}.png`})
   const retire=endpointRow.locator('form').filter({has:page.getByRole('button',{name:'Retire previous key',exact:true})})
   await retire.locator('input[name=reviewed]').check()
   await submit(page,retire.getByRole('button',{name:'Retire previous key',exact:true}))
   await submit(page,endpointRow.getByRole('button',{name:'Pause endpoint',exact:true}))
   await endpointRow.getByText('Manage signing keys',{exact:true}).click()
   const resume=endpointRow.locator('form').filter({has:page.getByRole('button',{name:'Resume endpoint',exact:true})})
   await resume.locator('input[name=reviewed]').check()
   await submit(page,resume.getByRole('button',{name:'Resume endpoint',exact:true}))
   assert.equal((await state(h)).subscriptions.find(item=>item.id===endpoint.id).enabled,1)
   await endpointRow.getByText('Manage signing keys',{exact:true}).click()
   await fits(page,width)
   await endpointRow.screenshot({path:`${directory}/API-002-resumed-${width}.png`})
   const deliveryRow=row(page,'delivery',deliveryId)
   await deliveryRow.getByText('Replay to replacement',{exact:true}).click()
   const migration=deliveryRow.locator('form').filter({has:page.locator('input[name=subscriptionId][value='+JSON.stringify(targetId)+']')})
   const prior=(await state(h)).deliveries,count=prior.length
   await migration.getByRole('button',{name:'Queue replacement replay',exact:true}).click()
   assert.equal(await migration.locator('input[name=reviewed]').evaluate(node=>node.validity.valueMissing),true)
   assert.equal((await state(h)).deliveries.length,count,'Replacement disclosure requires review')
   await page.keyboard.press('Escape');await migration.locator('input[name=reviewed]').check()
   await fits(page,width)
   await deliveryRow.screenshot({path:`${directory}/API-002-replacement-review-${width}.png`})
   await submit(page,migration.getByRole('button',{name:'Queue replacement replay',exact:true}))
   const migrated=(await state(h)).deliveries.find(item=>item.replay_of===deliveryId&&item.subscription_id===targetId&&!prior.some(old=>old.id===item.id))
   assert.ok(migrated,'Native replacement replay retains its parent')
   assert.equal(migrated.status,'pending')
   await row(page,'delivery',migrated.id).screenshot({path:`${directory}/API-002-replacement-queued-${width}.png`})
   await fits(page,width)
  }
  await page.close()
 })
}

export async function webhooksNetworkBrowser(h,directory,refusals){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  try {
   await page.goto(origin+'/app/webhooks')
   const outcomes=[
    ['dns_nonpublic','DNS preflight refused a nonpublic address.'],
    ['dns_alias_unsafe','DNS preflight refused an unsafe or inconsistent alias chain.'],
    ['dns_incomplete','DNS preflight could not establish complete public address resolution.'],
    ['dns_malformed','DNS preflight received an invalid resolution response.'],
    ['dns_unavailable','DNS preflight was unavailable.'],
   ]
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    for(const [code,meaning] of outcomes){
     const selected=code==='dns_unavailable'?refusals.find(item=>item.label==='truncated public A response'):refusals.find(item=>item.code===code)
     const delivery=row(page,'delivery',selected.id)
     if(width===1440){
      assert.ok((await delivery.innerText()).includes(meaning+' No target request was sent.'),'The refusal log explains '+code)
      assert.equal(await delivery.getByText('HTTP',{exact:false}).count(),0,'DNS refusal does not invent an HTTP status')
      await delivery.getByText('Attempt history (1)',{exact:true}).click()
      assert.ok((await delivery.locator('ol').innerText()).includes(meaning+' No target request was sent.'),'Attempt history retains the same honest outcome')
     }
    }
    await fits(page,width)
    const sample=row(page,'delivery',refusals.find(item=>item.code==='dns_nonpublic').id)
    await sample.scrollIntoViewIfNeeded()
    await sample.screenshot({path:`${directory}/API-002-network-refusal-${width}.png`})
    const truncated=row(page,'delivery',refusals.find(item=>item.label==='truncated public A response').id)
    await truncated.scrollIntoViewIfNeeded()
    await truncated.screenshot({path:`${directory}/API-002-truncated-resolution-${width}.png`})
   }
  }finally{await page.close()}
 })
}
