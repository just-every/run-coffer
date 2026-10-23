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
