import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function eventsBrowser(h,{event,registration,guest,campaign,letter,directory,sessions}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const network=await context.newCDPSession(page);await network.send('Network.enable');await network.send('Network.setBlockedURLs',{urls:['https://checkout.stripe.com/*']})
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:1000})
   const shot=async name=>{
    for(const control of await page.locator('a,button').all()){
     if(!await control.isVisible())continue
     const info=await control.evaluate(el=>({text:el.innerText.trim(),tip:el.querySelector('[role="tooltip"]')?.textContent?.trim()}))
     if(info.text&&!info.tip)continue
     assert.ok(info.tip,'Icon controls have a tooltip')
     await control.focus();assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
     await control.hover();await page.waitForTimeout(350);assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/CAMP-002-${name}-${width}.png`,fullPage:true})}
   await page.goto(origin+'/app/giving');await shot('giving')
   await page.getByRole('link',{name:'Fundraising events',exact:true}).click();await shot('events')
   await page.getByLabel('Event name',{exact:true}).fill('Community gala '+width)
   await page.getByLabel('Page address',{exact:true}).fill('community-gala-'+width)
   await page.getByLabel('Event date',{exact:true}).fill('2026-10-17')
   await page.getByLabel('Campaign',{exact:true}).selectOption(campaign.id)
   await page.getByLabel('Defined appeal',{exact:true}).selectOption('GALA26')
   await page.getByRole('button',{name:'Create event',exact:true}).click()
   await page.getByLabel('Ticket name',{exact:true}).fill('Gala dinner')
   await page.getByLabel('Ticket price (USD)',{exact:true}).fill('150')
   await page.getByLabel('Benefit value (USD)',{exact:true}).fill('60')
   await page.getByLabel('Benefit description',{exact:true}).fill('Gala dinner')
   await page.getByRole('button',{name:'Add ticket type',exact:true}).click();await shot('tickets')
   await page.getByRole('link',{name:'Hosted registration',exact:true}).click()
   await page.getByLabel('Attendee name',{exact:true}).fill(width===1440?'Sofia Chen':'Daniel Brooks')
   await page.getByLabel('Email',{exact:true}).fill(`synthetic-coffer-gala-${width}@example.test`)
   await page.getByLabel('Ticket type',{exact:true}).selectOption({label:'Gala dinner · $150.00 ($60.00 benefit)'})
   await shot('registration')
   const submitted=page.waitForResponse(r=>r.url().endsWith('/checkout')&&r.request().method()==='POST')
   await page.getByRole('button',{name:'Register with Stripe',exact:true}).click()
   const result=await submitted;assert.equal(result.status(),303,result.status()===303?'Secure checkout redirect':await result.text())
   assert.match(result.headers()['location'],/^https:\/\/checkout\.stripe\.com\//)
   const latest=[...sessions.keys()].at(-1);await page.goto(origin+'/giving/thanks?session_id='+latest)
   await page.getByRole('heading',{name:'Thank you for your gift',exact:true}).waitFor();await shot('paid')
   await page.goto(origin+'/app/events/'+event.id)
   if(width===390){await page.getByRole('button',{name:'Check in Maya Rivera',exact:true}).click();await page.getByRole('status').getByText('Checked in',{exact:true}).waitFor()}
   await shot('guest-list')
   await page.goto(origin+'/app/letters/'+letter.batch_id);await page.getByText(/\$90\.00 may be deductible/).first().waitFor();await shot('receipt')
   await page.goto(origin+'/app/donors/'+guest.id+'?timelineKind=event')
   {await page.locator('#timeline').getByText('Checked in to event',{exact:true}).waitFor();await page.locator('#engagement').getByText('1 checked-in registrations → 20/100',{exact:true}).waitFor()}
   await shot('donor')
   for(const part of ['timeline','engagement'])await page.locator('#'+part).screenshot({path:`${directory}/CAMP-002-${part}-${width}.png`})
   await page.goto(origin+'/app/engagement');await page.getByLabel('Event attendance weight',{exact:true}).fill('100');await page.getByRole('button',{name:'Save score weights',exact:true}).click();await shot('weights')
  }
 })
}
