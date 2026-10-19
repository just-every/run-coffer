import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function recognitionBrowser(h,edge,adaId,benId,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  // Stripe alone owns its hosted checkout; Coffer's real return door records payment.
  await page.route('https://checkout.stripe.com/**',route=>route.fulfill({status:200,contentType:'text/plain',body:'Stripe test boundary'}))
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/give/autumn-reading')
   await page.locator('[name=name]').fill(`Blair Guest ${width}`);await page.locator('[name=email]').fill(`blair.${width}@example.org`);await page.locator('[name=amount]').fill('20.00')
   await page.locator('[name=wallOptIn]').check();await page.locator('[name=recognitionName]').fill(`The Guest Circle ${width}`)
   if(width===1440)await page.locator('[name=anonymous]').check()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/GIFT-011-checkout-${width}.png`,fullPage:true})
   await page.getByRole('button',{name:'Continue to secure checkout'}).click();await page.waitForURL('https://checkout.stripe.com/**')
   const session=[...edge.sessions.values()].at(-1)
   await page.goto(origin+'/giving/thanks?session_id='+session.id);await page.getByRole('heading',{name:'Thank you for your gift',exact:true}).waitFor()
   await page.screenshot({path:`${directory}/GIFT-011-paid-${width}.png`,fullPage:true})
   await page.goto(origin+'/give/autumn-reading')
   const wall=page.getByRole('region',{name:'Donor wall',exact:true})
   assert.ok(!(await wall.textContent()).includes('Ada Rivera'));assert.ok(!(await wall.textContent()).includes('Ben Wells'))
   if(width===1440)assert.ok(!(await wall.textContent()).includes('The Guest Circle 1440'))
   else await wall.getByText('The Guest Circle 390',{exact:true}).waitFor()
   await wall.screenshot({path:`${directory}/GIFT-011-wall-${width}.png`})
   await page.goto(origin+'/app/donors/'+adaId)
   const panel=page.locator('#recognition'),donorForm=panel.locator('form').filter({has:page.locator('[name=command][value="recognition.donor"]')})
   await donorForm.getByLabel('Honor-roll recognition name',{exact:true}).fill('The Rivera Family')
   assert.equal(await donorForm.locator('[name=anonymous]').isChecked(),true)
   await donorForm.getByRole('button',{name:'Save donor recognition',exact:true}).click()
   await page.locator('#recognition').screenshot({path:`${directory}/GIFT-011-staff-${width}.png`})
   assert.equal((await h.get(`/api/coffer/donors/${adaId}`)).recognition.anonymous,1)
   await page.goto(origin+'/app/donors/'+benId)
   const giftId=(await h.get(`/api/coffer/donors/${benId}`)).gifts.find(g=>g.kind==='gift').id
   for(const anonymous of [false,true]){
    const giftForm=page.locator('#recognition form').filter({has:page.locator(`input[name=giftId][value="${giftId}"]`)})
    await giftForm.locator('..').locator('summary').click();await giftForm.locator('[name=anonymous]').setChecked(anonymous)
    await giftForm.getByRole('button',{name:'Save gift recognition',exact:true}).click()
    await page.goto(origin+'/give/autumn-reading')
    const publicNames=await page.getByRole('region',{name:'Donor wall',exact:true}).textContent()
    assert.equal(publicNames.includes('The Wells Family'),!anonymous)
    await page.goto(origin+'/app/donors/'+benId)
   }
   await page.locator('#recognition').screenshot({path:`${directory}/GIFT-011-gift-${width}.png`})
   await page.goto(origin+'/app/reports/honor-roll')
   await page.getByLabel('Received from',{exact:true}).fill('2026-01-01');await page.getByLabel('Received through',{exact:true}).fill('2026-12-31')
   await page.getByLabel('Higher giving level (USD)',{exact:true}).fill('175.00');await page.getByLabel('Higher level name',{exact:true}).fill('Leadership')
   await page.getByRole('button',{name:'Show honor roll',exact:true}).click()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   const rows=await page.locator('tbody tr').allTextContents();assert.ok(rows.some(text=>text.includes('Anonymous')));assert.ok(rows.some(text=>text.includes('Leadership')))
   const wait=page.waitForEvent('download');await page.getByRole('link',{name:'Download honor-roll CSV',exact:true}).click();const download=await wait,bytes=await readFile(await download.path(),'utf8')
   assert.ok(bytes.includes('Anonymous'));assert.ok(!bytes.includes('Ada Rivera'));assert.ok(!bytes.includes('The Rivera Family'))
   await page.screenshot({path:`${directory}/GIFT-011-honor-roll-${width}.png`,fullPage:true})
   await page.getByLabel('Received from',{exact:true}).fill('1900-01-01');await page.getByLabel('Received through',{exact:true}).fill('1900-12-31');await page.getByRole('button',{name:'Show honor roll',exact:true}).click()
   await page.getByText('No positive remaining gifts in this period.',{exact:true}).waitFor()
   await page.screenshot({path:`${directory}/GIFT-011-empty-${width}.png`,fullPage:true})
  }
 })
}
