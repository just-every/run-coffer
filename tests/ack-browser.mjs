import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {donor} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function ackBrowser(h,directory) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const shot=async name=>{
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    if(name==='donor'||name==='imported-donor')await page.getByRole('heading',{name:'Gifts',exact:true}).locator('..').screenshot({path:`${directory}/ACK-001-${name}-gifts-${width}.png`})
    await page.screenshot({path:`${directory}/ACK-001-${name}-${width}.png`,fullPage:true})
   }
  }
  const d=await donor(h,'Morgan Ellis',{email:'morgan.ellis@example.org'})
  const gift=await h.command('gift.record',{donorId:d.id,amount:'750',receivedOn:'2026-10-01',method:'check',fund:'Adult literacy',goods:'none'})
  await page.goto(origin+'/app/letters');await shot('queue')
  await page.getByRole('button',{name:'Prepare 1 letters',exact:true}).click()
  await page.getByRole('button',{name:'Approve these letters',exact:true}).waitFor();await shot('prepared')
  await page.getByRole('button',{name:'Approve these letters',exact:true}).click()
  await page.getByRole('button',{name:'Export letters (CSV)',exact:true}).waitFor();await shot('approved')
  await page.getByRole('button',{name:'Export letters (CSV)',exact:true}).click()
  await page.getByRole('button',{name:'Record letters as sent',exact:true}).waitFor();await shot('exported')
  await page.getByRole('button',{name:'Record letters as sent',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'Record letters as sent',exact:true}).count(),0)
  await shot('sent')
  await page.goto(origin+'/app/donors/'+d.id)
  await page.getByText('Acknowledged',{exact:true}).waitFor();await shot('donor')
  const history=await h.get('/api/coffer/donors/'+d.id),ack=history.gifts.find(g=>g.id===gift.id).acknowledgment
  assert.equal(ack.status,'acknowledged');assert.equal(ack.method,'letter');assert.ok(ack.batch_id);assert.ok(ack.letter_id)
  assert.equal((await h.get('/api/coffer/letters')).due.length,0)
  await page.goto(origin+'/app/gifts');await shot('gift-ledger')
  const file=(name,text)=>({name,base64:Buffer.from(text).toString('base64')})
  const input={source:'lgl',files:[
   file('constituents.csv','LGL Constituent ID,Name\nack-browser,Leslie Grant\n'),
   file('gifts.csv','LGL Gift ID,LGL Constituent ID,Gift Type,Gift Date,Amount,Non-Deductible Amount,Acknowledgment Status,Acknowledgment Date,Acknowledgment Method,Acknowledgment Reason\nack-1,ack-browser,Gift,2026-09-01,500,0,acknowledged,2026-09-02,letter,\nack-2,ack-browser,Gift,2026-09-03,500,0,do not acknowledge,,,Donor requested no letter\nack-3,ack-browser,Gift,2024-09-01,500,0,not acknowledged,,,\n'),
  ]}
  const preview=await h.api('/api/coffer/move-in/preview',input)
  assert.equal(preview.canApply,true)
  let job=await h.api('/api/coffer/move-in/apply',{id:preview.id,fingerprint:preview.fingerprint,acknowledged:'yes',acknowledgedBefore:'2025-01-01'})
  while(job.state==='applying')job=await h.api('/api/coffer/move-in/continue',{id:preview.id})
  const imported=(await h.get('/api/coffer/donors')).donors.find(d=>d.name==='Leslie Grant')
  await page.goto(origin+'/app/donors/'+imported.id);await shot('imported-donor')
  await page.goto(origin+'/app/gifts');await shot('imported-ledger')
  assert.equal((await h.get('/api/coffer/letters')).due.length,0)
 })
}
