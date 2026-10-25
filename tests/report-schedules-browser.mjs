import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function reportSchedulesBrowser(h,directory,stage){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({'x-test-now':'2026-10-25T02:00:00Z'})
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const state=()=>h.get('/api/coffer/report-schedules',{headers:{'x-test-now':'2026-10-25T02:00:00Z'}})
  if(stage==='uncertain'||stage==='held')await page.goto(origin+'/app/report-schedules')
  const initial=stage==='uncertain'||stage==='held'?await state():null
  const uncertain=initial?.runs.filter(run=>run.status==='uncertain'&&!initial.runs.some(retry=>retry.retry_of===run.id)).slice(0,2)
  if(stage==='uncertain')assert.equal(uncertain.length,2,'Each viewport reviews a different unconfirmed run')
  const held=initial?.runs.find(run=>run.status==='held'&&run.detail)
  if(stage==='held')assert.ok(held,'A held run includes its reason')
  let viewport=0
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   let focus
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
   }else if(stage==='submitted'){
    await page.goto(origin+'/app/report-schedules')
    await page.getByText('Email submitted',{exact:true}).first().waitFor()
    await page.getByRole('link',{name:'Open report',exact:true}).first().waitFor()
   }else if(stage==='uncertain'){
    await page.goto(origin+'/app/report-schedules')
    const run=uncertain[viewport],row=page.locator(`[id=${JSON.stringify('report-run-'+run.id)}]`)
    await row.getByText('Delivery unconfirmed',{exact:true}).waitFor()
    if(run.detail)await row.getByText(run.detail,{exact:true}).waitFor()
    const reviewed=row.getByRole('checkbox',{name:/recipient may receive a duplicate/}),resend=row.getByRole('button',{name:'Resend report',exact:true})
    assert.equal(await reviewed.isChecked(),false)
    const before=await state()
    await resend.click()
    assert.equal(await reviewed.evaluate(input=>input.validity.valueMissing),true,'Resend requires explicit duplicate acknowledgment')
    assert.equal((await state()).runs.length,before.runs.length,'Unchecked review does not send a report')
    await page.keyboard.press('Escape')
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({path:`${directory}/REPORT-005-uncertain-review-${width}.png`})
    await reviewed.check()
    const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/app/actions'&&response.request().method()==='POST')
    await resend.click()
    assert.equal((await response).status(),303)
    await page.waitForLoadState('load')
    const after=await state(),retry=after.runs.find(attempt=>attempt.retry_of===run.id)
    assert.ok(retry,'Reviewed resend records a separate attempt linked to the unconfirmed run')
    assert.equal(after.runs.filter(attempt=>attempt.retry_of===run.id).length,1)
    assert.equal(after.runs.find(attempt=>attempt.id===run.id).status,'uncertain','The original outcome stays unconfirmed')
    focus=page.locator(`[id=${JSON.stringify('report-run-'+retry.id)}]`)
    await focus.getByText('Manual resend',{exact:true}).waitFor()
   }else if(stage==='held'){
    await page.goto(origin+'/app/report-schedules')
    focus=page.locator(`[id=${JSON.stringify('report-run-'+held.id)}]`)
    await focus.getByText('Held',{exact:true}).waitFor()
    await focus.getByText(held.detail,{exact:true}).waitFor()
    assert.equal(await focus.getByRole('button',{name:'Resend report',exact:true}).count(),0)
   }else if(stage.startsWith('link:')){
    await page.goto(origin+stage.slice(5))
    await page.getByRole('link',{name:'Download report attachment',exact:true}).waitFor()
    await page.getByRole('heading',{name:'Fundraising dashboard',exact:true}).waitFor()
    await page.getByRole('heading',{name:'Report contents',exact:true}).waitFor()
    assert.match(await page.locator('main').innerText(),/Current/)
    focus=page.getByRole('heading',{name:'Fundraising dashboard',exact:true})
   }else{
    throw new Error('Unknown report schedule browser stage: '+stage)
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Screen fits viewport')
   if(stage==='saved')await page.screenshot({path:`${directory}/REPORT-005-form-${width}.png`})
   await (focus??page.locator(stage==='saved'?'#report-schedule-list':'#report-mail-outcomes')).scrollIntoViewIfNeeded()
   await page.screenshot({path:`${directory}/REPORT-005-${stage.startsWith('link:')?'recipient-link':stage}-${width}.png`})
   if(stage==='saved')for(const [label,path]of [['dashboard','/app/reports/dashboard?year=2025'],['home','/app?year=2025'],['more','/app/more']]){
    await page.goto(origin+path);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/REPORT-005-${label}-${width}.png`,fullPage:false})
   }
   viewport++
  }
 })
}
