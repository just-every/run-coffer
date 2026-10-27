import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from '../browser-worker.mjs'

export async function quickbooksBrowser(h,{payoutId,batchId,phase='posted'}){
 const directory=process.env.COFFER_FIN001_EVIDENCE??'.cache/quickbooks'
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  // Push Verify exercises the native settings, read-only and posted screens.
  // A landing also records the same screens on the phone.
  for(const width of process.env.COFFER_FIN001_EVIDENCE?[1440,390]:[1440]){
   await page.setViewportSize({width,height:1000})
   const screens=phase==='connect'?[['connect','/app/settings/quickbooks','Authorize your company']]:phase==='review'?[['settings','/app/settings','QuickBooks accounting settings'],['connection','/app/settings/quickbooks','Connected to company'],['payout','/app/payouts/'+payoutId,'QuickBooks Online'],['check-batch','/app/payouts/batches/'+batchId,'QuickBooks Online'],['review-payout','/app/payouts/quickbooks/payout/'+payoutId,'I authorize this exact deposit'],['review-checks','/app/payouts/quickbooks/batch/'+batchId,'I authorize this exact deposit']]:phase==='failed'?[['failed-payout','/app/payouts/quickbooks/payout/'+payoutId,'6210']]:[['payouts','/app/payouts','Imported payouts'],['payout-confirmed','/app/payouts/'+payoutId,'QuickBooks Online'],['checks-confirmed','/app/payouts/batches/'+batchId,'QuickBooks Online'],['posted-payout','/app/payouts/quickbooks/payout/'+payoutId,'Posted in QuickBooks'],['posted-checks','/app/payouts/quickbooks/batch/'+batchId,'Posted in QuickBooks']]
   for(const [name,path,expected] of screens){
    await page.goto(origin+path);await page.getByText(expected,{exact:false}).first().waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No overflow at '+width+' on '+name)
    await page.screenshot({path:`${directory}/${name}-${width}.png`,fullPage:name!=='settings'})
   }
   if(phase==='posted'){
    await page.goto(origin+'/app/payouts')
    assert.equal((await page.getByLabel('Imported payout totals').locator('dd').last().innerText()).split('\n')[0],'1')
    assert.match(await page.getByRole('row').filter({hasText:payoutId}).innerText(),/QuickBooks.*Posted/s)
   }
   if(phase==='review'){
   await page.goto(origin+'/app/settings/quickbooks')
   assert.equal(await page.getByLabel('Checking account',{exact:true}).inputValue(),'checking')
   assert.equal(await page.getByLabel('Income account for Housing').inputValue(),'housing')
   assert.equal(await page.getByLabel('Class for Meals').inputValue(),'meals-class')
   await page.getByRole('button',{name:'Save account mappings'}).click()
   await page.getByText('Connected to company',{exact:false}).waitFor()
   }
  }
  await page.close()
 })
}

export async function postCheckInBrowser(h,batchId){
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  await page.goto(origin+'/app/payouts/quickbooks/batch/'+batchId)
  await page.getByRole('checkbox',{name:'I authorize this exact deposit and its separate adjustment entries.'}).check()
  await page.getByRole('button',{name:'Post to QuickBooks',exact:true}).click()
  await page.getByText('Posted in QuickBooks.',{exact:false}).waitFor()
  await page.close()
 })
}
