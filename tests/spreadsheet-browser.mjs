import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function spreadsheetBrowser(h,input,preview) {
 const directory=process.env.COFFER_SPREADSHEET_BROWSER||'.cache/spreadsheet'
 await mkdir(directory,{recursive:true})
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  let result=preview
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/move-in/crm')
   await page.getByRole('link',{name:'Map any spreadsheet',exact:true}).click()
   await fits(page);await page.screenshot({path:directory+'/start-'+width+'.png',fullPage:true})
   await page.locator('input[name=exports]').setInputFiles(input.files.map(f=>({name:f.name,mimeType:'text/csv',buffer:Buffer.from(f.base64,'base64')})))
   await page.getByRole('button',{name:'Map columns',exact:true}).click()
   await page.getByRole('heading',{name:'Map spreadsheet columns',exact:true}).first().waitFor()
   await page.locator('[name=mappingName]').fill(input.spreadsheet.name)
   for(const mapping of input.spreadsheet.columns) {
    const group=page.locator('tr').filter({has:page.locator('input[name=mapColumn][value="'+mapping.column+'"]')})
    await group.locator('select[name=mapField]').selectOption(mapping.field)
   }
   await page.locator('[name=fundTranslations]').fill('Books = Library\nLessons = Tutoring')
   await page.locator('[name=methodTranslations]').fill('Paper = check\nElectronic = bank transfer')
   await page.getByText('Match existing donors',{exact:true}).click()
   await page.locator('[name=matchSource]').first().fill('synthetic-coffer-6001')
   await page.locator('[name=matchTarget]').first().selectOption(JSON.stringify(input.spreadsheet.donorMatches['synthetic-coffer-6001']))
   await page.getByText('Map custom report columns',{exact:true}).click()
   await page.locator('summary').filter({hasText:'GiftCategory'}).click()
   const custom=page.locator('fieldset').filter({has:page.locator('legend',{hasText:'GiftCategory'})})
   await custom.locator('[name=customKey]').fill('source_category');await custom.locator('[name=customLabel]').fill('Source category');await custom.locator('[name=customEntry]').selectOption('pick-one');await custom.locator('[name=customChoices]').fill('Books\nMusic')
   await page.locator('[name=solicitCodes]').fill('No fundraising = stop')
   await fits(page);await page.screenshot({path:directory+'/columns-'+width+'.png',fullPage:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:directory+'/columns-top-'+width+'.png'});await custom.screenshot({path:directory+'/custom-'+width+'.png'})
   await page.getByRole('button',{name:'Preview mapped spreadsheet',exact:true}).click()
   await page.waitForURL('**/app/move-in/crm/review?id=*')
   const id=new URL(page.url()).searchParams.get('id'),{job}=await h.get('/api/coffer/move-in/journal?id='+id)
   assert.equal(job.report.canApply,true,JSON.stringify(job.report));assert.equal(job.report.needsAcceptance,false)
   assert.equal(job.report.sourceTotals.amountCents,135000)
   assert.ok(await page.getByText(/is Ava Native already in Coffer/).count(),'The explicit native match is shown in review')
   await fits(page);await page.screenshot({path:directory+'/review-'+width+'.png',fullPage:true})
   result={...preview,id,fingerprint:job.fingerprint,mappedInput:{...input,spreadsheet:job.report.spreadsheet,customFields:job.report.customFields}}
  }
  await page.locator('[name=acknowledged][value=no]').check()
  await page.getByLabel('Acknowledge from',{exact:true}).fill('2025-01-01')
  await page.locator('[name=confirm]').check()
  const applyForm=page.locator('form[action="/app/move-in/crm/apply"]')
  assert.ok(await applyForm.evaluate(f=>f.checkValidity()),await applyForm.evaluate(f=>[...f.elements].filter(e=>e.validity&&!e.validity.valid).map(e=>e.name+': '+e.validationMessage).join('; ')))
  const [submitted]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/app/move-in/crm/apply')),page.getByRole('button',{name:'Move these records in',exact:true}).click()])
  assert.equal(submitted.status(),303,submitted.status()===303?'':await submitted.text());await page.waitForURL('**/app/move-in/crm/journal?id=*')
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await fits(page);assert.ok(await page.getByText('All totals match',{exact:true}).count());await page.screenshot({path:directory+'/applied-'+width+'.png',fullPage:true})}
  // The saved mapping is reusable through the upload door, without retained source files.
  await page.goto(origin+'/app/move-in/crm/spreadsheet')
  assert.ok(await page.locator('select[name=savedMapping] option').filter({hasText:'Community gifts'}).count())
  await page.locator('[name=savedMapping]').selectOption(result.id)
  await page.locator('input[name=exports]').setInputFiles(input.files.map(f=>({name:f.name,mimeType:'text/csv',buffer:Buffer.from(f.base64,'base64')})))
  await page.getByRole('button',{name:'Map columns',exact:true}).click()
  assert.equal(await page.locator('[name=mappingName]').inputValue(),'Community gifts')
  const fund=page.locator('tr').filter({has:page.locator('input[name=mapColumn][value=Designation]')})
  assert.equal(await fund.locator('[name=mapField]').inputValue(),'fund')
  assert.equal(await page.locator('[name=fundTranslations]').inputValue(),'Books = Library\nLessons = Tutoring')
  assert.equal(await page.locator('[name=solicitCodes]').inputValue(),'No fundraising = stop')
  await page.getByRole('button',{name:'Preview mapped spreadsheet',exact:true}).click();await page.waitForURL('**/app/move-in/crm/review?id=*')
  result.reusedId=new URL(page.url()).searchParams.get('id')
  const reused=(await h.get('/api/coffer/move-in/journal?id='+result.reusedId)).job
  assert.equal(reused.report.canApply,true,JSON.stringify(reused.report));assert.equal(reused.report.sourceTotals.byFund.Library.amountCents,57500)
  await page.close()
  return result
 })
}
async function fits(page) {
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Screen fits the viewport')
 const tiny=await page.locator('label,input,select,textarea,button,p,summary').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&parseFloat(getComputedStyle(n).fontSize)<13).map(n=>n.outerHTML.slice(0,80)))
 assert.deepEqual(tiny,[],'Readable text on touched screens')
 assert.deepEqual(await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!(n.innerText||'').trim()).map(n=>n.outerHTML.slice(0,80))),[],'Controls expose visible text')
}

export async function spreadsheetUndoBrowser(h,id) {
 const directory=process.env.COFFER_SPREADSHEET_BROWSER||'.cache/spreadsheet'
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  await page.goto(origin+'/app/move-in/crm/journal?id='+id)
  await page.getByRole('button',{name:'Undo this move-in',exact:true}).click()
  await page.getByText('Everything this move-in added was removed.',{exact:false}).waitFor()
  assert.equal(await page.locator('form[action="/app/move-in/crm/check"]').count(),0,'An undone import cannot present a live totals recheck')
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await fits(page);await page.screenshot({path:directory+'/undone-'+width+'.png',fullPage:true})}
  await page.close()
 })
}
