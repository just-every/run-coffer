import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function reconciliationApprovalBrowser(h,{issueId,phase,approve=false}) {
 const directory=process.env.COFFER_RECONCILIATION_EVIDENCE??'.cache/reconciliation-approvals'
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  try{
   await page.goto(origin+'/app/agent/reconcile')
   const card=page.locator('article').filter({has:page.locator(`input[name="id"][value="${issueId}"]`)})
   assert.equal(await card.count(),1,'The seeded correction is visible')
   const undo=phase==='undo',approval=card.getByRole('button',{name:undo?'Approve undo':'Approve correction',exact:true})
   assert.equal(await approval.count(),1)
   assert.equal(await card.getByRole('button',{name:undo?'Undo correction':'Apply correction',exact:true}).count(),0,'Unapproved money changes have no apply control')
   assert.match(await card.innerText(),undo?/compensating undo/:/finance lead/)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Native approval review fits the desktop viewport')
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    await page.screenshot({path:`${directory}/${phase}-${width}.png`,fullPage:true})
   }
   if(approve){
    await page.setViewportSize({width:1440,height:1000})
    await card.getByRole('checkbox').check()
    await approval.click()
    const approved=page.locator('article').filter({has:page.locator(`input[name="id"][value="${issueId}"]`)})
    await approved.getByRole('status').waitFor()
    assert.match(await approved.getByRole('status').innerText(),/Finance approval recorded/)
    assert.equal(await approved.getByRole('button',{name:undo?'Undo correction':'Apply correction',exact:true}).count(),1)
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000})
     await page.screenshot({path:`${directory}/${phase}-approved-${width}.png`,fullPage:true})
    }
   }
  }finally{await page.close()}
 })
}
