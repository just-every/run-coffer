import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {run,donor,reviewed} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function mobileJourney() {
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'Maya Chen',{phone:'+12025550101'})
  const day=new Date().toISOString().slice(0,10)
  const original=await h.command('gift.record',{donorId:d.id,amount:'250',receivedOn:day,goods:'none',method:'check'})
  const owner=(await h.get('/auth/session')).operator
  const other=await donor(h,'Blake Rivera',{email:'synthetic-coffer-740@example.test'})
  await h.command('task.repeatCreate',{title:'Prepare literacy fair follow-up',ownerId:owner.id,dueOn:day,intervalMonths:1,donorId:d.id})
  await h.command('pledge.create',{donorId:d.id,amount:'90',pledgedOn:day,fund:'Library',installments:[{dueOn:day,amount:'90'}]})
  await h.command('prospect.save',{donorId:other.id,ownerId:owner.id,label:'Reading room renewal',stage:'cultivate',askAmount:'500',expectedCloseOn:day,nextStep:'Review the reading room proposal.'})
  await h.api('/api/coffer/giving/campaigns',{name:'Reading room',slug:'reading-room',description:'Books and quiet space for local readers.',fund:'Library',goal:'60000'})
  const receipt=await h.command('ack.prepare',{giftIds:[original.id]})
  await h.command('ack.approve',{batchId:receipt.id,version:1})
  await h.command('consent.record',{donorIds:[other.id],channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-741',capturedOn:day})
  await h.command('appeal.prepare',{name:'Reading room update',channel:'email'})
  await h.command('solicitation.set',{donorId:d.id,version:0,type:'stop',startsOn:day,source:'person',sourceOn:day})
  const directory=process.env.COFFER_MOBILE_BROWSER??'.cache/mobile'
  await mkdir(directory,{recursive:true})
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage();page.setDefaultTimeout(15000)
   const shot=async name=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits');await page.screenshot({path:join(directory,name+'.png'),fullPage:false})}
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    await page.goto(origin+'/app')
    await shot('today-'+width)
    // Input entry is separate from the counted navigation/commit taps.
    await page.locator('#cf-find').fill('Maya Chen')
    await page.locator('#cf-find').press('Enter')
    await page.waitForURL('**/app/donors?q=Maya+Chen')
    await shot('lookup-'+width)
    await page.getByRole('link',{name:'Maya Chen',exact:true}).click()
    await page.waitForURL('**/app/donors/'+d.id)
    await page.getByRole('heading',{name:'Maya Chen',exact:true}).waitFor()
    const badges=page.getByLabel('Constituent status and restrictions')
    assert.match(await badges.innerText(),/Active/);assert.match(await badges.innerText(),/Do not solicit/)
    assert.ok(await page.locator('#giving-summary').isVisible())
    await shot('donor-'+width)
    for(const kind of ['call','meeting']){
     await page.getByRole('navigation',{name:'Donor actions'}).getByRole('link',{name:'Log a '+kind,exact:true}).click()
     const compose=page.locator('#phone-action')
     await compose.getByLabel('Call or meeting notes',{exact:true}).fill(`${kind} from the literacy fair at ${width}px.`)
     await shot(kind+'-draft-'+width)
     await compose.getByRole('button',{name:'Save '+kind,exact:true}).click()
     await page.locator('#timeline').getByText(`${kind} from the literacy fair at ${width}px.`,{exact:true}).waitFor()
     await page.locator('#timeline').getByText(`${kind} from the literacy fair at ${width}px.`,{exact:true}).scrollIntoViewIfNeeded();await shot(kind+'-saved-'+width)
    }
    await page.getByRole('navigation',{name:'Donor actions'}).getByRole('link',{name:'Record a gift',exact:true}).click()
    const record=page.locator('#record')
    await record.getByLabel('Amount (USD)',{exact:true}).fill('45.25')
    await record.getByLabel('No goods or services',{exact:true}).check()
    await shot('gift-draft-'+width)
    await record.getByRole('button',{name:'Record gift',exact:true}).click()
    await page.waitForURL('**/app/donors/'+d.id)
    assert.equal((await h.get('/api/coffer/donors/'+d.id)).gifts.filter(g=>g.amount_cents===4525).length,width===1440?1:2)
    await shot('gift-saved-'+width)
    await page.getByRole('navigation',{name:'Donor actions'}).getByRole('link',{name:"Today's tasks",exact:true}).click()
    await page.getByRole('heading',{name:'Call list',exact:true}).waitFor();await page.getByRole('heading',{name:'Prepare literacy fair follow-up',exact:true}).waitFor();await shot('tasks-'+width)
    await page.goto(origin+'/app/gifts')
    const icon=page.getByRole('link',{name:width === 390 ? 'Edit Maya Chen’s details' : 'Open Maya Chen’s record'}).first(),tip=icon.getByRole('tooltip')
    await icon.focus();await tip.waitFor({state:'visible'});assert.equal(await tip.innerText(),width === 390 ? 'Edit details' : 'Open donor')
    await shot('tooltip-focus-'+width)
    await icon.blur();await page.mouse.move(0,0);await tip.waitFor({state:'hidden'})
    await icon.hover();await page.waitForTimeout(150);assert.equal(await tip.isVisible(),false)
    await tip.waitFor({state:'visible'});await shot('tooltip-hover-'+width)
   }
   // Follow the actual staff GET navigation, once per screen, including record
   // details discovered from the realistic donor/gift. Downloads aren't screens.
   const queue=['/app'],seen=new Set()
   while(queue.length){
    const target=queue.shift(),key=new URL(target,origin).pathname
    if(seen.has(key))continue
    seen.add(key)
    const response=await page.goto(origin+target)
    assert.equal(response.status(),200,target)
    if(!response.headers()['content-type']?.includes('text/html'))continue
    for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await shot('screen-'+key.replaceAll('/','_')+'-'+width)}
    for(const href of await page.locator('a[href]').evaluateAll(links=>links.map(a=>a.getAttribute('href')))){
     const u=new URL(href,origin)
     if(u.origin===origin&&u.pathname.startsWith('/app')&&!/\.(csv|pdf|zip)$/.test(u.pathname)&&u.pathname!=='/app/backup'&&!seen.has(u.pathname))queue.push(u.pathname+u.search)
    }
   }
   console.log('MOBILE-001 staff screens:',[...seen].sort().join(', '))
  })
 })
}
