import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function teamAccessBrowser(h,{member,donor},directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const shot=async(name)=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits 1440')
    assert.deepEqual(await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!(n.innerText||'').trim()).map(n=>n.outerHTML)),[],'All changed controls have visible labels')
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    await page.screenshot({path:`${directory}/TEAM-001-${name}-${width}.png`,fullPage:true})
   }
   await page.setViewportSize({width:1440,height:1000})
  }
  await page.goto(origin+'/app/settings/team-access')
  const memberCard=page.locator('section.card').filter({has:page.getByRole('heading',{name:'synthetic-coffer-1',exact:true})}).last()
  await memberCard.getByLabel('Coffer access').selectOption('1')
  await memberCard.getByRole('button',{name:'Save member access'}).click()
  await page.reload()
  assert.equal(await page.locator('select[name=readOnly]').first().inputValue(),'1')
  await shot('assignment')
  await context.clearCookies()
  await context.addCookies(member.cookie.split('; ').map(value=>{const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),domain:'127.0.0.1',path:'/',httpOnly:true,secure:true,sameSite:'Lax'}}))
  await page.goto(origin+'/app/donors/'+donor.id)
  await page.getByRole('heading',{name:donor.name,exact:false}).count()
  await page.getByText('Ordinary timeline fact',{exact:true}).waitFor()
  assert.equal(await page.getByText('Private research fact',{exact:true}).count(),0)
  assert.equal(await page.getByRole('link',{name:'Record gift',exact:true}).count(),0)
  await shot('constituent')
  for(const path of ['gifts','pledges','tasks','opportunities']){
   await page.goto(origin+'/app/'+path)
   await page.getByRole('status').filter({hasText:'Read-only access'}).waitFor()
   assert.ok((await page.locator('main .list li').allTextContents()).some(text=>text.includes(donor.name)),'Seeded '+path+' is visible')
   await shot(path)
  }
  const refused=await page.goto(origin+'/app/settings/team-access')
  assert.equal(refused.status(),403)
  await shot('refusal')
 })
}
