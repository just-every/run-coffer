import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function exportsBrowser(h,{listId,headers},directory){
 await mkdir(directory,{recursive:true})
 const constituent=await h.command('donor.create',{name:'Marisol Alvarez',email:'marisol@example.test',addressLine1:'42 Orchard Lane',city:'Springfield',region:'IL',postalCode:'62701'})
 await h.command('gift.record',{donorId:constituent.id,amount:'79.25',receivedOn:'2026-10-18',method:'check',fund:'Reading room',goods:'none'})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({cookie:h.owner,...headers})
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/donors?q=Marisol')
   await page.getByRole('link',{name:'Marisol Alvarez',exact:true}).waitFor()
   await page.screenshot({path:`${directory}/exports-donor-search-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Export this list or save its filters',exact:true}).click()
   await page.getByRole('heading',{name:'Review your download',exact:true}).waitFor()
   assert.equal(new URL(page.url()).searchParams.get('q'),'Marisol')
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
   await page.screenshot({path:`${directory}/DATA-002-saved-list-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/exports?list=search&q=synthetic-coffer-3')
   await page.getByLabel('Record type',{exact:true}).selectOption('gifts')
   await page.getByRole('button',{name:'Review export',exact:true}).click()
   assert.equal(new URL(page.url()).searchParams.get('q'),'synthetic-coffer-3','Changing record type preserves the current search')
   await page.getByLabel('List name',{exact:true}).fill(`Autumn volunteer outreach ${width}`)
   await page.getByRole('button',{name:'Save live list',exact:true}).click()
   await page.getByRole('heading',{name:'Review your download',exact:true}).waitFor()
   assert.ok(await page.getByText(`Autumn volunteer outreach ${width} ·`,{exact:false}).isVisible())
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/DATA-002-save-search-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}


export async function reportExportsBrowser(h,{headers,query},directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({cookie:h.owner,...headers})
  const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/app/funds?'+query)
   await page.getByRole('heading',{name:'Giving by fund',exact:true,level:1}).waitFor()
   const pending=page.waitForEvent('download')
   await page.getByRole('link',{name:'gifts CSV',exact:true}).click()
   const file=await pending
   assert.match(file.suggestedFilename(),/report-funds.*report-records/)
   assert.equal(await file.failure(),null)
   assert.equal(await page.getByRole('link',{name:'constituents CSV',exact:true}).count(),1)
   assert.equal(await page.locator('a[href*="/api/coffer/exports/"]').count(),8)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   // The touched screen has text on every interactive control, including Menu.
   assert.deepEqual(await page.locator('button,a,label[for="cf-menu"]').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width&&!(n.textContent||'').trim()).map(n=>n.outerHTML)),[])
   await page.screenshot({path:`${directory}/DATA-004-funds-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/exports')
   await page.screenshot({path:`${directory}/export-list-navigation-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Export report records',exact:true}).click()
   await page.getByLabel('Report',{exact:true}).selectOption('tax')
   await page.getByRole('button',{name:'Choose report',exact:true}).click()
   await page.getByLabel('Year',{exact:true}).fill('2025')
   await page.getByRole('button',{name:'Review report export',exact:true}).click()
   await page.getByRole('heading',{name:'Review report records',exact:true}).waitFor()
   const taxPending=page.waitForEvent('download')
   await page.getByRole('link',{name:'Download gifts CSV',exact:true}).click()
   const taxFile=await taxPending;assert.match(taxFile.suggestedFilename(),/report-tax.*report-records/);assert.equal(await taxFile.failure(),null)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/report-export-selection-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}
