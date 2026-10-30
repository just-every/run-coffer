import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function agentQuickbooksBrowser(h,{phase,expected}){
 const directory=process.env.COFFER_AGENT_QBO_EVIDENCE??'.cache/agent-quickbooks'
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  try{
   await page.goto(origin+'/app/agent/reconcile')
   await page.getByRole('button',{name:'Check QuickBooks now',exact:true}).click()
   await page.getByRole('status').filter({hasText:'QuickBooks comparison'}).waitFor()
   // Behaviour is asserted once at desktop width; both release widths are proof.
   assert.match(await page.getByRole('status').innerText(),expected)
   const cards=page.locator('article').filter({hasText:'QuickBooks accounting facts differ.'})
   if(phase==='changed'){
    assert.equal(await cards.count(),4)
    assert.equal(await cards.getByRole('button',{name:'Apply correction'}).count(),0)
    await cards.first().getByText('Evidence and source IDs',{exact:true}).click()
    assert.match(await cards.first().locator('pre').innerText(),/requestId/)
    assert.match(await cards.first().locator('pre').innerText(),/externalId/)
    await cards.first().getByText('Evidence and source IDs',{exact:true}).click()
    assert.match(await cards.filter({hasText:'txn_qbo_refund'}).innerText(),/\$24\.99/)
    assert.equal(await cards.getByRole('link',{name:'Open native source',exact:true}).count(),4)
   }
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Native comparison fits '+width)
    await page.screenshot({path:`${directory}/${phase}-${width}.png`,fullPage:true})
   }
  }finally{await page.close()}
 })
}
