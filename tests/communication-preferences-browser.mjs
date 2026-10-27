import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function communicationPreferencesBrowser(h,cookie,donorId,owner,newsletterId,directory='.cache/communication-preferences'){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const staffPage=await context.newPage()
  for(const width of [1440,390]){
   await staffPage.setViewportSize({width,height:1000})
   await staffPage.goto(origin+'/app/donors/'+donorId)
   const preferences=staffPage.locator('#communication-preferences');await preferences.locator('summary').first().click()
   assert.ok(await staffPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await preferences.screenshot({path:`${directory}/COMM-001-staff-${width}.png`})
   await staffPage.goto(origin+'/app/agent/calls?managerId='+owner)
   assert.match(await staffPage.locator('main').innerText(),/topic: 1/)
   await staffPage.screenshot({path:`${directory}/COMM-001-weekly-calls-${width}.png`,fullPage:true})
   await staffPage.goto(origin+'/app/appeals/'+newsletterId)
   assert.match(await staffPage.locator('main').innerText(),/Newsletter topic/);assert.match(await staffPage.locator('main').innerText(),/Newsletter · no ask/)
   await staffPage.screenshot({path:`${directory}/COMM-001-postal-newsletter-${width}.png`,fullPage:true})
   await staffPage.goto(origin+'/app/settings')
   await staffPage.locator('#email-topic-mappings').screenshot({path:`${directory}/COMM-001-mappings-${width}.png`})
   await staffPage.locator('#constant-contact-preferences').screenshot({path:`${directory}/COMM-001-provider-${width}.png`})
  }
  await staffPage.goto(origin+'/app/settings')
  await staffPage.getByRole('button',{name:'Disconnect preference checks',exact:true}).click()
  await staffPage.getByRole('button',{name:'Connect preferences',exact:true}).waitFor()
  for(const width of [1440,390]){await staffPage.setViewportSize({width,height:1000});await staffPage.locator('#constant-contact-preferences').screenshot({path:`${directory}/COMM-001-provider-disconnected-${width}.png`})}
  await staffPage.close()
  await context.addCookies(cookie.split('; ').map(value=>{const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),domain:'127.0.0.1',path:'/',httpOnly:true,secure:true,sameSite:'Lax'}}))
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/giving/portal/communications')
   await page.getByRole('heading',{name:'Communication preferences',exact:true}).waitFor()
   const panel=page.getByRole('heading',{name:'Topics and appeal frequency',exact:true}).locator('..')
   const email=panel.locator('details').filter({has:page.locator('input[name=channel][value=email]')});await email.locator('summary').click()
   await email.locator('select[name=frequency]').selectOption('quarterly');await email.locator('input[name=confirm]').check()
   await page.screenshot({path:`${directory}/COMM-001-portal-${width}.png`,fullPage:true})
   await email.getByRole('button',{name:'Save email preferences',exact:true}).click();await page.waitForURL('**/giving/portal/communications?saved=1')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Portal has no horizontal overflow')
   await page.getByRole('status').waitFor();await page.screenshot({path:`${directory}/COMM-001-saved-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}
