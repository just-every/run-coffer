import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function calendarsBrowser(h,{directory,donorId,configure,book,calendarEvent}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const formFor=command=>page.locator('form').filter({has:page.locator(`[name=command][value="${command}"]`)})
  const fit=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Calendar screen fits its viewport')
  const iconControls=async()=>{
   const unlabeled=await page.locator('button,a,[role=button]').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&!node.textContent.trim()&&node.querySelector('svg')&&!node.getAttribute('aria-label')).length)
   assert.equal(unlabeled,0,'Touched screens have no unnamed icon-only controls')
  }
  await page.setViewportSize({width:1440,height:1000})
  await page.goto(origin+'/app/settings#calendar-settings')
  const settings=page.locator('#calendar-settings')
  await settings.getByText('Google application',{exact:true}).click()
  const google=formFor('calendar.configure')
  await google.locator('[name=clientId]').fill(configure.clientId);await google.locator('[name=clientSecret]').fill(configure.clientSecret);await google.locator('[name=confirm]').check();await google.getByRole('button').click()
  await settings.getByText('Calendly booking intake',{exact:true}).click()
  const booking=formFor('booking.configure')
  await booking.locator('[name=bookingUrl]').fill(book.bookingUrl);await booking.locator('[name=eventType]').fill(book.eventType);await booking.locator('[name=signingKey]').fill(book.signingKey);await booking.locator('[name=confirm]').check();await booking.getByRole('button').click()
  await context.route('https://accounts.google.com/o/oauth2/v2/auth**',async route=>{
   const url=new URL(route.request().url()),query=new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-coffer-6'})
   await route.fulfill({status:303,headers:{location:origin+'/app/calendar/google/callback?'+query}})
  })
  const connect=formFor('calendar.start');await connect.locator('[name=confirm]').check();await connect.getByRole('button').click()
  const proceed=page.getByRole('link',{name:'Continue to Google',exact:true});await proceed.waitFor()
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await fit();await page.locator('main').screenshot({path:`${directory}/STEW-006-google-consent-${width}.png`})}
  await proceed.click()
  await page.getByRole('button',{name:'Disconnect my calendar',exact:true}).waitFor()
  assert.equal((await h.get('/api/coffer/calendar')).connected,true,'Settings connect the current staff calendar through OAuth')
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/settings#calendar-settings')
   await settings.getByText('Google application',{exact:true}).click()
   await settings.getByText('Calendly booking intake',{exact:true}).click()
   await settings.scrollIntoViewIfNeeded();await fit();await iconControls()
   await settings.screenshot({path:`${directory}/STEW-006-settings-${width}.png`})
   await page.goto(origin+'/app/donors/'+donorId+'#meetings')
   const meetings=page.locator('#meetings')
   await meetings.getByText('Calendar and scheduling links',{exact:true}).click()
   await meetings.getByRole('link',{name:'Choose a meeting from my Google Calendar'}).click()
   await page.getByRole('heading',{name:'Choose a meeting',exact:true}).waitFor()
   await page.getByText(calendarEvent.summary,{exact:true}).waitFor();await fit();await iconControls()
   await page.locator('main').screenshot({path:`${directory}/STEW-006-calendar-${width}.png`})
   const log=formFor('calendar.log').first();await log.locator('[name=confirm]').check();await log.getByRole('button').click()
   assert.equal((await h.get('/api/coffer/meetings')).filter(m=>m.source==='google'&&m.source_operator_id!=='').length,2,'Chosen calendar meeting persists, with replay leaving one record per connected staff member')
   await meetings.getByText('Calendar and scheduling links',{exact:true}).click()
   const link=formFor('booking.link');await link.locator('[name=confirm]').check();await link.getByRole('button').click()
   await meetings.getByText('Calendar and scheduling links',{exact:true}).click()
   const share=meetings.getByRole('link',{name:'Open donor booking link'}).first(),href=await share.getAttribute('href')
   assert.equal(new URL(href).origin,'https://calendly.com');assert.ok(new URL(href).searchParams.get('utm_content'))
   await meetings.scrollIntoViewIfNeeded();await fit();await iconControls()
   await meetings.screenshot({path:`${directory}/STEW-006-meetings-${width}.png`})
   await page.goto(origin+'/app/donors/'+donorId+'?timelineKind=meeting#timeline')
   await page.getByText('Calendly meeting',{exact:true}).waitFor();await page.getByText('Google Calendar meeting',{exact:true}).first().waitFor();await fit()
   const activity=page.locator('#timeline');await activity.screenshot({path:`${directory}/STEW-006-timeline-${width}.png`})
  }
  await page.close()
 })
}
