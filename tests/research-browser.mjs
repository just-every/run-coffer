import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function researchBrowser(h,adaId,missingId,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+adaId)
   const linkPanel=page.getByRole('heading',{name:'Prospect research',exact:true}).locator('..');await linkPanel.evaluate(el=>el.scrollIntoView({block:'center'}));await linkPanel.screenshot({path:`${directory}/MAJOR-005-donor-link-${width}.png`})
   await page.getByRole('link',{name:'Prospect research',exact:true}).click()
   await page.getByRole('heading',{name:'Research for Ada Rivera',exact:true}).waitFor()
   await page.screenshot({path:`${directory}/MAJOR-005-results-${width}.png`,fullPage:true})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.getByRole('button',{name:'Disconnect WealthEngine',exact:true}).click()
   await page.getByText('Connect WealthEngine above to screen donors.',{exact:true}).waitFor()
   await page.screenshot({path:`${directory}/MAJOR-005-disconnected-${width}.png`,fullPage:true})
   await page.locator('summary').filter({hasText:'Connect WealthEngine'}).click()
   await page.getByLabel('WealthEngine production API key',{exact:true}).fill('test-wealthengine-edge-only')
   await page.getByRole('button',{name:'Connect WealthEngine',exact:true}).click()
   await page.getByLabel('Ada Rivera',{exact:true}).check();await page.getByLabel('Ben Wells',{exact:true}).check()
   await page.getByRole('button',{name:'Screen selected donors',exact:true}).click()
   await page.getByText('$100K-$200K',{exact:true}).first().waitFor()
   await page.screenshot({path:`${directory}/MAJOR-005-screened-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/research?donorId='+missingId);await page.getByRole('button',{name:'Screen selected donors',exact:true}).click()
   await page.getByText('WealthEngine found no matching profile for this donor.',{exact:true}).waitFor()
   await page.screenshot({path:`${directory}/MAJOR-005-no-match-${width}.png`,fullPage:true})
  }
 })
}
