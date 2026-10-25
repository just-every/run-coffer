import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function recurringPlansBrowser(h,edge,{monthly,person,sourceRef,directory,phase='main'}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({'x-test-now':edge.state.now})
  const page=await context.newPage()
  const capture=async(name,width)=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Screen fits the viewport')
   for(const control of await page.locator('a,button').all()){
    if(!await control.isVisible())continue
    const info=await control.evaluate(el=>({text:el.innerText.trim(),tip:el.querySelector('[role="tooltip"]')?.textContent?.trim()}))
    if(info.text&&!info.tip)continue
    assert.ok(info.tip,'Icon controls have a tooltip')
    await control.focus()
    assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
    await control.hover();await page.waitForTimeout(350)
    assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
   }
   await page.screenshot({path:`${directory}/${name}-${width}.png`,fullPage:!name.startsWith('donor-plan')})
  }
  if(phase==='pending'){for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/giving/plans/'+monthly.id);await page.getByRole('heading',{name:'Provider result needs review',exact:true}).waitFor();await capture('plan-pending',width)};return}
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/give/recurring-reading')
   await page.getByRole('heading',{name:'Year-round reading',exact:true}).waitFor()
   await page.getByLabel('Gift frequency',{exact:true}).selectOption('quarterly')
   await capture('giving-frequency',width)
   await page.goto(origin+'/giving/thanks?session_id=cs_recurring_1');await page.getByRole('heading',{name:'Thank you for your gift',exact:true}).waitFor();await capture('giving-confirmed',width)
   await page.goto(origin+'/app/giving');await capture('giving',width)
   await page.getByRole('link',{name:'Manage recurring plans',exact:true}).click();await capture('plan-list',width)
   await page.goto(origin+'/app/giving/plans/'+monthly.id);await capture('plan-active',width)
   const submit=async(title,fields={})=>{
    const form=page.locator('form').filter({has:page.getByRole('button',{name:title,exact:true})})
    await form.getByLabel('Recorded authorization evidence',{exact:true}).selectOption(sourceRef)
    await form.getByLabel('Reason for this change',{exact:true}).fill('Confirmed the collection instruction in the donor call.')
    for(const [label,value]of Object.entries(fields))await form.getByLabel(label,{exact:true}).fill(value)
    await form.getByRole('checkbox').check();await form.getByRole('button',{name:title,exact:true}).click()
    await page.getByRole('status').getByText('The recurring plan change is confirmed at Stripe and recorded.').waitFor()
   }
   await submit('Change future amount',{'Amount (USD)':width===1440?'35':'40'});await capture('plan-amount',width)
   await submit('Change future billing date',{'Next billing date (UTC)':width===1440?'2026-09-10':'2026-10-10'});await capture('plan-date',width)
   await submit('Pause collections');await page.getByText(/collections paused/).first().waitFor();await capture('plan-paused',width)
   await submit('Resume collections');await capture('plan-resumed',width)
   await page.goto(origin+'/app/donors/'+person.id);await page.getByRole('heading',{name:'Recurring giving',exact:true}).scrollIntoViewIfNeeded();await capture('donor-plan',width)
   await page.goto(origin+'/app/giving/health?from=2026-04&through=2026-05');await capture('plan-health',width)
  }
  await page.goto(origin+'/app/giving/plans/'+monthly.id)
  const cancel=page.locator('form').filter({has:page.getByRole('button',{name:'Cancel at period end',exact:true})})
  await cancel.getByLabel('Recorded authorization evidence',{exact:true}).selectOption(sourceRef)
  await cancel.getByLabel('Reason for this change',{exact:true}).fill('Donor requested cancellation in the recorded call.')
  await cancel.getByRole('checkbox').check();await cancel.getByRole('button').click()
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await capture('plan-cancelled',width)}
 })
}
