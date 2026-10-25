import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function reportSchedulesBrowser(h,directory,stage){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   if(stage==='saved'){
    await page.goto(origin+'/app/reports/dashboard?year=2025')
    await page.getByRole('link',{name:'Schedule this report',exact:true}).click()
    assert.equal(await page.getByLabel('Report URL with filters',{exact:true}).inputValue(),'/app/reports/dashboard?year=2025')
    await page.getByLabel('Schedule name',{exact:true}).fill('Director dashboard '+width)
    await page.getByLabel('Recipient email addresses',{exact:true}).fill('director@example.test')
    await page.getByLabel('First send (UTC)',{exact:true}).fill('2026-11-02T02:00')
    await page.getByRole('checkbox',{name:/I reviewed/}).check()
    await page.getByRole('button',{name:'Save email schedule',exact:true}).click()
    await page.getByText('Director dashboard '+width,{exact:true}).waitFor()
   }else{
    await page.goto(origin+'/app/report-schedules')
    await page.getByText('Email submitted',{exact:true}).first().waitFor()
    await page.getByRole('link',{name:'Open report',exact:true}).first().waitFor()
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Screen fits viewport')
   await page.screenshot({path:`${directory}/REPORT-005-form-${width}.png`})
   await page.locator(stage==='saved'?'#report-schedule-list':'#report-mail-outcomes').scrollIntoViewIfNeeded()
   await page.screenshot({path:`${directory}/REPORT-005-${stage}-${width}.png`})
   if(stage==='saved')for(const [label,path]of [['dashboard','/app/reports/dashboard?year=2025'],['more','/app/more']]){
    await page.goto(origin+path);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/REPORT-005-${label}-${width}.png`,fullPage:false})
   }
  }
 })
}
