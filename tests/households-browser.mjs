import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function householdsBrowser(h,{donorId,householdId,statementId,directory,phase='selected'}) {
 await mkdir(directory,{recursive:true})
 const original=householdId?(await h.get('/api/coffer/households/'+householdId)).household.informal_override:null
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/donors/'+donorId+'?householdYear=2025#household')
   const section=page.locator('#household')
   await section.getByRole('heading',{name:'Combined giving'}).waitFor()
   if(phase!=='selected'){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DONOR-003 '+phase+' fits '+width);await section.screenshot({path:`${directory}/DONOR-003-${phase}-${width}.png`});continue}
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
   await page.goto(origin+'/app/letters')
   await page.locator('summary').filter({hasText:'Prepare one household statement'}).click()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DONOR-003 statement preparation fits '+width)
   await page.getByRole('heading',{name:'Year-end tax statements'}).locator('..').screenshot({path:`${directory}/DONOR-003-prepare-${width}.png`})
  }
  await page.close()
 })
 if(phase==='selected'){const state=await h.get('/api/coffer/households/'+householdId);await h.command('household.update',{householdId,version:state.household.version,informal_override:original})}
}

export async function householdImportBrowser(h,preview,directory) {
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/move-in/crm/review?id='+preview.id)
   await page.getByText('households with a source head',{exact:false}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'DONOR-003 import preview fits '+width)
   await page.screenshot({path:`${directory}/DONOR-003-import-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}
