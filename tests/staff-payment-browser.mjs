import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function staffPaymentBrowser(h,{person,campaign,appeal,sourceRef,headers,directory,portal}){
 if(directory)await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders(headers)
  await context.addCookies(portal.cookie.split('; ').map(value=>{const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}}))
  const page=await context.newPage()
  const proof=async name=>{
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Payment screen fits the desktop viewport')
   if(directory){
    await page.screenshot({path:`${directory}/${name}-1440.png`,fullPage:true})
    await page.setViewportSize({width:390,height:1000})
    await page.screenshot({path:`${directory}/${name}-390.png`,fullPage:true})
    await page.setViewportSize({width:1440,height:1000})
   }
  }
  await page.goto(origin+'/giving/portal/saved-card?scope=once')
  assert.match(await page.locator('main').innerText(),/permission.*granted/s)
  assert.match(await page.locator('main').innerText(),/one-time gift/)
  await proof('staff-card-permission')
  await page.goto(origin+'/app/donors/'+person.id)
  await page.getByRole('link',{name:'Charge an authorized saved card',exact:true}).click()
  await page.getByLabel('Immediate gift amount (USD)',{exact:true}).fill('100')
  await page.getByLabel('Campaign and fund',{exact:true}).selectOption(campaign.id)
  await page.getByLabel('Defined appeal',{exact:true}).selectOption(appeal)
  await page.getByLabel('Recorded authorization evidence',{exact:true}).selectOption(sourceRef)
  await proof('staff-payment-entry')
  await page.getByRole('button',{name:'Review immediate charge',exact:true}).click()
  await page.getByRole('heading',{name:'Confirm the immediate charge',exact:true}).waitFor()
  assert.match(await page.locator('main').innerText(),/\$100\.00/)
  assert.match(await page.locator('main').innerText(),/Reading/)
  await page.getByRole('checkbox',{name:/I verified the recorded authorization/}).check()
  await proof('staff-payment-review')
  await page.getByRole('button',{name:'Charge $100.00 now',exact:true}).click()
  await page.getByRole('status').waitFor()
  assert.match(await page.getByRole('status').innerText(),/gift and actual processing fee are recorded/)
  await proof('staff-payment-outcome')
 })
}
