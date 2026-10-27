import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function recoveryNoticesBrowser(h,{directory,phase='notices'}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440]) {
   await page.setViewportSize({width,height:1100})
   await page.goto(origin+'/app/agent/recovery')
   await page.getByRole('heading',{name:'Recovery notice approval',exact:true}).waitFor()
   if(phase==='uncertain-sequence'){
    await page.getByText('Submission uncertain',{exact:true}).waitFor()
    await page.getByText('An earlier recovery submission is uncertain; a person must investigate',{exact:false}).waitFor()
    assert.equal(await page.getByText('Accepted by mail provider',{exact:true}).count(),1)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`${directory}/GIVE-010-${phase}-${width}.png`,fullPage:true});await page.setViewportSize({width:390,height:1100});await page.screenshot({path:`${directory}/GIVE-010-${phase}-390.png`,fullPage:true})
    continue
   }
   if(phase==='no-implicit-lead'){
    await page.getByText('Not yet designated',{exact:true}).waitFor()
    assert.equal(await page.locator('input[name=developmentLead]').isChecked(),false)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`${directory}/DEV-002-${phase}-${width}.png`,fullPage:true});await page.setViewportSize({width:390,height:1100});await page.screenshot({path:`${directory}/DEV-002-${phase}-390.png`,fullPage:true})
    continue
   }
   await page.getByText('Waiting for development-lead approval',{exact:true}).waitFor()
   assert.equal(await page.getByText('Accepted by mail provider',{exact:true}).count(),2)
   await page.getByRole('button',{name:'Approve this notice',exact:true}).waitFor()
   const record=page.getByText('Record donor permission',{exact:true});await record.click()
   await page.getByLabel('Evidence of the donor’s recovery-contact permission',{exact:true}).first().waitFor()
   await page.getByRole('combobox',{name:/^Permitted channel/}).first().selectOption('phone')
   assert.equal(await page.getByRole('combobox',{name:/^Permitted channel/}).first().inputValue(),'phone')
   await record.click()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Recovery notice review fits '+width)
   await page.evaluate(()=>scrollTo(0,0))
   await page.screenshot({path:`${directory}/DEV-002-recovery-notices-${width}.png`,fullPage:true});await page.setViewportSize({width:390,height:1100});await page.screenshot({path:`${directory}/DEV-002-recovery-notices-390.png`,fullPage:true})
  }
  await page.close()
 })
}

export async function investigatedRecoveryBrowser(h,{directory,stepId,finding,reason,actorCookie,capture=true,phase='investigation'}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  if(actorCookie){await context.clearCookies();await context.addCookies(actorCookie.split('; ').map(value=>{const at=value.indexOf('=');return {name:value.slice(0,at),value:value.slice(at+1),domain:'127.0.0.1',path:'/',httpOnly:true,secure:true,sameSite:'Lax'}}))}
  const page=await context.newPage()
  await page.goto(origin+'/app/agent/recovery')
  const card=page.locator(`[data-notice-id="${stepId}"]`)
  if(phase==='investigation'){
   await card.getByLabel('Investigation finding (still unknown is valid)',{exact:true}).fill(finding)
   await card.getByLabel('Why stop further recovery contact for this plan?',{exact:true}).fill(reason)
   await card.getByRole('button',{name:'Close recovery contact',exact:true}).click()
   await card.getByText('Investigated closure',{exact:false}).waitFor()
   assert.ok((await card.innerText()).includes(finding))
   assert.ok((await card.innerText()).includes(reason))
   assert.equal(await card.getByRole('button',{name:'Close recovery contact',exact:true}).count(),0)
   assert.ok(await page.getByText('An earlier recovery submission is uncertain; a person must investigate',{exact:false}).count()>0)
  }else{
   assert.equal(await page.getByText('Accepted by mail provider',{exact:true}).count(),2)
   assert.equal(await page.getByText('Submission uncertain',{exact:true}).count(),2)
   assert.equal(await page.getByText('Investigated closure',{exact:false}).count(),2)
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  if(capture)await page.screenshot({path:`${directory}/GIVE-010-${phase}-1440.png`,fullPage:true})
  await page.setViewportSize({width:390,height:1100})
  if(capture)await page.screenshot({path:`${directory}/GIVE-010-${phase}-390.png`,fullPage:true})
  await page.close()
 })
}
