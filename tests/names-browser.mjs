import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function namesBrowser(h,{batchId,statementId,donorId}) {
 const directory=process.env.COFFER_NAMES_BROWSER
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/settings')
   const form=page.locator('form').filter({has:page.locator('input[name="command"][value="settings.update"]')})
   const body=await form.getByLabel('Letter',{exact:true}).inputValue()
   assert.ok(body.includes('{{formal_salutation}}'))
   await form.getByLabel('Letter',{exact:true}).fill(body)
   await form.locator('button[type="submit"]').click()
   await page.waitForURL('**/app/settings?saved=1*')
   assert.ok((await page.locator('body').innerText()).includes('{{envelope_name}}'))
   await page.screenshot({path:`${directory}/DONOR-014-settings-${width}.png`,fullPage:true})
   for(const [tag,path,expected] of [
    ['receipt','/app/letters/'+batchId,'The Smith Family'],
    ['statement','/app/letters/'+statementId,'Dr. Smith — 2026'],
    ['print','/app/letters/'+batchId+'/print','The Smith Family'],
    ['profile','/app/donors/'+donorId,'Robert'],
   ]) {
    await page.goto(origin+path)
    assert.ok((await page.locator('body').innerText()).includes(expected),`${tag} shows merged names`)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tag} fits ${width}`)
    await page.screenshot({path:`${directory}/DONOR-014-${tag}-${width}.png`,fullPage:true})
   }
  }
 })
}
