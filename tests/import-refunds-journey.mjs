// Optional native-file-upload leg of the existing IMPORT-001 HTTP journey.
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function importRefundsBrowser(h,input,directory) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  const upload=async payload=>{
   await page.goto(origin+'/app/move-in')
   await page.getByText('Advanced: upload saved Stripe JSON',{exact:true}).click()
   const file=(name,data)=>({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))})
   await page.getByLabel('Customer pages (.json)',{exact:true}).setInputFiles(payload.customers.map((data,i)=>file(`customers-${i+1}.json`,data)))
   await page.getByLabel('Charge pages (.json)',{exact:true}).setInputFiles(payload.charges.map((data,i)=>file(`charges-${i+1}.json`,data)))
   await page.getByRole('button',{name:'Preview saved files',exact:true}).click()
   await page.waitForLoadState('domcontentloaded')
  }
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   const shot=async name=>{
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} fits ${width}`)
    await page.screenshot({path:`${directory}/IMPORT-001-${name}-${width}.png`,fullPage:true})
   }
   const duplicate=structuredClone(input)
   duplicate.customers[0].data.push(structuredClone(duplicate.customers[0].data[0]))
   duplicate.charges[0].data.push(structuredClone(duplicate.charges[0].data[0]))
   await upload(duplicate)
   const refusal=await page.locator('body').innerText()
   for(const id of [duplicate.customers[0].data[0].id,duplicate.charges[0].data[0].id])assert.ok(refusal.includes(id))
   assert.match(refusal,/row 1/)
   await shot('repeated-rows')
   assert.equal((await h.get('/api/coffer/donors')).total,0)

   await upload(input)
   await page.getByRole('heading',{name:'Gifts to add',exact:true}).waitFor()
   const giftReview=page.getByText(/^Review \d+ gifts$/)
   if(await giftReview.count()&&!(await giftReview.evaluate(node=>node.parentElement.open)))await giftReview.click()
   const partial=page.getByRole('row').filter({has:page.getByRole('cell',{name:'Partially refunded',exact:true})})
   const refunded=page.getByRole('row').filter({has:page.getByRole('cell',{name:'Refunded',exact:true})})
   assert.match(await partial.innerText(),/\$100\.00[\s\S]*\$25\.00[\s\S]*\$75\.00/)
   assert.match(await refunded.innerText(),/\$100\.00[\s\S]*\$100\.00[\s\S]*\$0\.00/)
   await shot('preview')
   await page.getByLabel('I approve adding exactly these donors, gifts and monthly plans.',{exact:true}).check()
   await page.getByRole('button',{name:'Apply the move-in',exact:true}).click()
   for(let step=0;step<20&&await page.getByRole('button',{name:'Continue the import',exact:true}).count();step++)await page.getByRole('button',{name:'Continue the import',exact:true}).click()
   await page.waitForURL(url=>url.pathname==='/app/move-in/journal'&&url.searchParams.has('id'))
   await page.getByText('All totals match',{exact:true}).waitFor()
   await page.getByRole('button',{name:'Undo this import',exact:true}).waitFor()
   const journalUrl=page.url()
   await shot('journal')

   await upload(input)
   const importedRefusal=await page.locator('body').innerText()
   assert.match(importedRefusal,/Already imported/)
   for(const id of [input.customers[0].data[0].id,input.charges[0].data[0].id])assert.ok(importedRefusal.includes(id))
   await shot('already-imported')

   await page.goto(journalUrl)
   await page.waitForURL(url=>url.pathname==='/app/move-in/journal'&&url.searchParams.has('id'))
   assert.equal(await page.getByRole('button',{name:'Undo this import',exact:true}).count(),1,`Applied journal ${journalUrl}: ${await page.locator('body').innerText()}`)
   await page.getByRole('button',{name:'Undo this import',exact:true}).click()
   for(let step=0;step<20&&await page.getByRole('button',{name:'Continue undo',exact:true}).count();step++)await page.getByRole('button',{name:'Continue undo',exact:true}).click()
   await page.getByText('Undone',{exact:true}).waitFor()
   assert.equal((await h.get('/api/coffer/donors')).total,0)
   await shot('undone')
  }
 })
}
