import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function householdsBrowser(h,{donorId,householdId,statementId,directory,phase='selected'}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/donors/'+donorId+'?householdYear=2025#household')
   const section=page.locator('#household')
   await section.getByRole('heading',{name:'Combined giving'}).waitFor()
   if(phase!=='selected'){await section.screenshot({path:`${directory}/DONOR-003-${phase}-${width}.png`});continue}
   await section.getByText('$1,400.00',{exact:true}).waitFor()
   await section.locator('summary').filter({hasText:'Edit head and household names'}).click()
   const form=section.locator('form').filter({has:page.locator('[name=command][value="household.update"]')})
   await form.locator('[name=informal_override]').fill('Bob and Jane — household')
   await form.getByRole('button',{name:'Save household',exact:true}).click()
   await page.goto(origin+'/app/donors/'+donorId+'?householdYear=2025#household')
   await section.getByText('Bob and Jane — household',{exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DONOR-003 household fits '+width)
   await section.screenshot({path:`${directory}/DONOR-003-household-${width}.png`})
   await page.goto(origin+'/app/letters/'+statementId)
   await page.getByRole('heading',{name:'Household review'}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DONOR-003 statement fits '+width)
   await page.locator('main').screenshot({path:`${directory}/DONOR-003-statement-${width}.png`})
  }
  await page.close()
 })
}
