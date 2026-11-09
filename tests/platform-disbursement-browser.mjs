import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function platformDisbursementBrowser(h,input){
 const proof=process.env.COFFER_PLATFORM_BROWSER
 if(proof)await mkdir(proof,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const shot=async name=>{if(proof)await page.screenshot({path:proof+'/'+name+'.png',fullPage:true})}
  const capture=async name=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot(name+'-1440');if(proof){await page.setViewportSize({width:390,height:950});await shot(name+'-390');await page.setViewportSize({width:1440,height:1000})}}
  try{
   if(input.payout){
    await page.goto(origin+'/app/payouts/platforms/benevity/'+input.recorded.id)
    await page.getByRole('heading',{name:'Disbursement recorded',exact:true}).waitFor()
    assert.match(await page.locator('main').innerText(),/\$150\.00/);await capture('approved-gifts')
    await page.getByRole('link',{name:'Open reconciled payout',exact:true}).click()
    await page.getByRole('heading',{name:'Payout lines',exact:true}).waitFor()
    assert.match(await page.locator('main').innerText(),/\$145\.55/);await capture('reconciled-payout')
    return
   }
   await page.goto(origin+'/app/payouts/platforms/benevity')
   await page.getByLabel('Disbursement CSV',{exact:true}).setInputFiles({name:'synthetic-coffer-disbursement.csv',mimeType:'text/csv',buffer:Buffer.from(input.upload.csv)})
   await page.getByRole('button',{name:'Read source columns',exact:true}).click()
   await page.getByRole('heading',{name:'Map Benevity columns',exact:true}).waitFor()
   for(const [key,value] of Object.entries(input.upload.mapping))await page.locator('[name="map_'+key+'"]').selectOption(value)
   for(const [key,value] of Object.entries(input.upload.controls))await page.locator('[name="'+key+'"]').fill(value)
   await page.getByRole('button',{name:'Review provenance mapping',exact:true}).click()
   await page.getByRole('heading',{name:'Map source provenance',exact:true}).waitFor()
   for(const kind of ['fund','campaign'])for(let i=0;await page.locator('[name="'+kind+'Source_'+i+'"]').count();i++){const label=await page.locator('[name="'+kind+'Source_'+i+'"]').inputValue();await page.locator('[name="'+kind+'Target_'+i+'"]').selectOption(input.upload[kind+'Map'][label])}
   await page.getByRole('button',{name:'Preview disbursement',exact:true}).click()
   await page.getByRole('heading',{name:'Disbursement preview',exact:true}).waitFor()
   assert.match(await page.locator('main').innerText(),/\$4\.45/);await capture('populated-preview')
   await page.goto(origin+'/app/payouts/donor-matches/'+input.sourceId)
   await page.getByRole('heading',{name:'Benevity source review',exact:true}).waitFor()
   await page.getByRole('radio',{name:new RegExp(input.chosen)}).check()
   await capture('held-donor-review')
   await page.getByRole('checkbox',{name:/I confirm/}).check()
   await page.getByRole('button',{name:'Select donor',exact:true}).click()
   await page.getByRole('heading',{name:'Donor selected',exact:true}).waitFor()
   assert.match(await page.locator('main').innerText(),/No money has been recorded/)
  }finally{await page.close()}
 })
}
