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
  await h.command('gift.record',{donorId:d.id,amount:'250',receivedOn:day,goods:'none',method:'check'})
  await h.command('solicitation.set',{donorId:d.id,version:0,type:'stop',startsOn:day,source:'person',sourceOn:day})
  const directory=process.env.COFFER_MOBILE_BROWSER??'.cache/mobile'
  await mkdir(directory,{recursive:true})
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage();page.setDefaultTimeout(15000)
   const shot=async name=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits');await page.screenshot({path:join(directory,name+'.png'),fullPage:true})}
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
     await shot(kind+'-saved-'+width)
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
    await page.getByRole('heading',{name:'Call list',exact:true}).waitFor();await shot('tasks-'+width)
    await page.goto(origin+'/app/gifts')
    const icon=page.getByRole('link',{name:'Open Maya Chen’s record'}).first(),tip=icon.getByRole('tooltip')
    await icon.focus();await tip.waitFor({state:'visible'});assert.equal(await tip.innerText(),'Open donor')
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
