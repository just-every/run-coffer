import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function dashboardScreens(page,origin,directory){
 await mkdir(directory,{recursive:true})
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000})
  await page.goto(origin+'/app/reports/dashboard?year=2024')
  await page.getByLabel('Fiscal start year',{exact:true}).fill('2024')
  await page.getByRole('button',{name:'View dashboard',exact:true}).click()
  const fund=page.locator('#dashboard-fund').getByRole('row').filter({hasText:'Library'})
  await fund.getByRole('cell').nth(1).getByRole('link',{name:'$120.00',exact:true}).waitFor()
  await fund.getByRole('cell').nth(2).getByRole('link',{name:'$120.00',exact:true}).waitFor()
  await fund.getByRole('cell').nth(3).getByRole('link',{name:'$1,000.00',exact:true}).waitFor()
  await page.locator('#dashboard-campaign').getByRole('row').filter({hasText:'Dashboard reading'}).getByRole('link',{name:'$40.00',exact:true}).waitFor()
  const september=page.locator('#dashboard-month').getByRole('row').filter({hasText:'September'})
  await september.getByRole('link',{name:'$165.00',exact:true}).waitFor()
  await september.getByRole('link',{name:'$1,000.00',exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:`${directory}/REPORT-003-dashboard-${width}.png`,fullPage:true})
  await fund.getByRole('cell').nth(1).getByRole('link',{name:'$120.00',exact:true}).click()
  await page.getByRole('heading',{name:'Dashboard ledger entries',exact:true}).waitFor()
  await page.locator('#dashboard-entries').getByRole('link',{name:'Ada Dashboard',exact:true}).first().waitFor()
  assert.ok((await page.locator('#dashboard-entries').innerText()).includes('$120.00'))
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:`${directory}/REPORT-003-fund-gifts-${width}.png`,fullPage:true})
  await page.goto(origin+'/app')
  await page.getByRole('heading',{name:'Fundraising dashboard',exact:true}).waitFor()
  await page.screenshot({path:`${directory}/REPORT-003-home-${width}.png`,fullPage:true})
  await page.goto(origin+'/app/reports/dashboard?year=2021')
  await page.locator('#dashboard-month').getByRole('link',{name:'$0.00',exact:true}).first().waitFor()
  await page.screenshot({path:`${directory}/REPORT-003-empty-${width}.png`,fullPage:true})
 }
}
export async function dashboardBrowser(h,directory){
 await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();page.setDefaultTimeout(15000);await dashboardScreens(page,origin,directory)})
}
