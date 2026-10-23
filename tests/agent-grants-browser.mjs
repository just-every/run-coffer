import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function agentGrantsBrowser(h,donorId,directory) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/data#agent-grants')
   const panel=page.locator('#agent-grants')
   await panel.getByRole('button',{name:'Enable agent keys',exact:true}).click()
   await page.waitForURL('**/app/data#agent-grants')
   const create=panel.locator('details').filter({has:page.locator('summary',{hasText:'Create a grant'})}).first()
   await create.locator('summary').click()
   await create.getByLabel('Grant name',{exact:true}).fill('Reviewed phone receipts '+width)
   await create.getByLabel('Explicit donor identifiers (one per line or comma separated)',{exact:true}).fill(donorId)
   await create.getByLabel('Daily receipt limit',{exact:true}).fill('1')
   await create.getByRole('checkbox',{name:'ack.send',exact:true}).check()
   await create.getByRole('checkbox',{name:/I approve standing standard-receipt sending/}).check()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await create.screenshot({path:`${directory}/grant-review-${width}.png`})
   await create.getByRole('button',{name:'Create named grant',exact:true}).click()
   await panel.getByRole('heading',{name:'Reviewed phone receipts '+width,exact:true}).waitFor()
   await panel.getByRole('heading',{name:'Reviewed phone receipts '+width,exact:true}).locator('..').screenshot({path:`${directory}/grant-created-${width}.png`})
   await panel.getByRole('button',{name:'Stop all agent keys',exact:true}).click()
   await panel.getByRole('button',{name:'Enable agent keys',exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await panel.getByRole('button',{name:'Enable agent keys',exact:true}).locator('..').screenshot({path:`${directory}/grant-stopped-${width}.png`})
  }
 })
}

export async function automationGrantsBrowser(h,directory) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/agent/grants')
   const details=page.locator('#background-grants > details').filter({has:page.locator('input[name=id][value=receipts]')})
   await details.locator('summary').click()
   assert.equal(await details.locator('select[name=enabled]').inputValue(),'no')
   await details.getByLabel('Daily action limit',{exact:true}).fill('2')
   await details.getByRole('button',{name:'Save background grant',exact:true}).click()
   await page.waitForURL('**/app/agent/grants')
   await details.locator('summary').click()
   assert.equal(await details.getByLabel('Daily action limit',{exact:true}).inputValue(),'2')
   assert.equal(await details.locator('select[name=scope]').inputValue(),'selected')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/background-grants-${width}.png`,fullPage:true})
  }
 })
}
