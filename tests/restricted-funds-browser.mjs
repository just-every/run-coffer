import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function restrictedFundsBrowser(h,directory) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(10000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/funds')
   await page.screenshot({path:`${directory}/FIN-003-funds-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Restricted funds and release report'}).click()
   await page.getByLabel('Through',{exact:true}).fill('2026-09-30')
   await page.getByRole('button',{name:'Read report',exact:true}).click()
   await page.getByLabel('Fund name',{exact:true}).fill(`Summer tutoring ${width}`)
   await page.locator('select[name="restriction"]').selectOption('purpose')
   await page.getByLabel('Restriction details',{exact:true}).fill('Summer literacy tutoring')
   await page.getByRole('button',{name:'Define fund',exact:true}).click()
   await page.locator('select[name="fund"]').selectOption('Library')
   await page.getByLabel('Spend amount (USD)',{exact:true}).fill('10')
   await page.getByLabel('Spent on',{exact:true}).fill('2026-09-12')
   await page.getByLabel('Accounting reference',{exact:true}).fill(`BOOKS-${width}`)
   await page.getByLabel('Spend description',{exact:true}).fill('Classroom workbooks')
   await page.getByRole('button',{name:'Record spend',exact:true}).click()
   await page.getByText(`BOOKS-${width} · Classroom workbooks`,{exact:false}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/FIN-003-restrictions-${width}.png`,fullPage:true})
  }
 })
}
