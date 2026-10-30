import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function migrationAgentBrowser(h,analysisId,directory,mode='current'){
 if(directory)await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  try{
   for(const width of directory?[1440,390]:[1440]){
    await page.setViewportSize({width,height:1000})
    await page.goto(origin+'/app/agent/move-in'+(analysisId?'?analysisId='+analysisId:''))
    if(mode!=='current'){
     if(width===1440){
      if(mode==='stale'){await page.getByRole('heading',{name:'Comparison is stale',exact:true}).waitFor();assert.equal(await page.getByText('Reviewed source facts',{exact:true}).count(),0)}
      else{assert.match(await page.locator('main').innerText(),/Finish the import before comparison/);assert.equal(await page.getByRole('button',{name:'Compare this import'}).count(),0)}
     }
     if(directory)await page.screenshot({path:directory+'/migration-'+mode+'-'+width+'.png',fullPage:true})
     continue
    }
    if(width===1440){
     await page.getByRole('heading',{name:'Current comparison',exact:true}).waitFor()
     assert.match(await page.locator('main').innerText(),/Possible duplicate identity/)
     assert.match(await page.locator('main').innerText(),/Historical not-acknowledged gift/)
     assert.equal(await page.getByRole('button',{name:/apply|send|merge/i}).count(),0)
     await page.getByRole('button',{name:'Compare this import'}).click()
     await page.getByRole('heading',{name:'Current comparison',exact:true}).waitFor()
     await page.getByText('Reviewed source facts',{exact:true}).first().click()
     await page.getByText('Current native facts',{exact:true}).first().click()
     const small=await page.locator('main').evaluate(el=>[...el.querySelectorAll('button,a,summary,p')].filter(e=>e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<13).map(e=>e.tagName))
     assert.deepEqual(small,[])
    }
    if(width===1440)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Migration screen fits '+width)
    if(directory)await page.screenshot({path:directory+'/migration-current-'+width+'.png',fullPage:true})
    await page.getByRole('link',{name:'Reviewed source donor',exact:true}).first().click()
    if(width===1440){await page.getByRole('heading',{name:'Reviewed migration source',exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/Synthetic Migration/)}
    if(directory)await page.screenshot({path:directory+'/migration-source-'+width+'.png',fullPage:true})
   }
  }finally{await page.close()}
 })
}
