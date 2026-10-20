import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function paymentAdjustmentsBrowser(h,{directory,stage,gifts=[]}) {
 await mkdir(directory,{recursive:true})
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const [index,width] of [1440,390].entries()){
   await page.setViewportSize({width,height:1000})
   const response=await page.goto(origin+'/app/payouts/adjustments')
   assert.equal(response.status(),200)
   if(stage==='empty'){
    await page.goto(origin+'/app/payouts')
    await page.getByRole('link',{name:'Refunds and disputes',exact:true}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`${directory}/PAY-003-payouts-${width}.png`,fullPage:true})
    await page.getByRole('link',{name:'Refunds and disputes',exact:true}).click()
   }
   if(gifts.length){
    const form=page.locator('form').filter({has:page.locator(`input[name="giftId"][value="${gifts[index].gift.id}"]`)})
    await form.getByLabel('Amount (USD)',{exact:true}).fill('25.00')
    await form.getByRole('button',{name:'Refund through Stripe',exact:true}).click()
    await page.waitForURL('**/app/payouts/adjustments*')
    const row=(await h.get('/api/coffer/payments/adjustments')).refunds.find(r=>r.gift_id===gifts[index].gift.id)
    assert.ok(row,'The native form reaches the real refund endpoint');assert.equal(row.status,'pending')
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Adjustments fit the viewport')
   await page.screenshot({path:`${directory}/PAY-003-${stage}-${width}.png`,fullPage:true})
  }
 })
}
