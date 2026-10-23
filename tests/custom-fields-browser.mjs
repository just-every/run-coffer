import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function customFieldsBrowser(h,{donorId,giftId,directory}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/settings#custom-field-definitions')
   const panel=page.locator('#custom-field-definitions'),key='native_board_'+width
   await panel.getByText('Add a custom field',{exact:true}).click()
   const add=panel.locator('form').filter({has:page.locator('input[name=command][value="custom.define"]')}).last()
   await add.getByLabel('Field key (used in templates)',{exact:true}).fill(key)
   await add.getByLabel('Field label',{exact:true}).fill('Native board '+width)
   await add.locator('select[name=entry]').selectOption('pick-one')
   await add.getByLabel('Pick-list choices (one per line; leave blank for free-form)',{exact:true}).fill('Board\nVolunteer')
   await add.getByRole('button',{name:'Add field',exact:true}).click();await page.waitForURL('**#custom-field-definitions')
   await page.goto(origin+'/app/donors/'+donorId+'#custom-fields')
   const custom=page.locator('#custom-fields'),detail=custom.locator('details').filter({has:page.locator('summary',{hasText:'Native board '+width})})
   await detail.locator('summary').click();await detail.locator('select[name=value]').selectOption('Board');await detail.getByRole('button',{name:'Save value',exact:true}).click();await page.waitForURL('**#custom-fields')
   await page.goto(origin+'/app/settings#custom-field-definitions')
   const definition=panel.locator('li > details').filter({has:page.locator('summary',{hasText:'Native board '+width})})
   await definition.locator('summary').click();await definition.getByLabel('New choice',{exact:true}).fill('Trustee');await definition.getByRole('button',{name:'Rename choice',exact:true}).click();await page.waitForURL('**#custom-field-definitions')
   await page.goto(origin+'/app/donors/'+donorId+'#custom-fields');await detail.locator('summary').click();assert.equal(await detail.locator('select[name=value]').inputValue(),'Trustee')
   await fits(page,width);await custom.screenshot({path:directory+'/DONOR-005-renamed-record-'+width+'.png'})
   await page.goto(origin+'/app/donors/'+donorId+'#record')
   const manual=page.locator('#record form')
   await manual.getByLabel('Amount (USD)',{exact:true}).fill('3.25');await manual.getByLabel('Received on',{exact:true}).fill('2025-03-01');await manual.locator('select[name=method]').selectOption('check');await manual.getByLabel('Check number or reference',{exact:true}).fill('synthetic-coffer-'+(width+10));await manual.getByLabel('No goods or services',{exact:true}).check();await manual.getByText('Custom gift fields',{exact:true}).click();await manual.getByLabel('budget',{exact:true}).fill('200.75')
   await fits(page,width);await manual.screenshot({path:directory+'/DONOR-005-manual-gift-'+width+'.png'})
   await manual.getByRole('button',{name:'Record gift',exact:true}).click();await page.waitForURL('**/app/donors/'+donorId)
   const recorded=await h.get('/api/coffer/donors/'+donorId),nativeGift=recorded.gifts.find(g=>g.reference==='synthetic-coffer-'+(width+10))
   assert.ok(nativeGift,'Native gift entry writes its actual ledger gift');assert.equal(JSON.parse(recorded.customValues.find(v=>v.record_id===nativeGift.id&&v.field_key==='budget').value),'20075')
   await page.locator('#gift-'+nativeGift.id).screenshot({path:directory+'/DONOR-005-manual-gift-saved-'+width+'.png'})
   await page.goto(origin+'/app/more');await fits(page,width);await page.screenshot({path:directory+'/DONOR-005-more-'+width+'.png',fullPage:true});await page.locator('a[href="/app/reports/custom-fields"]').click();await page.waitForURL('**/app/reports/custom-fields')
   await page.goto(origin+'/app/reports/custom-fields?field=budget')
   await page.getByRole('heading',{name:'Grouped contributions',exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/\$100\.25/);await fits(page,width);await page.screenshot({path:directory+'/DONOR-005-report-'+width+'.png',fullPage:true})
   await page.goto(origin+'/app/gifts/batches')
   const start=page.locator('form').filter({has:page.locator('input[name=command][value="giftBatch.create"]')})
   await start.getByLabel('Batch name',{exact:true}).fill('Library checks '+width);await start.getByLabel('Received on',{exact:true}).fill('2025-03-01');await start.getByLabel('Expected deposit total (USD)',{exact:true}).fill('12.50');await start.getByRole('button',{name:'Start batch',exact:true}).click();await page.waitForURL('**/app/gifts/batches?id=*')
   const base=page.url();await page.goto(base+'&donor='+donorId)
   const entry=page.locator('form').filter({has:page.locator('input[name=command][value="giftBatch.add"]')})
   await entry.getByLabel('Gift amount (USD)',{exact:true}).fill('12.50');await entry.getByLabel('Check number',{exact:true}).fill('synthetic-coffer-'+width);await entry.getByText('Custom gift fields',{exact:true}).click();await entry.getByLabel('budget',{exact:true}).fill('200.75');await entry.getByRole('button',{name:'Add gift',exact:true}).click();await page.waitForURL('**/app/gifts/batches?id=*')
   await page.getByRole('button',{name:'Close batch',exact:true}).click();await page.waitForURL('**/app/gifts/batches?id=*');await page.getByText('Closed deposit',{exact:false}).first().waitFor();await fits(page,width);await page.screenshot({path:directory+'/DONOR-005-batch-'+width+'.png',fullPage:true})
   await page.goto(origin+'/app/reports/custom-fields?field=budget');assert.match(await page.locator('main').innerText(),/\$200\.75/)
   await page.goto(origin+'/app/settings#custom-field-definitions');await panel.getByText('Tags and categories',{exact:true}).click();await fits(page,width);await panel.screenshot({path:directory+'/DONOR-005-definitions-'+width+'.png'})
  }
  await page.close()
 })
}
async function fits(page,width){
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Screen fits '+width)
 // Native file/date inputs supply browser text. Audit the authored controls.
 const icons=await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!(n.innerText||'').trim()).map(n=>n.outerHTML.slice(0,300)))
 assert.deepEqual(icons,[],'These screens give authored controls visible text')
}
