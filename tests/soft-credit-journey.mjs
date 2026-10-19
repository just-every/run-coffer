import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {withBrowserWorker} from './browser-worker.mjs'

export async function softCreditBrowser(h,{donorId,softCreditId,sponsorId,receivedOn,year,directory}) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(10000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   const shot=async name=>{
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} fits ${width}`)
    await page.screenshot({path:`${directory}/GIFT-006-${name}-${width}.png`,fullPage:true})
    if(name!=='retention'){await page.locator('section').filter({has:page.getByRole('heading',{name:'Gift recognition and matching',exact:true})}).screenshot({path:`${directory}/GIFT-006-${name}-detail-${width}.png`});await page.locator('#timeline').screenshot({path:`${directory}/GIFT-006-${name}-timeline-${width}.png`})}
   }
   await page.goto(`${origin}/app/donors/${donorId}`)
   await page.getByText('Record a separate thank-you',{exact:true}).click()
   await page.getByLabel('Thank-you date',{exact:true}).fill(receivedOn)
   await page.getByLabel(/Thank-you method/).selectOption('handwritten note')
   const note='Dear advisor, thank you for recommending the grant to our reading-room program.'
   await page.getByLabel('Thank-you message or interaction notes',{exact:true}).fill(note)
   await shot('thank-you-form')
   await page.getByRole('button',{name:'Record soft-credit thank-you',exact:true}).click()
   await page.getByText('Linked thank-you note',{exact:true}).click()
   await page.getByText(note,{exact:true}).first().waitFor()
   let credit=(await h.get(`/api/coffer/donors/${donorId}`)).giftDepth.creditedGifts.find(x=>x.id===softCreditId)
   assert.equal(credit.acknowledgment.status,'acknowledged');assert.equal(credit.acknowledgment.link.content,note)
   await shot('acknowledged')
   await page.getByText('Do not acknowledge this soft credit',{exact:true}).click()
   await page.getByLabel('Reason not to acknowledge',{exact:true}).fill('Advisor requested no further thank-you messages.')
   await page.getByRole('button',{name:'Save soft-credit acknowledgment exclusion',exact:true}).click()
   credit=(await h.get(`/api/coffer/donors/${donorId}`)).giftDepth.creditedGifts.find(x=>x.id===softCreditId)
   assert.equal(credit.acknowledgment.status,'do not acknowledge')
   await shot('do-not-acknowledge')
   await page.getByRole('button',{name:'Mark soft credit not acknowledged',exact:true}).click()
   credit=(await h.get(`/api/coffer/donors/${donorId}`)).giftDepth.creditedGifts.find(x=>x.id===softCreditId)
   assert.equal(credit.acknowledgment.status,'not acknowledged')
   await page.goto(`${origin}/app/retention?year=${year}`)
   await page.getByRole('heading',{name:'Soft credits · separate recognition',exact:true}).waitFor()
   assert.match(await page.locator('#soft-credits').innerText(),/DAF Advisor/)
   await shot('retention')
   await page.goto(`${origin}/app/donors/${sponsorId}`)
   assert.ok(await page.getByText('Soft-credit thank-you: Not acknowledged',{exact:true}).count())
   await page.screenshot({path:`${directory}/GIFT-006-sponsor-${width}.png`,fullPage:true})
   await page.locator('section').filter({has:page.getByRole('heading',{name:'Gifts',exact:true})}).screenshot({path:`${directory}/GIFT-006-sponsor-gifts-${width}.png`})
  }
 })
}
