import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function recurringBrowser(h,donorId,directory) {
 return withBrowserWorker(h,async(context,origin)=>{
  await mkdir(directory,{recursive:true})
  const page=await context.newPage()
  const shot=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/STEW-002-${name}-${width}.png`,fullPage:true})}await page.setViewportSize({width:1440,height:1000})}
  await page.goto(origin+'/app/donors/'+donorId)
  await shot('donor-link')
  await page.getByRole('link',{name:'Create a repeating task',exact:true}).click()
  await page.getByLabel('Task title',{exact:true}).fill('Board stewardship check-in')
  await page.getByLabel('First due date',{exact:true}).fill('2026-11-01')
  await page.getByLabel('Repeat').selectOption('3')
  await shot('create-for-donor')
  await page.getByRole('button',{name:'Create repeating task',exact:true}).click()
  const task=page.locator('#repeating-tasks li').filter({has:page.getByRole('heading',{name:'Board stewardship check-in',exact:true})})
  await task.locator('summary').click()
  await task.getByLabel('Completion notes').fill('Discussed the reading program and agreed the next quarterly check-in.')
  await shot('complete')
  await task.getByRole('button',{name:'Complete task',exact:true}).click()
  await page.goto(origin+'/app/calls?owner=&status=all')
  await page.getByText('Next due February 1, 2027',{exact:true}).waitFor()
  await shot('next-occurrence')
  await page.getByText('Create a repeating task',{exact:true}).click()
  await page.getByLabel('Task title',{exact:true}).fill('Monthly retention review')
  await page.getByLabel('First due date',{exact:true}).fill('2026-11-02')
  await page.getByLabel('Repeat').selectOption('1')
  await page.getByRole('button',{name:'Create repeating task',exact:true}).click()
  await page.getByRole('heading',{name:'Monthly retention review',exact:true}).waitFor()
  await shot('general-team-task')
  console.log('STEW-002 browser: donor-linked quarterly and general monthly tasks completed at 1440 and 390')
 })
}
