import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function recoveryNoticesBrowser(h,{directory,phase='notices'}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  {
   const width=Number(process.env.COFFER_RECOVERY_WIDTH??1440)
   await page.setViewportSize({width,height:1100})
   await page.goto(origin+'/app/agent/recovery')
   await page.getByRole('heading',{name:'Recovery notice approval',exact:true}).waitFor()
   if(phase==='uncertain-sequence'){
    await page.getByText('Submission uncertain',{exact:true}).waitFor()
    await page.getByText('An earlier recovery submission is uncertain; a person must investigate',{exact:false}).waitFor()
    assert.equal(await page.getByText('Accepted by mail provider',{exact:true}).count(),1)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`${directory}/GIVE-010-${phase}-${width}.png`,fullPage:true})
    return
   }
   if(phase==='no-implicit-lead'){
    await page.getByText('Not yet designated',{exact:true}).waitFor()
    assert.equal(await page.locator('input[name=developmentLead]').isChecked(),false)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`${directory}/DEV-002-${phase}-${width}.png`,fullPage:true})
    return
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
   await page.screenshot({path:`${directory}/DEV-002-recovery-notices-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}

export async function investigatedRecoveryBrowser(h,{directory,stepId,finding,reason,actorCookie,phase='investigation',at,expectedState,expectedInvestigations,planStepId}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker({...h,owner:actorCookie??h.owner},async(context,origin)=>{
  if(at)await context.setExtraHTTPHeaders({'x-test-now':at})
  const page=await context.newPage(),width=Number(process.env.COFFER_RECOVERY_WIDTH??1440)
  await page.setViewportSize({width,height:1100})
  await page.goto(origin+'/app/agent/recovery')
  const card=page.locator(`[data-notice-id="${stepId}"]`)
  if(phase.endsWith('investigation')){
   await card.getByLabel('Investigation finding (still unknown is valid)',{exact:true}).fill(finding)
   await card.getByLabel('Why stop further recovery contact for this plan?',{exact:true}).fill(reason)
   await card.screenshot({path:`${directory}/GIVE-010-${phase}-review-${width}.png`})
   assert.equal(await card.getByRole('button',{name:'Close recovery contact',exact:true}).count(),1)
   await card.getByRole('button',{name:'Close recovery contact',exact:true}).click()
   await card.getByText('Investigated closure',{exact:false}).waitFor()
   assert.ok((await card.innerText()).includes(finding))
   assert.ok((await card.innerText()).includes(reason))
   assert.equal(await card.getByRole('button',{name:'Close recovery contact',exact:true}).count(),0)
   assert.ok(await page.getByText('An earlier recovery submission is uncertain; a person must investigate',{exact:false}).count()>0)
  }else if(phase==='resumed'){
   assert.equal(await page.getByText('Accepted by mail provider',{exact:true}).count(),2)
   assert.equal(await page.getByText('Submission uncertain',{exact:true}).count(),2)
   assert.equal(await page.getByText('Investigated closure',{exact:false}).count(),2)
  }else{
   await page.getByText('Recovery notices await standing approval.',{exact:false}).waitFor()
   assert.equal(await page.getByText('Submission uncertain',{exact:true}).count(),2)
   assert.equal(await page.getByText('Investigated closure',{exact:false}).count(),expectedInvestigations)
   assert.equal(await page.getByText('Accepted by mail provider',{exact:true}).count(),expectedState==='sent'?2:1)
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  if(planStepId){
   const plan=page.locator(`[data-notice-id="${planStepId}"]`)
   assert.equal(await plan.getByText(expectedState==='held'?'Held':'Accepted by mail provider',{exact:true}).count(),1)
   await plan.screenshot({path:`${directory}/GIVE-010-${phase}-eligible-plan-${width}.png`})
  }
  await card.screenshot({path:`${directory}/GIVE-010-${phase}-outcome-${width}.png`})
  await page.screenshot({path:`${directory}/GIVE-010-${phase}-${width}.png`,fullPage:true})
  await page.close()
 })
}
