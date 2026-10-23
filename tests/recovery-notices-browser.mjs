import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function recoveryNoticesBrowser(h,{directory}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1100})
   await page.goto(origin+'/app/agent/recovery')
   await page.getByRole('heading',{name:'Recovery notice approval',exact:true}).waitFor()
   await page.getByText('Waiting for development-lead approval',{exact:true}).waitFor()
   assert.equal(await page.getByText('Accepted by mail provider',{exact:true}).count(),2)
   await page.getByRole('button',{name:'Approve this notice',exact:true}).waitFor()
   const record=page.getByText('Record donor permission',{exact:true});await record.click()
   await page.getByLabel('Evidence of the donor’s recovery-contact permission',{exact:true}).first().waitFor()
   await page.getByRole('combobox',{name:/^Permitted channel/}).first().selectOption('phone')
   assert.equal(await page.getByRole('combobox',{name:/^Permitted channel/}).first().inputValue(),'phone')
   await record.click()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Recovery notice review fits '+width)
   await page.evaluate(()=>scrollTo(0,0))
   await page.screenshot({path:`${directory}/DEV-002-recovery-notices-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}
