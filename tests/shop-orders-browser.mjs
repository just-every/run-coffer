import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function shopOrdersBrowser(h,{id,stage,review,chosen}){
 const directory=process.env.COFFER_SHOP_BROWSER
 if(directory)await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const capture=async name=>{
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   if(directory){
    await page.screenshot({path:directory+'/'+name+'-1440.png',fullPage:true})
    await page.setViewportSize({width:390,height:1000})
    await page.screenshot({path:directory+'/'+name+'-390.png',fullPage:true})
    await page.setViewportSize({width:1440,height:1000})
   }
  }
  try{
   await page.goto(origin+'/app/payouts/shops/'+id)
   await page.getByRole('heading',{name:/Shopify order/}).waitFor()
   if(stage==='review'){
    assert.match(await page.locator('main').innerText(),/No contribution has been recorded/)
    await capture('held-order')
    await page.getByLabel('Donation line',{exact:true}).selectOption(review.donationLineId)
    await page.getByLabel('Source fund',{exact:true}).selectOption(review.fund)
    await page.getByLabel('Source campaign',{exact:true}).selectOption(review.campaign)
    for(const [key,label] of [['contributionFee','Contribution fee allocation'],['noncontributionFee','Noncontribution fee allocation']])await page.getByLabel(label,{exact:true}).fill(review[key])
    await page.getByLabel('Allocation explanation',{exact:true}).fill(review.allocationReason)
    await page.getByRole('checkbox',{name:/I reviewed/}).check()
    await page.getByRole('button',{name:'Review current provider facts',exact:true}).click()
    await page.getByRole('button',{name:'Approve exact contribution',exact:true}).waitFor()
    assert.match(await page.locator('main').innerText(),/\$49\.20/);assert.match(await page.locator('main').innerText(),/not the whole shop payout/)
    await capture('reviewed-order')
    await page.getByRole('link',{name:'Select donor',exact:true}).click()
    await page.getByRole('radio',{name:new RegExp(chosen)}).check()
    await page.getByRole('checkbox',{name:/I confirm/}).check()
    await page.getByRole('button',{name:'Select donor',exact:true}).click()
    await page.getByRole('button',{name:'Refresh candidates and clear selection',exact:true}).waitFor()
    assert.match(await page.locator('main').innerText(),/creates no money or receipt/)
    await capture('approved-donor')
   }else{
    const body=await page.locator('main').innerText()
    assert.match(body,stage==='refunded'?/Contribution refunded/:/Contribution recorded/)
    assert.match(body,/\$25\.00/);assert.match(body,/\$49\.20/)
    await capture(stage)
    if(stage==='reconciled'){await page.goto(origin+'/app/payouts/fees');await page.getByRole('heading',{name:'All recorded transactions',exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/not whole shop payouts/);assert.match(await page.locator('main').innerText(),/\$24\.00/);await capture('qualified-fee-report')}
   }
  }finally{await page.close()}
 })
}
