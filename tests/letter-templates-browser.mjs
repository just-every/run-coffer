import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function letterTemplatesBrowser(h,{batchId,statementId,directory}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const fits=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/settings#thank-you-templates')
   const section=page.locator('#thank-you-templates')
   await section.getByRole('link',{name:'Published field list'}).click()
   const catalog=JSON.parse(await page.locator('body').innerText())
   assert.ok(catalog.templates.find(t=>t.kind==='recurring_start').fields.includes('email'))
   await page.goBack()
   await section.getByText('Add a template',{exact:true}).click()
   const add=section.locator('details').filter({has:page.locator('summary',{hasText:'Add a template'})}).last().locator('form')
   await add.locator('select[name=kind]').selectOption('recurring_start')
   await add.getByLabel('Template name',{exact:true}).fill('Monthly welcome '+width)
   await add.getByLabel('Subject',{exact:true}).fill('Welcome to monthly giving')
   await add.getByLabel('Letter',{exact:true}).fill('Dear {{donor_name}}, {{amount}} on {{gift_date}}. {{goods_statement}} {{organization}} EIN {{ein}}\nEmail: {{email|No email recorded}}\n{{postal_address|No postal address recorded}}')
   await add.getByRole('button',{name:'Add template',exact:true}).click();await page.waitForURL('**/app/settings?saved=1*')
   const saved=section.locator('li > details').filter({has:page.locator('summary',{hasText:'Monthly welcome '+width})})
   await saved.locator('summary').click();await fits()
   await section.screenshot({path:`${directory}/RCPT-010-templates-${width}.png`})
   await saved.getByRole('button',{name:'Retire template',exact:true}).click();await page.waitForURL('**/app/settings?saved=1*')
   assert.equal(await section.getByText('Monthly welcome '+width).count(),0)
   await page.goto(origin+'/app/letters/'+batchId);await page.getByText('Major gift template v1').first().waitFor();await fits()
   await page.screenshot({path:`${directory}/RCPT-010-letters-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/letters/'+statementId)
   await page.getByText('No email recorded',{exact:false}).first().waitFor();await fits()
   await page.screenshot({path:`${directory}/RCPT-010-defaults-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}


export async function mergeReviewBrowser(h,{batchId,directory,phase}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/letters/'+batchId)
   const review=page.locator('section').filter({has:page.getByRole('heading',{name:'Merge field review',exact:true})})
   if(phase==='blanks') {
    await review.getByRole('link',{name:'Dee Review',exact:true}).waitFor()
    await review.getByRole('link',{name:'Fay Review',exact:true}).waitFor()
    assert.equal(await review.getByRole('link',{name:'Eli Review',exact:true}).count(),0)
    assert.ok((await review.innerText()).includes('{{postal_address}}'))
    await review.getByRole('link',{name:'Dee Review',exact:true}).click()
    await page.waitForURL('**/app/donors/**')
    await page.getByRole('heading',{name:'Dee Review',exact:true}).waitFor()
    await page.goBack()
   } else if(phase==='household') {
    await page.getByText('Household: The Review Family / Review friends / The Review Household',{exact:false}).waitFor()
    await review.getByRole('link',{name:'The Review Family',exact:true}).waitFor()
    assert.equal(await review.locator('code').filter({hasText:'{{household_addressee}}'}).count(),0,'Populated household fields are absent from the blank review')
   } else await review.getByText('No empty merge fields were found in the checked letters.',{exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Review fits the viewport')
   await page.screenshot({path:`${directory}/RCPT-010-merge-review-${phase}-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}

export async function customMergeBrowser(h,{batchId,directory}) {
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/settings#thank-you-templates')
   await page.getByText('Add a template',{exact:true}).click()
   const add=page.locator('#thank-you-templates details').filter({has:page.locator('summary',{hasText:'Add a template'})}).last().locator('form')
   await add.getByLabel('Template name',{exact:true}).fill('Unsaved insertion check')
   await add.getByLabel('Subject',{exact:true}).fill('Hello')
   await add.getByLabel('Letter',{exact:true}).fill('Board: ')
   await add.locator('select[name=fieldKey]').selectOption('custom.board_term')
   await add.getByRole('button',{name:'Insert merge field',exact:true}).click()
   await page.getByRole('heading',{name:'Template draft',exact:true}).waitFor()
   assert.equal(await page.locator('textarea[name=body]').inputValue(),'Board: {{custom.board_term}}')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/RCPT-010-insert-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/letters/'+batchId)
   await page.getByRole('heading',{name:'Merge field review',exact:true}).waitFor()
   assert.ok((await page.locator('main').innerText()).includes('{{custom.call_topic}}'))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/RCPT-010-custom-review-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}

export async function propertyMergeReviewBrowser(h,{donorId,directory}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+donorId+'#in-kind')
  const panel=page.locator('#in-kind');await panel.getByText('Approve property acknowledgment',{exact:true}).first().click();await panel.getByRole('button',{name:'Review merge fields',exact:true}).click()
  await page.getByRole('heading',{name:'Property merge review',exact:true}).waitFor();assert.ok((await page.locator('main').innerText()).includes('custom.stewardship_phrase'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:directory+'/RCPT-010-property-review-'+width+'.png',fullPage:true})
 }await page.close()})
}

export async function interactionMergeBrowser(h,{donorId,interactionId,directory}){
 await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){
  await h.command('gift.record',{donorId,amount:'300',receivedOn:'2025-09-20',method:'check',goods:'none'})
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/letters');const editor=page.locator('form').filter({has:page.locator('input[name=command][value="ack.prepare"]')});await editor.locator('select[name=donorId]').selectOption(donorId);await editor.locator('select[name=interactionId]').selectOption(interactionId);await editor.getByRole('button',{name:/Prepare .* letters/}).click();await page.waitForURL('**/app/letters/**');await page.getByText('Unfilled Later conversation',{exact:false}).first().waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/RCPT-010-interaction-'+width+'.png',fullPage:true})
  }await page.close()})
}

export async function customRecordBrowser(h,{donorId,directory}){
 await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){
  const key='native_note_'+width,label='Native note '+width
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/settings#custom-field-definitions');const definitions=page.locator('#custom-field-definitions');await definitions.getByText('Add a custom field',{exact:true}).click();const add=definitions.locator('form').filter({has:page.locator('input[name=command][value="custom.define"]')}).last();await add.locator('input[name=key]').fill(key);await add.locator('input[name=label]').fill(label);await add.getByRole('button',{name:'Add field',exact:true}).click();await page.waitForURL('**/app/settings?saved=1#custom-field-definitions');assert.ok((await definitions.innerText()).includes(label));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await definitions.screenshot({path:directory+'/DONOR-005-definitions-'+width+'.png'})
  await page.goto(origin+'/app/donors/'+donorId+'#custom-fields');const panel=page.locator('#custom-fields');let detail=panel.locator('details').filter({has:page.locator('summary',{hasText:label})});await detail.locator('summary').click();let edit=detail.locator('form').filter({has:page.locator('input[name=command][value="custom.set"]')});await edit.locator('input[name=value]').fill('Native <board &> '+width);await edit.locator('input[name=source]').fill('synthetic-coffer-1301');await edit.getByRole('button',{name:'Save value',exact:true}).click();await page.waitForURL('**#custom-fields');detail=panel.locator('details').filter({has:page.locator('summary',{hasText:label})});await detail.locator('summary').click();edit=detail.locator('form').filter({has:page.locator('input[name=command][value="custom.set"]')});assert.equal(await edit.locator('input[name=value]').inputValue(),'Native <board &> '+width);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await panel.screenshot({path:directory+'/DONOR-005-value-'+width+'.png'});await detail.getByRole('button',{name:'Clear value',exact:true}).click();await page.waitForURL('**#custom-fields');detail=panel.locator('details').filter({has:page.locator('summary',{hasText:label})});await detail.locator('summary').click();assert.equal(await detail.locator('input[name=value]').inputValue(),'');assert.ok((await detail.locator('summary').innerText()).includes('Not set'))
 }await page.close()})
}
