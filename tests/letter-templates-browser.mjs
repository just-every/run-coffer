import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function letterTemplatesBrowser(h,{batchId,directory}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const fits=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/settings#thank-you-templates')
   const section=page.locator('#thank-you-templates')
   await section.getByText('Add a template',{exact:true}).click()
   const add=section.locator('details').filter({has:page.locator('summary',{hasText:'Add a template'})}).last().locator('form')
   const fieldsResponse=await context.request.get(origin+'/api/coffer/template-fields')
   assert.equal(fieldsResponse.status(),200)
   const catalog=await fieldsResponse.json()
   assert.ok(catalog.templates.find(t=>t.kind==='recurring_start').fields.includes('email'))
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
  }
  await page.close()
 })
}
