import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function stewardshipSourcesBrowser(h,{person,draft,directory,calls}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const before=calls.length
  await page.goto(origin+'/app/agent/setup')
  const disclosure=await page.locator('main').innerText()
  assert.match(disclosure,/checked-in event records/);assert.match(disclosure,/private plain-text excerpt of up to 1,000 characters/)
  assert.equal(calls.length,before,'Opening source disclosure does not call the model')
  await page.goto(origin+'/app/agent/stewardship?donorId='+person.id)
  await page.getByRole('heading',{name:'Draft a note',exact:true}).waitFor()
  assert.match(await page.locator('main').innerText(),/10 private received-reply excerpts/)
  const card=page.locator('#draft-'+draft.id)
  await card.locator('summary').filter({hasText:'Recorded source facts'}).click()
  await card.getByRole('heading',{name:'Checked-in attendance',exact:true}).waitFor()
  await card.getByRole('heading',{name:'Received replies',exact:true}).waitFor()
  assert.match(await card.locator('aside').innerText(),/Community reading gala/)
  assert.match(await card.locator('aside').innerText(),/I enjoyed reading circle 1/)
  assert.doesNotMatch(await card.locator('aside').innerText(),/PRIVATE TAIL|Automatic private message|reading circle 2|reading circle 3/)
  assert.match(await card.locator('.cf-source-facts').innerText(),/1,000 characters/)
  assert.match(await card.getByRole('list').first().innerText(),/Event attendance/)
  assert.match(await card.getByRole('list').first().innerText(),/Received reply/)
  const visibleText=await card.locator('p,li,h3,h4,summary,label,input,textarea,button').evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>Number.parseFloat(getComputedStyle(el).fontSize)))
  assert.ok(visibleText.every(size=>size>=13),'Source review text is at least 13px')
  for(const control of await page.locator('a,button').all()){
   if(!await control.isVisible())continue
   const info=await control.evaluate(el=>({text:el.innerText.trim(),tip:el.querySelector('[role="tooltip"]')?.textContent?.trim()}))
   if(info.text&&!info.tip)continue
   assert.ok(info.tip,'An icon-only control has a tooltip')
   await control.focus();assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
   await control.hover();await page.waitForTimeout(350);assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
  }
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.evaluate(()=>scrollTo(0,0))
   await page.screenshot({path:`${directory}/DEV-004-source-review-${width}.png`,fullPage:true})
  }
  assert.equal(calls.length,before,'Reading sources never submits donor data or mail')
 })
}
