import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function hygieneBrowser(h,{statusId},directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const shot=async(name,focus)=>{for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   if(focus)await focus.scrollIntoViewIfNeeded();else await page.evaluate(()=>scrollTo(0,0))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits '+width)
   const icons=await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!(n.innerText||'').trim()).map(n=>n.outerHTML.slice(0,180)))
   assert.deepEqual(icons,[],'Changed screens give controls visible labels')
   await page.screenshot({path:`${directory}/DEV-008-${name}-${width}.png`})
  }await page.setViewportSize({width:1440,height:1000})}
  await page.goto(origin+'/app/agent')
  await page.getByRole('link',{name:'Database hygiene',exact:true}).click()
  await shot('pending-proposals')
  const card=page.locator('section.card').filter({has:page.locator(`input[name=id][value="${statusId}"]`)}).first()
  await card.getByText('Evidence for this proposal',{exact:true}).click()
  await shot('returned-letter-evidence',card)
  await card.getByLabel('I reviewed the evidence and accept this exact change.').check()
  await card.getByRole('button',{name:'Accept change',exact:true}).click()
  await page.getByText(/Reviewed and stale proposals/).click()
  const accepted=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Rosa Morgan · Review constituent status',exact:true})})
  assert.equal(await accepted.getByText('accepted',{exact:true}).count(),1)
  await shot('accepted-change',accepted)
  await page.getByText('Record forwarded evidence',{exact:true}).click()
  await page.getByLabel('Evidence and source reference').fill('Forwarded family notice FAM-22 for director review.')
  await shot('record-evidence',page.getByRole('heading',{name:'Evidence and proposed correction',exact:true}))
 })
}
