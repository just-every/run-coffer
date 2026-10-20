import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'
export async function documentBrowser(h,donor,pledge,pdf,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   const opened=await page.goto(`${origin}/app/donors/${donor.id}#documents`)
   assert.equal(opened.status(),200,await page.locator('body').innerText())
   const panel=page.locator('#documents')
   await panel.locator('select[name=recordRef]').selectOption('pledge:'+pledge.id)
   await panel.getByLabel('Document title',{exact:true}).fill(`Signed pledge agreement ${width}`)
   await panel.locator('input[type=file]').setInputFiles({name:`agreement-${width}.pdf`,mimeType:'application/pdf',buffer:pdf})
   await panel.getByRole('button',{name:'Upload document',exact:true}).click()
   await page.getByRole('link',{name:`Signed pledge agreement ${width}`,exact:true}).waitFor()
   await panel.scrollIntoViewIfNeeded()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/DONOR-008-uploaded-${width}.png`})
   const link=page.getByRole('link',{name:`Signed pledge agreement ${width}`,exact:true}),path=await link.getAttribute('href')
   const response=await page.goto(origin+path,{waitUntil:'domcontentloaded'})
   assert.equal(response.status(),200);assert.equal(response.headers()['content-type'],'application/pdf')
   assert.match((await response.body()).toString(),/type="application\/pdf"/,'Chromium opened its native PDF viewer')
   await page.waitForLoadState('networkidle')
   await page.screenshot({path:`${directory}/DONOR-008-preview-${width}.png`})
  }
 },{channel:'chromium'})
}
