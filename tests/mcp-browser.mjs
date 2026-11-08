import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function mcpBrowser(h,batch,directory,attribution){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(`${origin}/app/letters/${batch.id}`)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   if(width===1440){
    assert.ok((await page.locator('main').innerText()).includes('Prepared by '+attribution))
    await page.getByRole('button',{name:'Approve these letters',exact:true}).waitFor()
   }
   await page.screenshot({path:`${directory}/API-004-human-review-${width}.png`,fullPage:true})
  }
  await page.setViewportSize({width:1440,height:1000})
  await page.getByRole('button',{name:'Approve these letters',exact:true}).click()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(`${origin}/app/letters/${batch.id}`)
   const detail=await h.get(`/api/coffer/letters/${batch.id}`)
   assert.equal(detail.batch.status,'approved');assert.equal(detail.approval.prepared_by_role,'agent');assert.equal(detail.approval.approved_by_role,'owner')
   if(width===1440)assert.ok((await page.locator('main').innerText()).includes('Prepared by '+attribution+' · approved by Morgan Lee'))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/API-004-human-approved-${width}.png`,fullPage:true})
  }
 })
}

export async function mcpAppealBrowser(h,appeal,key,directory,attribution){
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(`${origin}/app/appeals/${appeal.id}`)
   if(width===1440){
    assert.ok((await page.locator('main').innerText()).includes('Prepared by '+attribution+' (agent)'))
    await page.getByRole('button',{name:'Approve this audience',exact:true}).waitFor()
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/BASE-AGENT-008-appeal-review-${width}.png`,fullPage:true})
  }
  await page.setViewportSize({width:1440,height:1000})
  await page.getByRole('button',{name:'Approve this audience',exact:true}).click()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(`${origin}/app/appeals/${appeal.id}`)
   if(width===1440)assert.ok((await page.locator('main').innerText()).includes('approved by Morgan Lee (owner)'))
   await page.screenshot({path:`${directory}/BASE-AGENT-008-appeal-approved-${width}.png`,fullPage:true})
   await page.goto(`${origin}/app/audit?person=${key.id}`)
   if(width===1440){
    const rows=page.locator('tbody tr')
    assert.ok(await rows.count()>0)
    assert.ok((await rows.first().innerText()).includes(attribution))
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Download filtered CSV',exact:true}).click()])
    const stream=await download.createReadStream(),chunks=[]
    for await(const chunk of stream)chunks.push(chunk)
    const csv=Buffer.concat(chunks).toString()
    assert.ok(csv.includes(attribution));assert.ok(csv.includes(key.id));assert.ok(!csv.includes(key.token))
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/BASE-AGENT-008-audit-${width}.png`,fullPage:true})
  }
 })
}

export async function mcpStoredBrowser(h,batch,key,directory,attribution){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   for(const [screen,path] of [['stored-receipt',`/app/letters/${batch.id}`],['stored-audit',`/app/audit?person=${key.id}&action=ack.standingApproval`],['stored-activity','/app/agent']]){
    await page.goto(origin+path)
    if(width===1440){
     const text=await page.locator('main').innerText()
     assert.ok(text.includes(attribution))
     if(screen==='stored-receipt')assert.ok(text.includes('approved by Morgan Lee under a standing grant'))
     if(screen==='stored-audit'){
      const row=page.locator('tbody tr').first()
      await row.locator('summary').click()
      assert.ok((await row.innerText()).includes('Morgan Lee'))
     }
     if(screen==='stored-activity')assert.ok(await page.locator('tbody tr').filter({hasText:attribution}).count()>0)
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`${directory}/BASE-AGENT-008-${screen}-${width}.png`,fullPage:true})
   }
  }
 })
}
