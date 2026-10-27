import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function smsScreens(h,{runId,phase,at}){
 const directory=process.env.COFFER_SMS_BROWSER
 if(!directory)return
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({'x-test-now':at})
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/texts?runId='+runId)
   await page.getByRole('heading',{name:'Synthetic text run'}).waitFor()
   if(phase==='held'){
    await page.getByText('Schedule: scheduled',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Schedule approved texts',exact:true}).click()
    await page.getByText('Schedule: scheduled',{exact:true}).waitFor()
    assert.equal((await h.get('/api/coffer/texts?runId='+runId)).schedule.state,'scheduled')
   }else await page.getByText('Schedule: complete',{exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Text run fits this viewport')
   await page.screenshot({path:`${directory}/COMM-006-${phase}-${width}.png`,fullPage:true})
   if(phase==='held'){
    await page.goto(origin+'/app/settings#sms-registration')
    const panel=page.locator('#sms-registration');await panel.scrollIntoViewIfNeeded()
    await panel.getByText('Twilio registration verified',{exact:true}).waitFor()
    await panel.getByRole('button',{name:'Check registration with Twilio'}).click()
    await page.locator('#sms-registration').getByText('Twilio registration verified',{exact:true}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Registration fits this viewport')
    await page.locator('#sms-registration').screenshot({path:`${directory}/COMM-006-registration-${width}.png`})
   }else{
    await page.goto(origin+'/app/calls?owner=&status=all')
    await page.getByText('SMS reply: Can we meet next week?',{exact:true}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Reply task fits this viewport')
    await page.screenshot({path:`${directory}/COMM-006-reply-task-${width}.png`,fullPage:true})
   }
   const missing=await page.locator('button,a,[role="button"]').evaluateAll(nodes=>nodes.filter(n=>!n.textContent.trim()&&n.querySelector('svg,img')&&!n.querySelector('[role="tooltip"]')).map(n=>n.outerHTML))
   assert.deepEqual(missing,[],'Icon controls on the clause screens expose tooltips')
  }
  await page.close()
 })
}
