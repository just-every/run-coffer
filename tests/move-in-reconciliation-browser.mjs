import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

/** The existing native review, apply and recheck doors run in push Verify. */
export async function reconciliationBrowser(h,{preview,input,phase='apply'}) {
 const directory=process.env.COFFER_RECONCILIATION_SHOTS
 if(directory)await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const proof=async name=>{
   if(!directory)return
   await page.screenshot({path:directory+'/'+name+'-1440.png',fullPage:true})
   await page.setViewportSize({width:390,height:1000})
   await page.screenshot({path:directory+'/'+name+'-390.png',fullPage:true})
   await page.setViewportSize({width:1440,height:1000})
  }
  if(phase==='apply'){
   await page.goto(origin+'/app/move-in/crm')
   const form=page.locator('form').filter({has:page.getByRole('button',{name:'Preview exports',exact:true})})
   await form.getByLabel('Moving from').selectOption(input.source)
   await form.getByText('Map organization-specific communication codes',{exact:true}).click()
   await form.getByLabel('Code meanings').fill('Do Not Solicit = stop')
   await form.locator('input[type=file]').setInputFiles(input.files.map(f=>({name:f.name,mimeType:'text/csv',buffer:Buffer.from(f.base64,'base64')})))
   await form.getByRole('button',{name:'Preview exports',exact:true}).click()
   await page.waitForURL('**/app/move-in/crm/review?id=*')
   assert.equal(new URL(page.url()).searchParams.get('id'),preview.id)
   assert.equal(await page.getByRole('heading',{name:'Independent source report controls',exact:true}).count(),1)
   const tables=page.locator('.crm-totals')
   assert.equal(await tables.count(),2)
   const source=await tables.nth(1).innerText()
   assert.match(source,/soft-credit acknowledgment · acknowledged/)
   assert.match(source,/goods · all/);assert.match(source,/\$60\.00/)
   assert.match(source,/tribute source group · Memorial source/)
   assert.equal(await tables.nth(1).getByText('Difference',{exact:true}).count(),0)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await proof('reconciliation-review')
   await page.locator('input[name=acknowledged][value=no]').check()
   await page.getByLabel('Acknowledge from',{exact:true}).fill('2025-01-01')
   await page.locator('input[name=confirm]').check()
   await page.getByRole('button',{name:'Move these records in',exact:true}).click()
   await page.waitForURL('**/app/move-in/crm/journal?id=*')
   assert.match(await page.innerText('body'),/All totals match/)
   await proof('reconciliation-imported')
  }else{
   await page.goto(origin+'/app/move-in/crm/journal?id='+preview.id)
   await page.getByRole('button',{name:'Check totals again',exact:true}).click()
   await page.waitForURL('**/app/move-in/crm/journal?id=*')
   assert.match(await page.innerText('body'),/Totals differ/)
   const row=page.locator('.crm-totals').nth(1).locator('tr').filter({has:page.getByText('tribute source group · Memorial source',{exact:true})})
   assert.match(await row.innerText(),/\$750\.00/);assert.match(await row.innerText(),/\$250\.00/);assert.match(await row.innerText(),/Difference/)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await proof('reconciliation-native-differences')
  }
  await page.close()
 })
}
