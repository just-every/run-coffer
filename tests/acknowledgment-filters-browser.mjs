import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function acknowledgmentFiltersBrowser(h,{saved,call,phone,g300,g600,directory}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const capture=async(name,width)=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits '+width)
   await page.evaluate(()=>scrollTo(0,0))
   await page.screenshot({path:`${directory}/${name}-${width}.png`,fullPage:true})
  }
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   const opened=await page.goto(origin+'/app/exports?type=gifts')
   assert.equal(opened.status(),200)
   await page.screenshot({path:`${directory}/initial-list-${width}.png`,fullPage:true})
   const filter=page.locator('form').filter({has:page.getByRole('button',{name:'Apply list filters',exact:true})})
   await filter.getByLabel('Acknowledgment status',{exact:true}).selectOption('not acknowledged')
   await filter.getByLabel('Gift over (USD)',{exact:true}).fill('250')
   await filter.getByRole('button',{name:'Apply list filters',exact:true}).click()
   const matches=page.locator('section').filter({has:page.getByRole('heading',{name:'Matching gifts',exact:true})})
   await matches.locator(`a[href$="#gift-${g300.id}"]`).waitFor()
   assert.deepEqual((await matches.locator('li a').evaluateAll(links=>links.map(link=>link.hash.slice(6)))).sort(),[g300.id,g600.id].sort())
   await capture('list-filters',width)
   await page.goto(origin+'/app/exports?type=gifts&list=saved:'+saved.id)
   await page.getByRole('heading',{name:'Matching gifts',exact:true}).waitFor();await capture('saved-gifts',width)
   await page.goto(origin+'/app/exports?type=gifts&ackStatus=not%20acknowledged&giftOver=10000')
   const emptyGifts=page.locator('section').filter({has:page.getByRole('heading',{name:'Matching gifts',exact:true})})
   await emptyGifts.locator('.empty').waitFor()
   assert.equal(await emptyGifts.locator('li').count(),0)
   await capture('empty-list',width)
   const routes=[['fund','/app/funds?fund=Literacy'],['custom','/app/reports/custom-fields?field=ack_project'],['state','/app/reports/states?year=2025'],['attribution','/app/gifts/attribution?from=2025-01-01&to=2025-12-31'],['honor-roll','/app/reports/honor-roll?from=2025-01-01&through=2025-12-31'],['dashboard','/app/reports/dashboard?year=2025'],['gifts','/app/gifts']]
   for(const [name,path] of routes){
    await page.goto(origin+path)
    if(name==='gifts')await page.getByText('Filter gift thank-yous',{exact:true}).click()
    const status=page.getByLabel('Acknowledgment status',{exact:true})
    await status.selectOption('acknowledged')
    await page.getByLabel('Thank-you from',{exact:true}).fill('2025-08-03')
    await page.getByLabel('Thank-you through',{exact:true}).fill('2025-08-03')
    await page.getByLabel('Thank-you method',{exact:true}).selectOption('phone call')
    await page.getByLabel('Linked acknowledgment record',{exact:true}).fill(call.id)
    const form=status.locator('xpath=ancestor::form')
    await form.getByRole('button').first().click()
    assert.equal(new URL(page.url()).searchParams.get('ackLink'),call.id)
    if(name==='fund')assert.equal(new URL(page.url()).searchParams.get('fund'),'Literacy')
    await page.getByLabel('Acknowledgment status',{exact:true}).waitFor({state:'attached'})
    await page.getByText('$400.00',{exact:true}).first().waitFor()
    if(name==='gifts'){
     await page.getByText('Filter gift thank-yous',{exact:true}).click()
     assert.equal(await page.locator('.cf-ledger-body tbody tr').count(),1)
     assert.equal(new URL(await page.locator('.cf-ledger-body tbody tr a').first().getAttribute('href'),origin).searchParams.get('gift'),phone.id)
     await page.locator('.cf-ledger-body tbody tr a').first().click()
     assert.equal(new URL(page.url()).searchParams.get('ackLink'),call.id,'Opening the matching gift keeps its filters')
     await page.getByText('Filter gift thank-yous',{exact:true}).click()
     const tips=page.locator('.cf-tip:visible')
     assert.ok(await tips.count()>0)
     for(let i=0;i<await tips.count();i++){
      const tip=tips.nth(i);await tip.hover();await tip.getByRole('tooltip').waitFor({state:'visible'})
      await page.mouse.move(0,0);await page.keyboard.press('Tab');await tip.focus()
      assert.ok(await tip.evaluate(node=>node.matches(':focus-visible')))
      await tip.getByRole('tooltip').waitFor({state:'visible'})
     }
     const open=tips.first();await open.focus()
     await open.getByRole('tooltip').waitFor({state:'visible'})
     await page.screenshot({path:`${directory}/gift-tooltip-${width}.png`})
    }
    await capture(name+'-filters',width)
    await page.getByLabel('Linked acknowledgment record',{exact:true}).fill('synthetic-coffer-no-link')
    await page.getByLabel('Acknowledgment status',{exact:true}).locator('xpath=ancestor::form').getByRole('button').first().click()
    assert.equal(await page.getByText('$400.00',{exact:true}).count(),0,'No selected gift remains after a mismatched link')
    if(name==='dashboard')assert.equal(await page.locator('.stats .stat strong').first().innerText(),'$0.00')
    else await page.locator('.empty').first().waitFor()
    await capture(name+'-empty',width)
   }
  }
  await page.close()
 })
}
