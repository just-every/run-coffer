import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function taskRemindersBrowser(h,data,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  let now=data.now
  await context.setExtraHTTPHeaders({'x-test-now':now})
  const page=await context.newPage()
  const as=async person=>{await context.clearCookies();await context.addCookies((person?.cookie??h.owner).split('; ').map(v=>{const i=v.indexOf('=');return {name:v.slice(0,i),value:v.slice(i+1),domain:'127.0.0.1',path:'/',httpOnly:true,secure:true,sameSite:'Lax'}}))}
  const shot=async(name,focus)=>{for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   if(focus)await focus.scrollIntoViewIfNeeded();else await page.evaluate(()=>scrollTo(0,0))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits '+width)
   const icons=await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()&&!(n.innerText||'').trim()).map(n=>n.outerHTML.slice(0,180)))
   assert.deepEqual(icons,[],'Changed screens use visible text for every control')
   await page.screenshot({path:`${directory}/STEW-001-${name}-${width}.png`,fullPage:false})
  }await page.setViewportSize({width:1440,height:1000})}
  await page.goto(origin+'/app/settings')
  const team=page.locator('#task-team')
  await team.getByLabel('Manager for casey',{exact:true}).selectOption(data.manager.id)
  await team.locator('li').filter({has:page.getByText('casey',{exact:true})}).getByRole('status').filter({hasText:'Saved'}).waitFor()
  await shot('team-managers',page.locator('#task-team'))
  await shot('escalation-delay',page.locator('#task-settings'))
  await as(data.assignee)
  await page.goto(origin+'/app/calls')
  await page.getByText('Assign a task',{exact:true}).click()
  const create=page.locator('form').filter({has:page.getByRole('button',{name:'Assign task',exact:true})})
  await create.getByLabel('Constituent',{exact:true}).selectOption(data.d.id)
  await create.getByLabel('Task title',{exact:true}).fill('Send Rosa a personal library thank-you')
  await create.getByLabel('Task kind',{exact:true}).selectOption('thank_you')
  await create.getByLabel('Due date',{exact:true}).fill('2026-10-27')
  await shot('assign-thank-you',create)
  await create.getByRole('button',{name:'Assign task',exact:true}).click()
  await data.tick()
  await page.goto(origin+'/app/calls')
  await page.getByRole('heading',{name:'Your daily reminders'}).waitFor()
  await shot('received-reminder')
  const task=page.locator('section.card').filter({has:page.getByText('Thank Rosa for the reading-room gift',{exact:true})}).last()
  await task.getByText('Complete task',{exact:true}).click()
  await task.getByLabel('Call outcome').selectOption('connected')
  await task.getByLabel('Completion notes').fill('Rosa appreciated the update and asked for the library photos.')
  await task.getByRole('button',{name:'Complete task',exact:true}).click()
  await page.goto(origin+'/app/donors/'+data.d.id)
  await page.locator('#timeline').getByText('connected: Rosa appreciated the update and asked for the library photos.',{exact:true}).waitFor()
  await shot('completed-timeline',page.locator('#timeline'))
  now='2026-10-28T12:00:00Z';data.setNow(now);await context.setExtraHTTPHeaders({'x-test-now':now});await data.tick()
  await as(data.manager)
  await page.goto(origin+'/app/calls')
  await page.getByText('Escalated to you',{exact:true}).waitFor()
  await shot('manager-escalation')
  await as(null)
  await page.goto(origin+'/app/calls')
  await page.getByText('Escalated to you',{exact:true}).waitFor()
  await page.getByText('Correct the returned address',{exact:true}).last().waitFor()
  await shot('owner-escalation')
 })
}
