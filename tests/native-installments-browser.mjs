import assert from 'node:assert/strict'
import {withBrowserWorker} from './browser-worker.mjs'

export async function nativeInstallmentsBrowser(h,edge,{id,person,directory,phase='active'}){
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({'x-test-now':edge.state.now})
  const page=await context.newPage()
  for(const width of directory?[1440,390]:[1440]){
   await page.setViewportSize({width,height:1000})
   const inspect=async name=>{
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    const small=await page.locator('main p,main button,main label').evaluateAll(elements=>elements.filter(el=>parseFloat(getComputedStyle(el).fontSize)<13).length);assert.equal(small,0)
    if(directory)await page.screenshot({path:directory+'/native-'+name+'-'+width+'.png',fullPage:true})
   }
   if(phase==='active'){
    await page.goto(origin+'/app/giving/installments/new?donorId='+person.id)
    await page.getByRole('heading',{name:'Prepare monthly saved-card plan'}).waitFor()
    await inspect('creation')
   }
   await page.goto(origin+'/app/giving/installments/'+id)
   await page.getByRole('heading',{name:'Monthly plan review'}).waitFor()
   if(width===1440)assert.ok(await page.getByText(phase==='held'?'Status: past_due':'Status: active',{exact:false}).count())
   await inspect(phase)
   await page.getByRole('heading',{name:'Held payment investigation'}).waitFor()
   await page.getByRole('heading',{name:'Installment history'}).waitFor()
  }
 })
}
