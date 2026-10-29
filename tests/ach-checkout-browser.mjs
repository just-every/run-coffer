import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function achBrowser(h,edge,item,{campaign,known,stage,input}){
 const directory=process.env.COFFER_ACH_BROWSER??'.cache/ach-checkout'
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  await context.route('https://checkout.stripe.com/**',route=>route.fulfill({contentType:'text/plain',body:'Synthetic provider boundary'}))
  const widths=process.env.COFFER_ACH_PROOF==='1'?[1440,390]:[1440]
  const capture=async name=>{
   for(const width of widths){
    await page.setViewportSize({width,height:1000})
    await page.evaluate(async()=>{
     await document.fonts.ready
     for(let y=0;y<document.documentElement.scrollHeight;y+=innerHeight){scrollTo(0,y);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))}
     scrollTo(0,0)
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    })
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits '+width)
    await page.screenshot({path:`${directory}/ACH-${name}-${width}.png`,fullPage:true,timeout:60000})
   }
   await page.setViewportSize({width:1440,height:1000})
  }
  if(stage==='pending'){
   await page.goto(origin+'/give/'+campaign.slug)
   await page.getByLabel('Payment method',{exact:true}).selectOption('us_bank_account')
   await page.locator('[name=requestId]').evaluate((element,value)=>element.value=value,input.requestId)
   await page.getByLabel('Full name',{exact:true}).fill(input.name)
   await page.getByLabel('Email address',{exact:true}).fill(input.email)
   await page.locator('[name=amount]').fill('100.00');await page.locator('[name=feeCover]').check()
   await page.locator('[name=wallOptIn]').check();await page.locator('[name=recognitionName]').fill(input.recognitionName)
   await page.locator('[name="cf-turnstile-response"]').waitFor({state:'attached'})
   assert.match(await page.locator('#fee-cover-total').textContent(),/103\.30/)
   assert.equal(await page.locator('input[name*=account],input[name*=routing],input[name*=card]').count(),0)
   await capture('form')
   const before=edge.state.sessions.size
   await page.getByRole('button',{name:'Continue to secure checkout'}).click()
   await page.waitForURL('https://checkout.stripe.com/**');assert.ok(page.url().includes(item.session.id))
   assert.equal(edge.state.sessions.size,before,'Browser retries reuse the frozen checkout')
  }
  await page.goto(origin+'/giving/thanks?session_id='+item.session.id)
  await page.getByRole('heading',{name:stage==='pending'?'Payment is still processing':stage==='settled'?'Thank you for your gift':'Bank payment returned',exact:true}).waitFor()
  await capture(stage)
  if(stage==='settled'){
   await page.goto(origin+'/app/donors/'+known.id)
   assert.match(await page.locator('body').innerText(),/bank transfer/i)
   await capture('bank-gift')
  }
  if(stage==='returned'){
   await page.goto(origin+'/app/calls')
   assert.match(await page.locator('body').innerText(),/R01/)
   await capture('return-task')
  }
 })
}
