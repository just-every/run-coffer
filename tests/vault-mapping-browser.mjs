import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function vaultMappingBrowser(h,input,review,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const response=await page.goto(origin+'/app/move-in/crm/vault')
  assert.equal(response.status(),200,await page.locator('body').innerText())
  assert.equal(new URL(page.url()).pathname,'/app/move-in/crm/vault',await page.locator('body').innerText())
  await page.locator('select[name=source]').selectOption(input.source)
  await page.getByLabel('Source processor account reference').fill(input.sourceAccount)
  await page.getByLabel('Destination Stripe account ID').fill(input.destinationAccount)
  const file=f=>({name:f.name,mimeType:f.name.endsWith('.json')?'application/json':'text/csv',buffer:Buffer.from(f.base64,'base64')})
  await page.getByLabel('Source plans file',{exact:true}).setInputFiles(file(input.plans))
  await page.getByLabel('Stripe reference mapping files',{exact:true}).setInputFiles(input.mappings.map(file))
  for(const [i,[source,selection]] of Object.entries(input.donors).entries()){
   await page.locator('[name=sourceDonor]').nth(i).fill(source)
   await page.locator('[name=nativeDonor]').nth(i).selectOption(JSON.stringify(selection))
  }
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:directory+'/vault-input-'+width+'.png',fullPage:true})}
  await page.setViewportSize({width:1440,height:1000})
  await page.getByRole('button',{name:'Preview payment mappings',exact:true}).click()
  await page.waitForURL('**/vault/review?id=*')
  assert.equal(new URL(page.url()).searchParams.get('id'),review.id,'Native file submission reaches the exact reviewed evidence')
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.reload()
   if(width===1440){
    for(const [category,count] of Object.entries(review.counts))assert.equal(await page.locator('[data-vault-category='+category+']').count(),count)
    await page.getByRole('heading',{name:'Matched · 3',exact:true}).waitFor()
    assert.ok(await page.getByText('unverified',{exact:true}).isVisible())
    assert.equal(await page.getByText('synthetic-coffer-7191 · 2026-09-01 · signed paper',{exact:true}).count(),2)
    assert.ok(await page.getByText('synthetic-coffer-7191 · 2026-09-01 · signed paper',{exact:true}).first().isVisible())
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Review fits '+width)
    assert.deepEqual(await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!(n.innerText||'').trim()).map(n=>n.outerHTML)),[],'All controls have visible labels')
   }
   await page.screenshot({path:directory+'/vault-review-'+width+'.png',fullPage:true})
  }
  await page.setViewportSize({width:1440,height:1000})
  await page.getByLabel('I reviewed these exact identities, accounts and unresolved rows. Save evidence only.').check()
  await page.getByRole('button',{name:'Save mapping evidence',exact:true}).click()
  await page.waitForURL('**/vault/review?id=*');await page.reload()
  assert.equal((await h.get('/api/coffer/move-in/vault/review?id='+review.id)).state,'saved')
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.reload();if(width===1440)assert.ok(await page.getByText('saved',{exact:true}).isVisible());await page.screenshot({path:directory+'/vault-saved-'+width+'.png',fullPage:true})}
  await page.close()
 })
}
