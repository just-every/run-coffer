import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function callPrioritiesBrowser(h,data,directory){
 await mkdir(directory,{recursive:true})
 return withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({'x-test-now':data.now})
  const page=await context.newPage()
  const shot=async(name,focus)=>{for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   if(focus)await focus.scrollIntoViewIfNeeded();else await page.evaluate(()=>scrollTo(0,0))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits '+width)
   assert.deepEqual(await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!(n.innerText||'').trim()).map(n=>n.outerHTML.slice(0,180))),[],'All controls have visible text')
   await page.screenshot({path:`${directory}/DEV-005-${name}-${width}.png`})
  }await page.setViewportSize({width:1440,height:1000})}
  if(data.stage==='rank'){
   await page.goto(origin+'/app/settings')
   const capacity=page.getByLabel('Weekly call capacity for jordan',{exact:true})
   await capacity.fill('5');await capacity.blur()
   await capacity.locator('xpath=ancestor::form').getByRole('status').filter({hasText:'Saved'}).waitFor()
   await shot('manager-capacity',page.locator('#task-team'))
   const days=page.getByLabel('Days after a call to observe giving',{exact:true})
   await days.fill('1');await days.blur()
   await days.locator('xpath=ancestor::form').getByRole('status').filter({hasText:'Saved'}).waitFor()
   await shot('outcome-window',page.locator('#call-priorities'))
   await page.goto(origin+'/app/agent')
   await shot('agent-overview')
   await page.getByRole('link',{name:'Call priorities',exact:true}).last().click()
   await page.getByLabel('Relationship manager',{exact:true}).selectOption(data.manager.id)
   await page.getByRole('button',{name:'Open weekly list',exact:true}).click()
   await page.getByRole('button',{name:'Rank this week’s calls',exact:true}).click()
   await page.getByText('5 assigned · Capacity 5',{exact:true}).waitFor()
   await page.getByText('Overflow (3)',{exact:true}).waitFor()
   await shot('ranked-calls')
   const restricted=page.locator('li').filter({has:page.getByRole('link',{name:'Rosa Morgan',exact:true})})
   await restricted.getByText('Thank-you only',{exact:true}).waitFor()
   await shot('restricted-thank-you',restricted)
   return h.get('/api/coffer/agent/calls?managerId='+data.manager.id,{headers:{'x-test-now':data.now}})
  }
  if(data.stage==='complete'){
   for(const row of data.called){
    await page.goto(origin+'/app/calls?owner='+data.manager.id+'&status=all')
    const card=page.locator('section.card').filter({has:page.getByRole('heading',{name:row.donor_name,exact:true})}).last()
    await card.locator('summary').filter({hasText:/^Complete task$/}).click()
    await card.getByLabel('Call outcome').selectOption('connected')
    await card.getByLabel('Completion notes').fill('Discussed the reading-room renewal and answered questions.')
    if(row===data.called[0])await shot('log-call',card)
    await card.getByRole('button',{name:'Complete task',exact:true}).click()
   }
   await page.goto(origin+'/app/agent/calls?managerId='+data.manager.id+'&runId='+data.runId)
   await shot('pending-outcomes',page.locator('#call-outcomes'))
  }
  if(data.stage==='outcomes'){
   await page.goto(origin+'/app/agent/calls?managerId='+data.manager.id+'&runId='+data.runId)
   await page.getByText('Called: 66.7%',{exact:true}).waitFor()
   await page.getByText('Listed without a call: 40%',{exact:true}).waitFor()
   await shot('closed-outcomes',page.locator('#call-outcomes'))
   await page.getByText('How outcomes are measured',{exact:true}).click()
   await shot('outcome-definition',page.locator('#call-outcomes details'))
  }
 })
}
