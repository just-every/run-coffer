import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function customImportBrowser(h,input,preview,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/move-in/crm')
   await page.getByText('Map custom report columns',{exact:true}).click()
   await fits(page,width);await page.screenshot({path:directory+'/DONOR-005-import-start-'+width+'.png',fullPage:true})
   await page.goto(origin+'/app/move-in/crm/review?id='+preview.id)
   await page.getByText('Map custom report columns',{exact:true}).click()
   const form=page.locator('form[action="/app/move-in/crm/preview"]')
   const membership=form.locator('fieldset').filter({has:page.locator('legend',{hasText:'Custom membership'})})
   assert.ok(await membership.locator('select[name=customExisting]').inputValue(),'An existing field remains selected')
   assert.equal(await form.locator('input[name=customKey][value="import_gift_usd"]').count(),1,'New field mappings survive review')
   await form.locator('input[name=exports]').setInputFiles(input.files.map(f=>({name:f.name,mimeType:'text/csv',buffer:Buffer.from(f.base64,'base64')})))
   await fits(page,width);await membership.screenshot({path:directory+'/DONOR-005-import-existing-mapping-'+width+'.png'});await form.locator('fieldset').filter({has:page.locator('legend',{hasText:'Custom gift USD'})}).screenshot({path:directory+'/DONOR-005-import-new-mapping-'+width+'.png'})
   await form.getByRole('button',{name:'Check the files again',exact:true}).click()
   await page.waitForURL('**/app/move-in/crm/review?id=*')
   const id=new URL(page.url()).searchParams.get('id'),{job}=await h.get('/api/coffer/move-in/journal?id='+id)
   assert.equal(job.fingerprint,preview.fingerprint,'Native mapping re-preview preserves the reviewed data')
   preview.id=id
   await page.getByRole('heading',{name:'Reviewed custom fields',exact:true}).waitFor()
   await fits(page,width);await page.getByRole('heading',{name:'Reviewed custom fields',exact:true}).locator('..').screenshot({path:directory+'/DONOR-005-import-reviewed-'+width+'.png'})
  }
  await page.close()
 })
}
async function fits(page,width){
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Import screen fits '+width)
 assert.deepEqual(await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!(n.innerText||'').trim()).map(n=>n.outerHTML.slice(0,200))),[],'Authored controls have visible text')
}

export async function sourceCustomBrowser(h,id,directory,{applied=false,topic=true,noteTags=false,textResolution}={}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/move-in/crm/journal?id='+id)
   await page.getByRole('link',{name:'Review source custom fields',exact:true}).click()
   await page.getByRole('heading',{name:'Source custom field review',exact:true}).waitFor()
   if(textResolution&&width===1440){
    for(const text of ['2026','true','null','Volunteer']){
     const waiting=page.locator('fieldset').filter({has:page.locator('legend',{hasText:textResolution.field+' · source record '+textResolution.record})})
     await waiting.locator('[name=resolutionAction]').selectOption('map')
     await waiting.locator('[name=replacementValue]').fill(text)
     await page.getByRole('button',{name:'Review these choices',exact:true}).click()
     await page.waitForURL('**/app/move-in/crm/custom-review?id=*')
     const {review}=await h.get('/api/coffer/move-in/custom-review?id='+id),value=review.values.find(v=>v.id===textResolution.valueId)
     assert.equal(value.state,'ready','Native text mapping accepts '+text+' exactly as entered')
     assert.equal(JSON.parse(value.value),text)
     assert.equal(value.original,'Unlisted','The original invalid source choice remains available')
     if(text!=='Volunteer'){
      const reset=await h.api('/api/coffer/move-in/custom-review',{id,version:review.version,mappings:review.mappings,resolutions:review.resolutions.filter(r=>r.id!==textResolution.valueId)})
      assert.equal(reset.review.values.find(v=>v.id===textResolution.valueId).state,'waiting')
      await page.reload()
     }
    }
   }
   const membership=page.locator('fieldset').filter({has:page.locator('legend',{hasText:'Membership · constituent'})})
   assert.equal(await membership.locator('[name=targetKey]').inputValue(),'existing_membership')
   if(!applied&&noteTags&&width===1440){const note=page.locator('fieldset').filter({has:page.locator('legend',{hasText:'Note circle · note'})});await note.locator('[name=mappingAction]').selectOption('tags')}
   await fits(page,width)
   assert.deepEqual(await page.locator('main :is(p,label,legend,button,select,input)').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&parseFloat(getComputedStyle(n).fontSize)<13).map(n=>n.tagName)),[],'Review text is at least 13px')
   await page.screenshot({path:directory+'/MOVE-010-'+(applied?'carried':'review')+'-'+width+'.png',fullPage:true})
   if(!applied){
    if(topic){const topicField=page.locator('fieldset').filter({has:page.locator('legend',{hasText:'Topic · interaction'})});await topicField.locator('[name=targetLabel]').fill('Imported visit topic')}
    await page.getByRole('button',{name:'Review these choices',exact:true}).click()
    await page.waitForURL('**/app/move-in/crm/custom-review?id=*')
    await page.getByRole('heading',{name:'Values waiting for review',exact:true}).waitFor()
   }
  }
  await page.close()
 })
}

export async function sourceCaptureBrowser(h,id,directory,apiKey='synthetic-coffer-1600',{subscriptionKey,idType,organizationId,tokenLabel='Source API key'}={}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/move-in/crm/journal?id='+id)
   await page.getByText('Read custom field definitions and values',{exact:true}).click()
   await page.getByLabel(tokenLabel,{exact:true}).fill(apiKey)
   if(organizationId)await page.getByLabel('Neon organization ID',{exact:true}).fill(organizationId)
   if(subscriptionKey)await page.getByLabel('Blackbaud subscription key',{exact:true}).fill(subscriptionKey)
   if(idType)await page.locator('select[name=idType]').selectOption(idType)
   await fits(page,width)
   await page.screenshot({path:directory+'/MOVE-010-source-read-'+width+'.png',fullPage:true})
  }
  const responsePending=page.waitForResponse(r=>new URL(r.url()).pathname==='/app/move-in/crm/custom-capture'&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Read source custom fields',exact:true}).click()
  const response=await responsePending;assert.equal(response.status(),303,response.status()===303?'':(await response.text()).match(/<p role="alert"[^>]*>([^<]+)/)?.[1]??'Source read failed')
  await page.waitForURL('**/app/move-in/crm/custom-review?id=*')
  await page.getByRole('heading',{name:'Source custom field review',exact:true}).waitFor()
  await page.close()
 })
}

export async function spreadsheetImportBrowser(h,input,directory){
 await mkdir(directory,{recursive:true})
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage(),files=input.files.map(f=>({name:f.name,mimeType:'text/csv',buffer:Buffer.from(f.base64,'base64')}))
  await page.goto(origin+'/app/move-in/crm')
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await fits(page,width)
   await page.screenshot({path:directory+'/MOVE-010-crm-start-'+width+'.png',fullPage:true})
  }
  await page.getByRole('link',{name:'Map any spreadsheet',exact:true}).click()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.locator('input[name=exports]').setInputFiles(files)
   await fits(page,width)
   await page.screenshot({path:directory+'/MOVE-010-spreadsheet-start-'+width+'.png',fullPage:true})
  }
  await page.getByRole('button',{name:'Map columns',exact:true}).click()
  await page.getByLabel('Mapping name',{exact:true}).fill('Typed custom source review')
  const form=page.locator('form[action="/app/move-in/crm/preview"]')
  await page.getByText('Map custom report columns',{exact:true}).click()
  for(const f of input.customFields){
   await form.locator('tr').filter({has:page.locator('input[name=mapColumn][value='+JSON.stringify(f.column)+']')}).locator('select[name=mapField]').selectOption('')
   const fieldset=form.locator('fieldset').filter({has:page.locator('legend',{hasText:f.column+' · CSV'})})
   await fieldset.locator('..').locator(':scope > summary').click()
   if(f.version)await fieldset.locator('select[name=customExisting]').selectOption({label:f.label+' · '+f.key})
   else{
    await fieldset.locator('input[name=customKey]').fill(f.key)
    await fieldset.locator('input[name=customLabel]').fill(f.label)
    await fieldset.locator('select[name=customKind]').selectOption(f.kind)
    await fieldset.locator('select[name=customType]').selectOption(f.type)
    await fieldset.locator('select[name=customEntry]').selectOption(f.entry)
    await fieldset.locator('textarea[name=customChoices]').fill(f.choices.join('\n'))
   }
  }
  await page.getByLabel('Review custom values separately after importing records',{exact:true}).check()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await fits(page,width)
   await page.screenshot({path:directory+'/MOVE-010-spreadsheet-columns-'+width+'.png',fullPage:true})
  }
  await form.getByRole('button',{name:'Preview mapped spreadsheet',exact:true}).click()
  await page.waitForURL('**/app/move-in/crm/review?id=*')
  const id=new URL(page.url()).searchParams.get('id'),{job}=await h.get('/api/coffer/move-in/journal?id='+id)
  assert.equal(job.report.canApply,true,JSON.stringify(job.report))
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await fits(page,width)
   await page.screenshot({path:directory+'/MOVE-010-spreadsheet-preview-'+width+'.png',fullPage:true})
  }
  await page.close();return {id,fingerprint:job.fingerprint}
 })
}


export async function resolveWaitingCustomBrowser(h,id,resolution,directory){
 await mkdir(directory,{recursive:true})
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(origin+'/app/move-in/crm/custom-review?id='+id)
  const waiting=page.locator('fieldset').filter({has:page.locator('legend',{hasText:resolution.field+' · source record '+resolution.record})})
  await waiting.locator('[name=resolutionAction]').selectOption(resolution.action)
  await waiting.locator('[name=replacementValue]').fill(resolution.value)
  await page.getByRole('button',{name:'Review these choices',exact:true}).click()
  await page.waitForURL('**/app/move-in/crm/custom-review?id=*')
  const {review}=await h.get('/api/coffer/move-in/custom-review?id='+id)
  const field=review.definitions.find(d=>d.name===resolution.field),value=review.values.find(v=>v.fieldId===field.id&&v.recordId===resolution.record)
  assert.equal(value.state,'ready','An explicit native correction resolves the waiting source value')
  assert.equal(JSON.parse(value.value),resolution.value)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await fits(page,width)
   await page.screenshot({path:directory+'/MOVE-010-corrected-'+width+'.png',fullPage:true})
  }
  await page.close();return review
 })
}


export async function neonExportBrowser(h,input,directory){
 await mkdir(directory,{recursive:true})
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  await page.setViewportSize({width:1440,height:1000})
  const fill=async()=>{
   await page.goto(origin+'/app/move-in/crm')
   const form=page.locator('form[action="/app/move-in/crm/preview"]').filter({has:page.locator('select[name=source]')})
   await form.locator('select[name=source]').selectOption('neon')
   await form.locator('input[name=exports]').setInputFiles(input.files.map(f=>({name:f.name,mimeType:'text/csv',buffer:Buffer.from(f.base64,'base64')})))
   return form
  }
  let form=await fill()
  const rejected=page.waitForResponse(r=>new URL(r.url()).pathname==='/app/move-in/crm/preview'&&r.request().method()==='POST')
  await form.getByRole('button',{name:'Preview exports',exact:true}).click()
  assert.equal((await rejected).status(),400,'Native Neon exports require explicit USD confirmation')
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  form=await fill()
  await form.locator('[name=neonExportUsd]').check()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await fits(page,width)
   await form.screenshot({path:directory+'/MOVE-010-neon-exports-'+width+'.png'})
  }
  await form.getByRole('button',{name:'Preview exports',exact:true}).click()
  await page.waitForURL('**/app/move-in/crm/review?id=*')
  const id=new URL(page.url()).searchParams.get('id'),{job}=await h.get('/api/coffer/move-in/journal?id='+id)
  assert.equal(job.report.sourceCoverage.currency,'USD')
  assert.deepEqual(job.report.sourceCoverage.counts,{accounts:1,donations:2,activities:2,households:0})
  assert.equal(job.report.canApply,true,JSON.stringify(job.report))
  await page.close();return {id,fingerprint:job.fingerprint}
 })
}
