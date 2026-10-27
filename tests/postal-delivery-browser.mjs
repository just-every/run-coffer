import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function postalBrowser(h,{batchId,donorId,admin,authorize=false,stage='tracking'}){
 const directory=process.env.COFFER_PRINT_BROWSER??'.cache/print-letters'
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  if(admin)await context.addCookies(admin.split('; ').map(value=>{const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),domain:'127.0.0.1',path:'/',httpOnly:true,secure:true,sameSite:'Lax'}}))
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const shots=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/postal-${name}-${width}.png`,fullPage:true})}}
  await page.goto(origin+'/app/letters/'+batchId)
  if(authorize){
   await page.getByRole('button',{name:'Authorize postal sending',exact:true}).waitFor()
   await shots('approval')
   await page.locator('input[name=approvePostage]').check()
   await page.getByRole('button',{name:'Authorize postal sending',exact:true}).click()
   try{await page.getByText('Postal submission accepted',{exact:true}).first().waitFor()}catch(error){await shots('failed-submission');assert.fail(await page.locator('main').innerText())}
   await shots('submitted')
  }else{
   await page.getByText('letter.returned_to_sender',{exact:false}).first().waitFor();await shots(stage+'-batch')
   await page.goto(origin+'/app/donors/'+donorId+'?timelineKind=receipt')
   assert.match(await page.locator('#timeline').innerText(),/letter.returned_to_sender/)
   assert.doesNotMatch(await page.locator('#timeline').innerText(),/Gift receipt · Delivered/)
   assert.match(await page.locator('main').innerText(),/Fix postal address|Address task completed/)
   await shots(stage+'-donor')
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('#timeline').screenshot({path:`${directory}/postal-${stage}-timeline-${width}.png`});await page.getByRole('heading',{name:'Receipt address follow-up',exact:true}).locator('..').screenshot({path:`${directory}/postal-${stage}-tasks-${width}.png`})}
  }
 })
}
