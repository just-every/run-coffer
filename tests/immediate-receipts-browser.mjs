import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { withBrowserWorker } from './browser-worker.mjs'

/** Native settings and actual frozen receipt screens, including phone layout. */
export async function immediateReceiptsBrowser(h,{state,phase,batchId,enableOffline=false}) {
 const directory=process.env.COFFER_IMMEDIATE_RECEIPT_BROWSER??'.cache/immediate-receipts'
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  if(enableOffline) {
   await page.goto(origin+'/app/settings')
   await page.getByLabel('Offline batch receipts').selectOption('1')
   await page.getByRole('button',{name:'Save settings',exact:true}).click()
   await page.waitForURL('**/app/settings?saved=1')
  }
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1800})
   await page.goto(origin+'/app/settings#sending-domain')
   const panel=page.locator('#sending-domain')
   assert.ok(await panel.isVisible())
   if(phase==='unverified')assert.match(await panel.innerText(),/Waiting for SPF and DKIM/)
   else assert.match(await panel.innerText(),/Verified for automatic receipts/)
   assert.equal(await page.getByLabel('Offline batch receipts').inputValue(),phase==='verified'?'1':'0')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Settings fit the viewport')
   await panel.evaluate(element=>element.scrollIntoView({block:'center'}))
   await panel.screenshot({path:`${directory}/RCPT-001-domain-${phase}-${width}.png`})
   await page.setViewportSize({width,height:1000})
   await page.getByLabel('Offline batch receipts').scrollIntoViewIfNeeded()
   await page.screenshot({path:`${directory}/RCPT-001-offline-${phase}-${width}.png`})
   if(batchId) {
    await page.goto(origin+'/app/letters/'+batchId)
    assert.match(await page.locator('main').innerText(),/\$50\.00/)
    assert.match(await page.locator('main').innerText(),/No goods or services/)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Receipt fits the viewport')
    const controls=page.locator('a[aria-label],button[aria-label]')
    for(const control of await controls.all())if(!(await control.innerText()).trim())assert.ok(await control.getAttribute('data-tooltip')||await control.getAttribute('title'),'Icon controls explain their action')
    await page.screenshot({path:`${directory}/RCPT-001-receipt-${width}.png`,fullPage:true})
   }
  }
   if(phase==='unverified') {
    state.dns=true
    await page.locator('#sending-domain').getByRole('button',{name:'Check SPF and DKIM',exact:true}).click()
    await page.waitForURL('**/app/settings#sending-domain')
    assert.match(await page.locator('#sending-domain').innerText(),/Verified for automatic receipts/)
   }

 })
}
