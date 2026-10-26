import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

async function shot(page,directory,name,width){
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Event package forms fit the viewport')
 for(const control of await page.locator('a,button').all()){
  if(!await control.isVisible())continue
  const info=await control.evaluate(el=>({text:el.innerText.trim(),tip:el.querySelector('[role="tooltip"]')?.textContent?.trim()}))
  if(info.text&&!info.tip)continue
  assert.ok(info.tip,'Icon controls have a tooltip')
  await control.focus();assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
  await control.hover();await page.waitForTimeout(350);assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
 }
 await page.screenshot({path:`${directory}/CAMP-002-${name}-${width}.png`,fullPage:true})
}
export async function packageRegistrationBrowser(h,{event,table,sponsor,buyer,guest,directory}){
 await mkdir(directory,{recursive:true})
 for(const [key,label,type] of [['gala_access','Access arrangements','checkbox'],['gala_song','Program suggestion','text']])await h.command('custom.define',{key,label,kind:'constituent',type,entry:'free-form'})
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const network=await context.newCDPSession(page);await network.send('Network.enable');await network.send('Network.setBlockedURLs',{urls:['https://checkout.stripe.com/*']})
  let requestId=''
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/events/'+event.id)
   await page.getByLabel('Ticket name',{exact:true}).fill('Community table '+width)
   await page.getByLabel('Ticket kind',{exact:true}).selectOption('table');await page.getByLabel('Guest seats',{exact:true}).fill('2')
   await page.getByLabel('Ticket price (USD)',{exact:true}).fill('2000');await page.getByLabel('Benefit value (USD)',{exact:true}).fill('400');await page.getByLabel('Benefit description',{exact:true}).fill('Two gala places')
   await shot(page,directory,'package-settings',width)
   await page.getByRole('button',{name:'Add ticket type',exact:true}).click()
   await page.getByLabel('Question shown to guests',{exact:true}).fill(width===1440?'Access arrangements':'Program suggestion')
   await page.getByLabel('Constituent custom field',{exact:true}).selectOption(width===1440?'gala_access':'gala_song')
   await page.getByRole('button',{name:'Add mapped question',exact:true}).click();await shot(page,directory,'mapped-questions',width)
   await page.goto(origin+'/giving/events/'+event.slug+'?ticketId='+sponsor.id);await shot(page,directory,'sponsor-registration',width)
   await page.getByLabel('Ticket or package',{exact:true}).selectOption(table.id);await page.getByRole('button',{name:'Continue to registration',exact:true}).click()
   await page.getByLabel('Purchaser name',{exact:true}).fill(buyer.name);await page.getByLabel('Email',{exact:true}).fill(buyer.email)
   for(const [n,person,note,meal,count] of [[1,buyer,'Nut allergy','Standard','2'],[2,guest,'Gluten free','Vegetarian','3']]){
    await page.getByLabel(`Guest ${n} name`,{exact:true}).fill(person.name);await page.getByLabel(`Guest ${n} email`,{exact:true}).fill(person.email);await page.getByLabel(`Guest ${n} dietary notes`,{exact:true}).fill(note)
    await page.getByLabel(`Guest ${n}: Meal preference`,{exact:true}).selectOption(meal);await page.getByLabel(`Guest ${n}: Reading sessions planned`,{exact:true}).fill(count)
   }
   await page.getByLabel('Guest 1 is the purchaser',{exact:true}).check();requestId=await page.locator('[name="requestId"]').inputValue()
   await shot(page,directory,'table-registration',width)
  }
  const submitted=page.waitForResponse(r=>r.url().endsWith('/checkout')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Register with Stripe',exact:true}).click();const response=await submitted;assert.equal(response.status(),303,await response.text());assert.match(response.headers().location,/^https:\/\/checkout\.stripe\.com\//)
  return requestId
 })
}
export async function packageStaffBrowser(h,{event,guest,registration,directory}){
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/events/'+event.id);await shot(page,directory,'private-package-guests',width)}
  await page.getByRole('button',{name:'Check in '+guest.name,exact:true}).click()
  const row=page.locator('.list > li').filter({has:page.getByRole('heading',{name:guest.name,exact:true})})
  await row.getByText('Review guest and answers',{exact:true}).click();await row.getByLabel('Find donor for '+guest.name,{exact:true}).fill(guest.email);await row.getByRole('button',{name:'Find guest donor',exact:true}).click()
  const review=page.locator('form').filter({has:page.getByRole('button',{name:`Accept guest ${guest.name} as ${guest.name}`,exact:true})})
  await review.getByLabel('I reviewed this guest identity and the submitted answers',{exact:true}).check();await shot(page,directory,'guest-match-review',390)
  await review.getByRole('button',{name:`Accept guest ${guest.name} as ${guest.name}`,exact:true}).click()
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/events/'+event.id);await shot(page,directory,'guest-reviewed',width);await page.goto(origin+'/app/donors/'+guest.id+'?timelineKind=event');await shot(page,directory,'package-guest-timeline',width)}
 })
}
