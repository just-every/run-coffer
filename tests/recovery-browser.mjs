import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function recoveryBrowser(h,{directory}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/agent/recovery')
   await page.getByRole('heading',{name:'Card expiry warnings',exact:true}).waitFor()
   await page.getByText('Warning accepted by the mail provider',{exact:true}).waitFor()
   await page.getByRole('button',{name:'Check Stripe now',exact:true}).click()
   await page.getByText('Warning accepted by the mail provider',{exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'GIVE-006 recovery fits '+width)
   await page.screenshot({path:`${directory}/GIVE-006-recovery-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/calls?owner=&status=all')
   const tasks=page.getByText('Stripe retries exhausted; review the monthly gift with its donor.',{exact:true})
   assert.equal(await tasks.count(),2,'GIVE-006 both exhausted invoices remain actionable')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'GIVE-006 follow-up fits '+width)
   await page.screenshot({path:`${directory}/GIVE-006-tasks-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}
