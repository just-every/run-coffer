import assert from 'node:assert/strict'
import {mkdtemp,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {withBrowserWorker} from './browser-worker.mjs'

const base='/app/move-in/crm'
export async function moveInGuideBrowser(h,input,preview){
 const directory=process.env.COFFER_MOVE_IN_GUIDE_BROWSER||await mkdtemp(join(tmpdir(),'coffer-switching-guide-'))
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  try {
   await page.goto(origin+base+'?source=bloomerang')
   const checklist=()=>page.locator('#installation-checklist')
   // Follow every live section link for every supported named source. The guide
   // is served by the actual installation, so an unresolved route or fragment fails.
   const options=await checklist().locator('select[name=source] option').evaluateAll(nodes=>nodes.map(n=>n.value))
   assert.equal(options.length,6)
   for(const source of options){
    await page.goto(origin+base+'?source='+source)
    const links=await checklist().locator('ol a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))
    assert.equal(links.length,9)
    for(const href of links){
     await page.goto(origin+base+'?source='+source)
     await checklist().locator(`a[href="${href}"]`).click()
     assert.equal(new URL(page.url()).hash,new URL(href,origin).hash)
     await page.locator(new URL(page.url()).hash).getByRole('heading').waitFor()
     assert.ok((await page.locator(new URL(page.url()).hash).innerText()).length>100,'A linked section contains actionable guidance')
    }
   }
   await page.goto(origin+base+'/review?id='+preview.id)
   await page.getByText('Map custom report columns',{exact:true}).click()
   const upload=page.locator('form[action="/app/move-in/crm/preview"]')
   assert.ok(await upload.locator('select[name=customExisting]').first().inputValue(),'The reviewed existing field stays selected')
   await upload.locator('input[name=exports]').setInputFiles(input.files.map(f=>({name:f.name,mimeType:['text','csv'].join('/'),buffer:Buffer.from(f.base64,'base64')})))
   await upload.getByRole('button',{name:'Check the files again',exact:true}).click()
   await page.waitForURL('**/app/move-in/crm/review?id=*')
   assert.equal(new URL(page.url()).searchParams.get('id'),preview.id)
   const apply=page.locator('form[action="/app/move-in/crm/apply"]')
   await apply.locator('input[name=acknowledged][value=no]').check()
   await apply.locator('input[name=confirm]').check()
   await apply.getByRole('button',{name:'Move these records in',exact:true}).click()
   await page.waitForURL('**/app/move-in/crm/journal?id=*')
   await page.goto(origin+base+'?source=bloomerang')
   assert.equal(await checklist().locator('[data-switch-step=exports]').getAttribute('data-complete'),'true')
   for(const [summary,button,step] of [['Compare name evidence','Approve reviewed names','names'],['Compare field evidence','Approve reviewed fields','fields'],['Compare current totals','Approve reviewed totals','reconciliation']]){
    await checklist().getByText(summary,{exact:true}).click()
    await checklist().getByRole('button',{name:button,exact:true}).click()
    await page.waitForURL('**/app/move-in/crm?**#installation-checklist')
    assert.equal(await checklist().locator(`[data-switch-step=${step}]`).getAttribute('data-complete'),'true')
   }
   await page.reload()
   assert.equal(await checklist().locator('[data-complete=true]').count(),4,'Reload retains only evidence-backed completion')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Checklist fits the 1440-pixel assertion viewport')
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    await page.goto(origin+base+'?source=bloomerang#installation-checklist')
    for(const summary of ['Compare name evidence','Compare field evidence','Compare current totals'])await checklist().getByText(summary,{exact:true}).click()
    await page.screenshot({path:join(directory,'checklist-completed-'+width+'.png'),fullPage:true})
    for(const source of options){
     await page.goto(origin+base+'/guide?source='+source)
     await page.screenshot({path:join(directory,'guide-'+source+'-'+width+'.png'),fullPage:true})
    }
   }
  }finally{await page.close()}
 })
}
