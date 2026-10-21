import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {donor} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
export async function pledgeBrowser(h,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   const d=await donor(h,'Taylor Pledge '+width,{email:`taylor.pledge.${width}@example.org`})
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+d.id)
   const panel=page.locator('#pledges');await panel.getByText('No pledges.',{exact:true}).waitFor()
   await panel.getByText('Record a pledge',{exact:true}).click()
   const create=panel.locator('form').filter({has:page.locator('[name=command][value="pledge.create"]')})
   await create.getByLabel('Pledge amount (USD)',{exact:true}).fill('12000')
   await create.getByLabel('Pledged on',{exact:true}).fill('2025-01-01')
   await create.getByLabel('Fund',{exact:true}).fill('Library')
   await create.locator('[name=schedule]').fill('2025-01-15 | 3000\n2025-04-15 | 3000\n2025-07-15 | 3000\n2025-10-15 | 3000')
   await create.getByRole('button',{name:'Record pledge',exact:true}).click()
   await panel.getByText('Reduce or write off this pledge',{exact:true}).click()
   await page.screenshot({path:`${directory}/GIFT-005-pledge-${width}.png`,fullPage:true})
   const reduce=panel.locator('form').filter({has:page.locator('[name=command][value="pledge.reduce"]')})
   await reduce.getByLabel('Reduction (USD)',{exact:true}).fill('1500')
   await reduce.getByLabel('Reason for reduction',{exact:true}).fill('Donor revised the library commitment.')
   await reduce.getByRole('button',{name:'Reduce pledge',exact:true}).click()
   await panel.getByText('Reduction history',{exact:true}).click()
   await panel.getByText('Donor revised the library commitment.',{exact:false}).waitFor()
   assert.ok((await panel.textContent()).includes('$10,500.00 still to come'))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/GIFT-005-reduced-${width}.png`,fullPage:true})
   await panel.getByText('Reduce or write off this pledge',{exact:true}).click()
   const off=panel.locator('form').filter({has:page.locator('[name=command][value="pledge.writeOff"]')})
   await off.getByLabel('Reason for write-off',{exact:true}).fill('Canceled at donor request.')
   await off.getByRole('button',{name:'Write off unpaid balance',exact:true}).click()
   assert.ok((await panel.textContent()).includes('$0.00 still to come'))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/GIFT-005-written-off-${width}.png`,fullPage:true})
  }
 })
}

export async function linkPledgeBrowser(h,donorId,campaignId,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+donorId)
   await page.locator('#pledges').getByText('Pay this pledge from a recurring plan',{exact:true}).click()
   const form=page.locator('#pledges form').filter({has:page.locator('[name=command][value="pledge.linkPlan"]')})
   await form.locator('select[name=subscriptionId]').selectOption('sub_pledge')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/GIFT-005-link-plan-${width}.png`,fullPage:true})
  }
  await page.getByRole('button',{name:'Link recurring plan',exact:true}).click()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.getByText('Recurring plan sub_pledge pays future gifts toward this pledge.',{exact:false}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/GIFT-005-plan-linked-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/giving/campaigns/'+campaignId)
   const pledges=page.getByRole('heading',{name:'Outstanding pledges',exact:true}).locator('..')
   assert.ok((await pledges.textContent()).includes('$4,500.00 still to come'))
   assert.ok((await pledges.textContent()).includes('$1,500.00 reduced / written off'))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/GIFT-005-campaign-report-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/donors/'+donorId)
  }
 })
}


export async function overduePledgeBrowser(h,task,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/calls?owner='+task.owner_id)
   const card=page.getByRole('heading',{name:'Synthetic Quarterly Pledge',exact:true}).locator('..')
   assert.match(await card.textContent(),/Unpaid Library pledge installment due 2030-03-09/)
   assert.match(await card.textContent(),/\$60\.00/)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/STEW-004-overdue-task-${width}.png`,fullPage:true})
  }
  await page.getByRole('heading',{name:'Synthetic Quarterly Pledge',exact:true}).locator('..').getByText('Log call and finish',{exact:true}).click()
  const form=page.locator('form').filter({has:page.locator('[name=taskId][value="'+task.id+'"]')}).filter({has:page.locator('[name=command][value="task.complete"]')})
  await form.getByLabel('Call notes',{exact:true}).fill('Synthetic overdue pledge follow-up completed.')
  await form.getByRole('button',{name:'Log call and mark done',exact:true}).click()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/donors/'+task.donor_id)
   await page.getByText('connected: Synthetic overdue pledge follow-up completed.',{exact:true}).first().waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/STEW-004-follow-up-timeline-${width}.png`,fullPage:true})
  }
 })
}
