import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { withBrowserWorker } from './browser-worker.mjs'

export async function campaignScreens(context, origin, id, directory) {
 await mkdir(directory,{recursive:true})
 const page = await context.newPage()
 for (const width of [1440,390]) {
  await page.setViewportSize({width,height:1000})
  await page.goto(origin+'/app/giving')
  await page.getByRole('heading',{name:'Campaigns',exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:`${directory}/CAMP-001-campaigns-${width}.png`,fullPage:true})
  await page.getByRole('link',{name:'Spring reading',exact:true}).click()
  await page.waitForURL('**/app/giving/campaigns/'+id)
  await page.getByRole('heading',{name:'Spring reading',exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  for (const text of ['Neighborhood phase','$250.00','$30.00','$62.50','4 giving donors','3 first-time donors']) assert.ok((await page.locator('main').textContent()).includes(text),text)
  await page.screenshot({path:`${directory}/CAMP-001-progress-${width}.png`,fullPage:true})
  await page.getByRole('link',{name:'Neighborhood phase',exact:true}).click()
  await page.getByRole('heading',{name:'Neighborhood phase',exact:true}).waitFor()
  assert.ok((await page.locator('main').textContent()).includes('$60.00'))
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:`${directory}/CAMP-001-phase-${width}.png`,fullPage:true})
 }
 await page.close()
}
export const campaignBrowser = (h,id,directory) => withBrowserWorker(h,(context,origin)=>campaignScreens(context,origin,id,directory))
