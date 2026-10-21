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
   assert.equal(await form.count(),1,await page.locator('body').innerText())
   const body=await form.locator('textarea[name=letterTemplate]').inputValue()
   assert.ok(body.includes('{{formal_salutation}}'))
   await form.locator('textarea[name=letterTemplate]').fill(body)
   await form.getByRole('button',{name:'Save settings',exact:true}).click()
   await page.waitForURL('**/app/settings?saved=1*')
   assert.ok((await page.locator('body').innerText()).includes('{{envelope_name}}'))
   await page.screenshot({path:`${directory}/DONOR-014-settings-${width}.png`,fullPage:true})
   const defaults=page.locator('form').filter({has:page.locator('input[name="command"][value="person.defaultsPreview"]')})
   await defaults.locator('select[name=informal]').selectOption('nickname-only')
   await defaults.getByRole('button',{name:'Preview name changes',exact:true}).click()
   await page.waitForURL('**/app/actions')
   assert.match(await page.locator('body').innerText(),/1 person records will change/)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Preview fits ${width}`)
   await page.screenshot({path:`${directory}/DONOR-014-defaults-preview-${width}.png`,fullPage:true})
   await page.getByRole('button',{name:'Save name defaults',exact:true}).click()
   await page.waitForURL('**/app/settings?saved=1*')
   assert.equal(await page.locator('select[name=informal]').inputValue(),'nickname-only')
   await page.screenshot({path:`${directory}/DONOR-014-defaults-saved-${width}.png`,fullPage:true})
   await page.locator('select[name=informal]').selectOption('nickname-first')
   await page.getByRole('button',{name:'Preview name changes',exact:true}).click()
   await page.getByRole('button',{name:'Save name defaults',exact:true}).click()
   await page.waitForURL('**/app/settings?saved=1*')
   for(const [tag,path,expected] of [
    ['receipt','/app/letters/'+batchId,'The Smith Family'],
    ['statement','/app/letters/'+statementId,'Dr. Smith — 2026'],
    ['print','/app/letters/'+batchId+'/print','The Smith Family'],
    ['labels','/app/letters/'+batchId+'/print?labels=1','The Smith Family'],
    ['profile','/app/donors/'+donorId,'Robert'],
    ['appeals','/app/appeals','{{informal_salutation}}'],
    ['batch','/app/letters/'+batchId,'Print address labels'],
   ]) {
    await page.goto(origin+path)
    assert.ok((await page.locator('body').innerText()).includes(expected),`${tag} shows merged names`)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tag} fits ${width}`)
    if(tag==='print'||tag==='labels')await page.pdf({path:`${directory}/DONOR-014-${tag}-${width}.pdf`,format:'Letter',printBackground:true})
    await page.screenshot({path:`${directory}/DONOR-014-${tag}-${width}.png`,fullPage:true})
   }
  }
 })
}
