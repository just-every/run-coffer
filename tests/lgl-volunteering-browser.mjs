import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function lglVolunteeringBrowser(h,input,preview,donorId,phase){
 const directory=process.env.COFFER_LGL_VOLUNTEER_PROOF
 if(directory)await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of directory?[1440,390]:[1440]){
   await page.setViewportSize({width,height:1000})
   if(phase==='review'){
   const response=await page.goto(origin+'/app/move-in/crm')
   assert.equal(response.status(),200,(await page.locator('body').innerText()).slice(0,800))
   assert.ok(await page.locator('select[name=source]').count(),(await page.locator('body').innerText()).slice(0,800))
   await page.locator('select[name=source]').selectOption('lgl')
   await page.locator('input[name="exports"][multiple]').last().setInputFiles(input.files.map(f=>({name:f.name,mimeType:'text/csv',buffer:Buffer.from(f.base64,'base64')})))
   await page.getByRole('button',{name:'Preview exports',exact:true}).click()
   await page.locator('#volunteer-review').getByText(/120 minutes/).waitFor()
   assert.equal(await page.locator('#volunteer-review li').filter({hasText:'Reading tutor'}).count(),1)
   if(directory)await page.locator('#volunteer-review').screenshot({path:`${directory}/MOVE-001-review-${width}.png`})
   await page.getByRole('link',{name:'Next volunteer rows',exact:true}).click()
   await page.locator('#volunteer-review').getByText('Page 2 of 17',{exact:false}).waitFor()
   }else{
   await page.goto(origin+'/app/move-in/crm/journal?id='+preview.id)
   await page.getByText(/volunteering/).first().waitFor()
   if(directory)await page.screenshot({path:`${directory}/MOVE-001-journal-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Review imported volunteer activities',exact:true}).click()
   await page.locator('#volunteer-review').getByText(/Imported.*Morgan Lee/).first().waitFor()
   assert.equal(await page.locator('#volunteer-review li').filter({hasText:'synthetic-coffer-1700'}).count(),1)
   await page.goto(origin+'/app/donors/'+donorId+'#volunteering')
   await page.locator('#timeline').getByText('Volunteering · Reading tutor',{exact:false}).waitFor()
   assert.match(await page.locator('#timeline').innerText(),/Little Green Light/)
   if(directory)await page.locator('#timeline').screenshot({path:`${directory}/MOVE-001-native-${width}.png`})
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Native screen fits '+width)
  }
  await page.close()
 })
}
