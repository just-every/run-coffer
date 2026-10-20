import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {donor} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function receiptDeliveryBrowser(h,{providerEvent,openedDonor,directory}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const fits=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   const supporter=await donor(h,'Nora Receipt '+width,{email:`nora.receipt.${width}@example.test`})
   const gift=await h.command('gift.record',{donorId:supporter.id,amount:'350',receivedOn:'2026-09-15',method:'check',goods:'none'})
   const batch=await h.command('ack.prepare',{giftIds:[gift.id]})
   await h.command('ack.approve',{batchId:batch.id,version:batch.version})
   await h.command('ack.send',{batchId:batch.id,version:2})
   const letter=(await h.get(`/api/coffer/letters/${batch.id}`)).letters[0]
   assert.equal((await providerEvent(h,letter,'bounce','browser-bounce-'+width)).status,200)
   await page.goto(origin+'/app/letters')
   await page.getByRole('heading',{name:'Receipt address follow-up',exact:true}).waitFor();await fits()
   await page.getByRole('heading',{name:'Receipt address follow-up',exact:true}).locator('..').screenshot({path:`${directory}/RCPT-006-queue-${width}.png`})
   await page.goto(origin+'/app/donors/'+supporter.id)
   const tasks=page.getByRole('heading',{name:'Receipt address follow-up',exact:true}).locator('..')
   await tasks.getByText('Fix email address',{exact:true}).waitFor();await fits()
   await tasks.screenshot({path:`${directory}/RCPT-006-bounce-${width}.png`})
   await tasks.getByRole('link',{name:'Print this document',exact:true}).click()
   await page.getByText('Nora Receipt '+width,{exact:false}).first().waitFor()
   await page.screenshot({path:`${directory}/RCPT-006-print-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/donors/'+supporter.id)
   await tasks.getByLabel('How the address was checked',{exact:true}).fill('Spoke with Nora; checked the email address. Printed this receipt for postal delivery.')
   await tasks.getByRole('button',{name:'Complete address task',exact:true}).click()
   await tasks.getByText('Address task completed',{exact:true}).waitFor();await fits()
   await tasks.screenshot({path:`${directory}/RCPT-006-completed-${width}.png`})
   await page.goto(origin+'/app/donors/'+openedDonor.id+'?timelineKind=receipt')
   await page.locator('#timeline').getByText('SendGrid provider-reported open',{exact:true}).first().waitFor();await fits()
   await page.locator('#timeline').screenshot({path:`${directory}/RCPT-006-timeline-${width}.png`})
   await page.locator('#engagement').screenshot({path:`${directory}/RCPT-006-factors-${width}.png`})
   await page.goto(origin+'/app/engagement')
   await page.getByLabel('Provider-reported opens weight',{exact:true}).fill('25')
   await page.getByLabel('Recency weight',{exact:true}).fill('75')
   for(const label of ['Giving frequency','Giving amount','Conversations','Volunteering'])await page.getByLabel(label+' weight',{exact:true}).fill('0')
   await fits();await page.getByRole('button',{name:'Save score weights',exact:true}).click()
   await page.waitForURL('**/app/engagement');await fits()
   await page.screenshot({path:`${directory}/RCPT-006-weights-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}
