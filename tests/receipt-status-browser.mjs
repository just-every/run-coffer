import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function receiptStatusBrowser(h,{donorId,giftId,excludedId,advisorId,day,directory}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(`${origin}/app/donors/${donorId}`)
   const gift=page.locator(`#gift-${giftId}`)
   await gift.getByText('Acknowledged',{exact:true}).waitFor()
   await gift.getByText('phone call',{exact:false}).first().waitFor()
   assert.match(await page.locator('#timeline').innerText(),/Acknowledged.*phone call/s)
   await gift.screenshot({path:`${directory}/gift-status-${width}.png`})
   await page.locator('#timeline').screenshot({path:`${directory}/timeline-status-${width}.png`})
   await page.locator(`#gift-${excludedId}`).getByText('Do not acknowledge',{exact:true}).waitFor()
   await page.screenshot({path:`${directory}/donor-status-${width}.png`,fullPage:true})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.goto(`${origin}/app/gifts?gift=${giftId}`)
   await page.locator('#selected-gift-acknowledgment').getByText('Acknowledged',{exact:true}).waitFor()
   await page.locator('#selected-gift-acknowledgment').getByText('Record gift thank-you',{exact:true}).first().click()
   await page.locator('#selected-gift-acknowledgment').getByLabel('Gift thank-you date',{exact:true}).fill(day)
   await page.locator('#selected-gift-acknowledgment').getByLabel('Gift thank-you method',{exact:true}).selectOption('handwritten note')
   await page.locator('#selected-gift-acknowledgment').getByLabel('Gift thank-you note',{exact:true}).fill('A personal thank-you recorded from the gift screen.')
   await page.locator('#selected-gift-acknowledgment').getByRole('button',{name:'Record gift thank-you',exact:true}).click()
   assert.match(page.url(),/\/app\/gifts\?gift=/)
   await page.locator('#selected-gift-acknowledgment').getByText('handwritten note',{exact:false}).first().waitFor()
   await page.locator('#selected-gift-acknowledgment').screenshot({path:`${directory}/selected-gift-status-${width}.png`})
   await page.screenshot({path:`${directory}/gift-screen-status-${width}.png`,fullPage:true})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.goto(`${origin}/app/letters`)
   await page.getByRole('heading',{name:'Soft-credit thank-yous',exact:true}).waitFor()
   await page.getByRole('link',{name:'Alex Grant Advisor',exact:true}).waitFor()
   await page.screenshot({path:`${directory}/queue-status-${width}.png`,fullPage:true})
   await page.goto(`${origin}/app/settings`)
   await page.getByLabel('Thank soft-credited constituents',{exact:true}).selectOption('1')
   await page.screenshot({path:`${directory}/settings-status-${width}.png`,fullPage:true})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.goto(`${origin}/app/donors/${advisorId}`)
   await page.getByText('Soft credit, not a tax receipt',{exact:true}).first().waitFor()
   await page.screenshot({path:`${directory}/soft-credit-status-${width}.png`,fullPage:true})
   // Use the real gift form, then restore the call so both viewports see the same state.
   await page.goto(`${origin}/app/donors/${donorId}`)
   const row=page.locator(`#gift-${giftId}`)
   await row.getByRole('button',{name:'Mark gift not acknowledged',exact:true}).click()
   await page.locator(`#gift-${giftId}`).getByText('Record gift thank-you',{exact:true}).first().click()
   const form=page.locator(`#gift-${giftId} form`).filter({has:page.getByRole('button',{name:'Record gift thank-you',exact:true})})
   await form.getByLabel('Gift thank-you date',{exact:true}).fill(day)
   await form.getByLabel('Gift thank-you method',{exact:true}).selectOption('handwritten note')
   await form.getByLabel('Gift thank-you note',{exact:true}).fill('Thank you for keeping the reading room open.')
   await form.getByRole('button',{name:'Record gift thank-you',exact:true}).click()
   await page.locator(`#gift-${giftId}`).getByText('Acknowledged',{exact:true}).waitFor()
   const history=await h.get(`/api/coffer/donors/${donorId}`),g=history.gifts.find(x=>x.id===giftId),call=history.depth.interactions.find(x=>x.kind==='call')
   await h.command('gift.acknowledge',{giftId,version:g.acknowledgment.version,acknowledgedOn:day,method:'phone call',interactionId:call.id})
  }
 })
}
export async function receiptDeliveryStatusBrowser(h,{donorId,giftId,directory}){
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(`${origin}/app/donors/${donorId}`)
   await page.locator(`#gift-${giftId}`).getByText('Not acknowledged',{exact:true}).waitFor()
   await page.locator(`#gift-${giftId}`).getByText('bounced',{exact:false}).first().waitFor()
   await page.locator(`#gift-${giftId}`).screenshot({path:`${directory}/bounced-status-${width}.png`})
  }
 })
}
