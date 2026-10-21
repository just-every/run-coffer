import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function pledgeInvoiceBrowser(h,{donorId,pledgeId,directory,phase,total,rows}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/donors/'+donorId)
   const link=page.locator(`#pledges a[href="/app/pledges/${pledgeId}/invoice"]`)
   await link.scrollIntoViewIfNeeded()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/STEW-004-donor-${phase}-${width}.png`,fullPage:true})
   await link.click();await page.waitForURL('**/invoice')
   await page.getByRole('heading',{name:rows.length?'Pledge invoice':'Pledge balance',exact:true}).waitFor()
   assert.equal(await page.locator('main dd').last().innerText(),total)
   assert.deepEqual(await page.locator('tbody tr').evaluateAll(rs=>rs.map(r=>[...r.cells].map(c=>c.textContent))),rows)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Invoice fits the viewport')
   await page.screenshot({path:`${directory}/STEW-004-invoice-${phase}-${width}.png`,fullPage:true})
   await page.emulateMedia({media:'print'})
   assert.equal(await page.locator('.print-help').isVisible(),false)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Printed invoice fits the viewport')
   await page.screenshot({path:`${directory}/STEW-004-print-${phase}-${width}.png`,fullPage:true})
   await page.emulateMedia({media:'screen'})
   await page.getByRole('link',{name:'Back to donor’s pledges'}).click()
   await page.waitForURL('**/donors/'+donorId+'#pledges')
  }
  await page.close()
 })
}
