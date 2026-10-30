import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function paymentDonorMatchBrowser(h,chargeId,chosen,{resolve=false}={}){
 const proof=process.env.COFFER_PAYMENT_MATCH_BROWSER
 if(proof)await mkdir(proof,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  try{
   // Assertions run at one width. The phone pass is the candidate's screen proof.
   await page.goto(origin+'/app/payouts')
   await page.getByRole('link',{name:'Review donor matches'}).click()
   await page.getByRole('heading',{name:'Donor matches',exact:true}).waitFor()
   await page.getByRole('link',{name:chargeId,exact:true}).click()
   await page.getByRole('heading',{name:'Review donor match',exact:true}).waitFor()
   assert.match(await page.locator('main').innerText(),/Needs review/)
   await page.getByRole('radio',{name:new RegExp(chosen.name)}).check()
   if(proof)await page.screenshot({path:proof+'/review-1440.png',fullPage:true})
   if(resolve){
    await page.getByRole('checkbox',{name:/I confirm/}).check()
    await page.getByRole('button',{name:'Approve donor match',exact:true}).click()
    await page.getByRole('heading',{name:'Payment recorded',exact:true}).waitFor()
    assert.match(await page.locator('main').innerText(),new RegExp(chosen.name))
    if(proof)await page.screenshot({path:proof+'/resolved-1440.png',fullPage:true})
   }
   if(proof){
    await page.setViewportSize({width:390,height:950})
    await page.goto(origin+'/app/payouts/donor-matches')
    await page.screenshot({path:proof+'/queue-390.png',fullPage:true})
    await page.getByRole('link',{name:chargeId,exact:true}).click()
    await page.screenshot({path:proof+'/review-390.png',fullPage:true})
   }
  }finally{await page.close()}
 })
}
