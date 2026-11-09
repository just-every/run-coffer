import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function paymentDonorMatchBrowser(h,chargeId,chosen){
 const proof=process.env.COFFER_PAYMENT_MATCH_BROWSER
 if(proof)await mkdir(proof,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const screenshot=async(name)=>{if(proof)await page.screenshot({path:proof+'/'+name+'.png',fullPage:true})}
  try{
   // Assertions run at one width. Phone captures are the candidate's screen proof.
   await page.goto(origin+'/app/payouts')
   await page.getByRole('link',{name:'Review donor matches'}).click()
   await page.getByRole('heading',{name:'Donor matches',exact:true}).waitFor()
   await screenshot('queue-1440')
   await page.getByRole('link',{name:chargeId,exact:true}).click()
   await page.getByRole('heading',{name:'Review donor match',exact:true}).waitFor()
   assert.match(await page.locator('main').innerText(),/Needs review/)
   await page.getByRole('radio',{name:new RegExp(chosen.name)}).check()
   assert.equal(await page.locator('.candidate-name').first().evaluate(el=>getComputedStyle(el).fontSize),'16px')
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await screenshot('review-1440')
   if(proof){
    await page.setViewportSize({width:390,height:950})
    await screenshot('review-390')
    await page.goto(origin+'/app/payouts/donor-matches')
    await screenshot('queue-390')
    await page.getByRole('link',{name:chargeId,exact:true}).click()
    await page.setViewportSize({width:1440,height:1000})
    await page.getByRole('radio',{name:new RegExp(chosen.name)}).check()
   }
   await page.getByRole('checkbox',{name:/I confirm/}).check()
   await page.getByRole('button',{name:'Approve donor match',exact:true}).click()
   await page.getByRole('heading',{name:'Payment recorded',exact:true}).waitFor()
   assert.match(await page.locator('main').innerText(),new RegExp(chosen.name))
   await screenshot('resolved-1440')
   if(proof){await page.setViewportSize({width:390,height:950});await screenshot('resolved-390')}
  }finally{await page.close()}
 })
}
