import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'
export async function appealAgentBrowser(h,original,prepared,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(`${origin}/app/agent/appeals?appealId=${original.id}`)
   await page.getByRole('button',{name:'Check sender results',exact:true}).click()
   await page.getByText('5 recipients need review.',{exact:false}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/DEV-009-results-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Review resend (prepared)',exact:true}).click()
   await page.getByRole('button',{name:'Approve this audience',exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/DEV-009-resend-${width}.png`,fullPage:true})
  }
  await page.getByRole('button',{name:'Approve this audience',exact:true}).click()
  const detail=await h.get('/api/coffer/appeals/'+prepared.id)
  assert.equal(detail.appeal.status,'approved')
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.screenshot({path:`${directory}/DEV-009-approved-${width}.png`,fullPage:true})
  }
 })
}

export async function journeyResendBrowser(h,step,directory){
 await mkdir(directory,{recursive:true})
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/agent/appeals')
   const row=page.locator('li').filter({has:page.locator(`input[name="stepId"][value="${step.id}"]`)})
   await row.getByRole('button',{name:'Check journey sender results',exact:true}).click()
   await page.locator('li').filter({has:page.locator(`input[name="stepId"][value="${step.id}"]`)}).getByText('not sent',{exact:true}).waitFor()
   await page.locator('li').filter({has:page.locator(`input[name="stepId"][value="${step.id}"]`)}).getByText(step.responses.code,{exact:true}).waitFor()
   assert.ok((await row.innerText()).includes('2 responded · 2 gifts · $101.26'))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/DEV-009-journey-results-${width}.png`,fullPage:true})
  }
  await page.locator('li').filter({has:page.locator(`input[name="stepId"][value="${step.id}"]`)}).getByRole('button',{name:'Prepare journey resend for approval',exact:true}).click()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.getByRole('button',{name:'Approve this audience',exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/DEV-009-journey-prepared-${width}.png`,fullPage:true})
  }
  return {id:new URL(page.url()).pathname.split('/').at(-1)}
 })
}

export async function journeyResponseBrowser(current,historical,stepId,directory){
 await mkdir(directory,{recursive:true})
 for(const [h,label] of [[current,'bound'],[historical,'historical']]){
  const step=(await h.get('/api/coffer/agent/appeals')).journey.find(s=>s.id===stepId)
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage()
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    await page.goto(origin+'/app/agent/appeals')
    const row=page.locator('li').filter({has:page.locator(`input[name="stepId"][value="${stepId}"]`)})
    if(step.responses.bound){
     await row.getByText(step.responses.code,{exact:true}).waitFor()
     assert.ok((await row.innerText()).includes('2 responded · 3 gifts · $112.26'))
     await page.getByRole('heading',{name:'Journey results',exact:true}).waitFor()
     await page.getByText('handed off',{exact:true}).waitFor()
    }else await row.getByText(step.responses.note,{exact:true}).waitFor()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`${directory}/DEV-009-journey-${label}-${width}.png`,fullPage:true})
   }
  })
 }
}
