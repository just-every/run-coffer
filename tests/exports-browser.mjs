import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function exportsBrowser(h,{listId,headers},directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({cookie:h.owner,...headers})
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/more')
   await page.getByRole('link',{name:'Export donor records',exact:false}).waitFor()
   await page.screenshot({path:`${directory}/exports-more-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/exports?list='+encodeURIComponent('saved:'+listId)+'&type=gifts')
   await page.getByRole('heading',{name:'Review your download',exact:true}).waitFor()
   assert.ok(await page.getByText('2 confidential staff notes withheld.',{exact:true}).isVisible())
   await page.getByLabel('Record type',{exact:true}).selectOption('interactions')
   await page.getByRole('button',{name:'Review export',exact:true}).click()
   const pending=page.waitForEvent('download')
   await page.getByRole('link',{name:'Download interactions CSV',exact:true}).click()
   const downloaded=await pending;assert.match(downloaded.suggestedFilename(),/interactions.*lifetime/)
   assert.equal(await downloaded.failure(),null)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/DATA-002a-saved-list-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/exports?list=search&q=synthetic-coffer-3')
   await page.getByLabel('Record type',{exact:true}).selectOption('gifts')
   await page.getByRole('button',{name:'Review export',exact:true}).click()
   assert.equal(new URL(page.url()).searchParams.get('q'),'synthetic-coffer-3','Changing record type preserves the current search')
   await page.getByLabel('List name',{exact:true}).fill(`Autumn volunteer outreach ${width}`)
   await page.getByRole('button',{name:'Save live list',exact:true}).click()
   await page.getByRole('heading',{name:'Review your download',exact:true}).waitFor()
   assert.ok(await page.getByText(`Autumn volunteer outreach ${width} ·`,{exact:false}).isVisible())
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/DATA-002a-save-search-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}
