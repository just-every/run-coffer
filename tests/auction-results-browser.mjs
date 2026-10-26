import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'
import {auctionCsvFixture} from './auction-results-journey.mjs'

/** Optional native-form evidence, sharing the journey's real Worker and data. */
export async function auctionResultsBrowser(h,{event,jobId,directory}){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   const shot=async name=>{
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Auction forms fit the viewport')
    for(const control of await page.locator('a,button').all())if(await control.isVisible())assert.ok((await control.innerText()).trim()||await control.getAttribute('aria-label'),'Every action has a visible or accessible name')
    await page.screenshot({path:`${directory}/CAMP-005-${name}-${width}.png`,fullPage:name!=='bidder-balances'})
   }
   await page.goto(origin+'/app/events/'+event.id)
   await shot('event')
   await page.getByRole('link',{name:'Auction results',exact:true}).click()
   await page.goto(origin+'/app/events/'+event.id+'/auctions?jobId='+jobId)
   await page.getByRole('heading',{name:'Auction results',exact:true}).first().waitFor()
   await page.getByText('Waiting for a fair market value',{exact:true}).waitFor()
   await shot('results-and-hold')
   const donorId=(await h.get('/api/coffer/auctions?eventId='+event.id+'&jobId='+jobId)).rows.find(r=>r.status==='open').donor_id
   await page.goto(origin+'/app/donors/'+donorId)
   await page.getByRole('heading',{name:'Auction activity',exact:true}).scrollIntoViewIfNeeded()
   await shot('bidder-balances')
   await page.goto(origin+'/app/events/'+event.id+'/auctions?jobId='+jobId)
   const bidder='Synthetic Coffer Browser Bidder '+width,email=`synthetic-coffer-browser-auction-${width}@example.test`,lot='BROWSER-'+width
   const csv=auctionCsvFixture([[lot,'Synthetic Coffer native upload lot',bidder,email,'500','200','paid','lot','','','']])
   const upload=page.locator('form[action$="/auctions/upload"]')
   await upload.getByLabel('Auction platform',{exact:true}).fill('Synthetic Coffer Browser '+width)
   await upload.getByLabel('Payment received on',{exact:true}).fill('2026-10-17')
   await upload.getByLabel('Auction results CSV file',{exact:true}).setInputFiles({name:'synthetic-coffer-auction-results.csv',mimeType:'text/csv',buffer:Buffer.from(csv)})
   await upload.getByRole('button',{name:'Preview uploaded CSV',exact:true}).click()
   await page.getByRole('heading',{name:'Auction review',exact:true}).waitFor();await shot('preview')
   const result=page.locator('.list > li').filter({has:page.getByRole('heading',{name:'Lot '+lot+' · Synthetic Coffer native upload lot',exact:true})})
   await result.getByLabel('Reason for a separate donor',{exact:true}).fill('Synthetic Coffer reviewed new bidder roster.')
   await result.getByRole('button',{name:'Create donor for '+bidder,exact:true}).click()
   await page.getByRole('button',{name:'Apply reviewed auction results',exact:true}).waitFor();await shot('reviewed-match')
   await page.getByRole('button',{name:'Apply reviewed auction results',exact:true}).click()
   await page.getByText('Contribution payment',{exact:true}).waitFor();await page.getByText('$500.00 paid · Fair market value $200.00 · $300.00 deductible',{exact:true}).waitFor();await shot('applied')
   await page.getByRole('button',{name:'Undo this auction import',exact:true}).click()
   await page.getByText('Undone',{exact:true}).waitFor();await shot('undone')
  }
 })
}
