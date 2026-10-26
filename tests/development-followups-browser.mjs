import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function developmentFollowupsBrowser(h,{stage,now},directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({'x-test-now':now})
  const page=await context.newPage()
  const shot=async(name,focus)=>{for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   if(focus)await focus.scrollIntoViewIfNeeded();else await page.evaluate(()=>scrollTo(0,0))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits '+width)
   const icons=await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!(n.innerText||'').trim()).map(n=>n.outerHTML.slice(0,180)))
   assert.deepEqual(icons,[],'Changed screens give controls visible text')
   await page.screenshot({path:`${directory}/DEV-010-${name}-${width}.png`,fullPage:false})
  }await page.setViewportSize({width:1440,height:1000})}
  if(stage==='approve'){
   await page.goto(origin+'/app/agent')
   await shot('agent-overview')
   await page.getByRole('link',{name:'Commitments',exact:true}).click()
   await page.getByRole('button',{name:'Run follow-ups',exact:true}).click()
   await shot('prepared-reminders')
   for(const name of ['Rosa Morgan','Riverbend Foundation','Riverbend Industries']){
    const card=page.locator('section.card').filter({has:page.getByRole('heading',{name,exact:true})})
    await card.getByText('Review and approve reminder',{exact:true}).click()
    await card.getByLabel('Approval authority and purpose').fill('Owner reviewed this existing commitment and authorizes this exact reminder.')
    await shot('approve-'+name.split(' ').at(-1).toLowerCase(),card)
    await card.getByRole('button',{name:'Approve this exact reminder',exact:true}).click()
   }
   await page.getByRole('button',{name:'Run follow-ups',exact:true}).click()
   assert.equal(await page.getByText('Reminder submitted',{exact:true}).count(),3)
   await shot('submitted-reminders')
  }else{
   await page.goto(origin+'/app/agent/followups')
   assert.equal(await page.getByRole('link',{name:'View relationship manager escalation',exact:true}).count(),3)
   await shot('relationship-escalations')
   for(const [name,resolution,note] of [['Rosa Morgan','paid','Pledge check matched to installment.'],['Riverbend Foundation','revised','Director approved the revised report deadline with the funder.'],['Riverbend Industries','written_off','Employer declined this match; owner recorded the reason.']]){
    const card=page.locator('section.card').filter({has:page.getByRole('heading',{name,exact:true})})
    await card.getByText('Record resolution',{exact:true}).click()
    await card.getByLabel('Resolution',{exact:true}).selectOption(resolution)
    await card.getByLabel('Resolution evidence, approval or write-off reason').fill(note)
    if(resolution==='revised'){
     await card.getByText('Approve a revised deadline',{exact:true}).click()
     await card.getByLabel('New deadline',{exact:true}).fill('2026-11-06')
     await card.getByLabel('I approve this change to the source deadline.').check()
    }
    await shot('resolve-'+resolution,card)
    await card.getByRole('button',{name:'Record resolution',exact:true}).click()
   }
   await page.getByText('Resolved follow-ups (3)',{exact:true}).click()
   for(const name of ['Rosa Morgan','Riverbend Foundation','Riverbend Industries'])await shot('resolved-'+name.split(' ').at(-1).toLowerCase(),page.locator('section.card').filter({has:page.getByRole('heading',{name,exact:true})}))
  }
 })
}
