import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'
export async function mcpBrowser(h,batch,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(`${origin}/app/letters/${batch.id}`)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   if(width===1440){
    await page.screenshot({path:`${directory}/API-004-human-review-${width}.png`})
    await page.getByRole('button',{name:'Approve these letters',exact:true}).click()
   }
   const detail=await h.get(`/api/coffer/letters/${batch.id}`)
   assert.equal(detail.batch.status,'approved');assert.equal(detail.approval.prepared_by_role,'agent');assert.equal(detail.approval.approved_by_role,'owner')
   await page.screenshot({path:`${directory}/API-004-human-approved-${width}.png`})
  }
 })
}
