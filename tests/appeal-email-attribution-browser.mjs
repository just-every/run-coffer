import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function emailAttributionBrowser(h, operate, provider) {
 const directory=process.env.COFFER_EMAIL_ATTRIBUTION_BROWSER
 if(directory)await mkdir(directory,{recursive:true})
 return withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const capture=async phase=>{
   if(directory)await page.screenshot({path:directory+'/'+provider+'-'+phase+'-'+page.viewportSize().width+'.png',fullPage:true})
  }
  const show=async(path,phase,check)=>{
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    await page.goto(origin+path)
    if(width===1440)await check?.()
    await capture(phase)
   }
  }
  const driver={
   async prepare(input){
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/appeals')
     const form=page.locator('form').filter({has:page.locator('input[name=command][value="appeal.prepare"]')})
     await form.getByLabel('Appeal name',{exact:true}).fill(input.name)
     await form.locator('select[name=donationCampaignId]').selectOption(input.donationCampaignId)
     await form.locator('input[name=subject]').fill(input.subject)
     await form.locator('textarea[name=body]').fill(input.body)
     await capture('preparation')
    }
    await page.setViewportSize({width:1440,height:1000})
    await page.getByRole('button',{name:'Prepare audience',exact:true}).click()
    await page.waitForURL('**/app/appeals/*')
    return new URL(page.url()).pathname.split('/').at(-1)
   },
   async review(id,phase,body){await show('/app/appeals/'+id,phase,async()=>{
    assert.ok((await page.locator('main').innerText()).includes(body))
    assert.equal(await page.getByRole('link',{name:'Open campaign giving page',exact:true}).count(),1)
   })},
   async approve(id){
    await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/appeals/'+id)
    await page.getByRole('button',{name:'Approve this audience',exact:true}).click();await page.waitForURL('**/app/appeals/'+id)
   },
   async send(id){
    await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/appeals/'+id)
    const [response]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/app/actions'),page.getByRole('button',{name:provider==='mango'?'Add recipients to Mango':'Send through Mailchimp',exact:true}).click()])
    if(response.status()!==303)assert.fail((await response.text()).match(/<p role="alert"[^>]*>(.*?)<\/p>/)?.[1]??'Submission failed')
    await page.waitForURL(url=>url.pathname==='/app/appeals/'+id)
   },
   async giving(link){const u=new URL(link);await show(u.pathname+u.search,'giving',async()=>{
    assert.equal(await page.locator('input[name=emailSource]').inputValue(),u.searchParams.get('emailSource'))
    assert.deepEqual(await page.locator('select[name=frequency] option').evaluateAll(rows=>rows.map(r=>r.value)),['once'])
    assert.equal(await page.locator('input[name=emailConsent]').isChecked(),false)
   })},
   async outcome(session){await show('/giving/thanks?session_id='+session,'giving-outcome',async()=>{assert.ok((await page.locator('main').innerText()).includes('gift has been recorded'))})},
   async reports(id){await show('/app/appeals/'+id,'response-report',async()=>{
    const text=await page.locator('main').innerText();assert.ok(text.includes('$30.00'));assert.ok(text.includes('Unknown'))
   });await show('/app/gifts/attribution?from=2026-01-01&to=2026-12-31','attribution-report',async()=>{
    const text=await page.locator('main').innerText();assert.ok(text.includes('Email'));assert.ok(text.includes('$30.00'))
   })},
  }
  try{return await operate(driver)}finally{await page.close()}
 })
}
