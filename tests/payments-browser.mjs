// Optional visual leg of FIN-004's real Worker HTTP journey.
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function paymentsBrowser(h,{from,to,directory='.cache/fin-004'}={}) {
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();await mkdir(directory,{recursive:true})
  await page.goto(origin+'/app/payouts')
  await page.getByLabel('From',{exact:true}).fill(from);await page.getByLabel('To',{exact:true}).fill(to)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/FIN-004-payouts-${width}.png`,fullPage:true})
   for(const [format,extension] of [['csv','csv'],['iif','iif']]){
    await page.getByLabel('Journal format').selectOption(format)
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download period journal',exact:true}).click()
    const download=await pending;assert.equal(await download.failure(),null)
    assert.ok(download.suggestedFilename().endsWith('.'+extension));await download.saveAs(`${directory}/FIN-004-${width}.${extension}`)
   }
  }
  console.log('FIN-004 browser: period CSV and IIF downloaded at 1440 and 390')
 })
}
