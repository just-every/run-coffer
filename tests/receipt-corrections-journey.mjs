import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

// RCPT-008: network fakes stop at Stripe and SendGrid. All product work uses
// signed webhooks, native commands, authenticated reads and actual documents.
export async function receiptCorrectionsJourney() {
 const secret='synthetic_receipt_correction_edge', at=Math.floor(Date.now()/1000), charges=new Map(), refunds=new Map(), transactions=new Map(), messages=[]
 const options={bindings:{STRIPE_SECRET_KEY:'sk_test_receipt_corrections',STRIPE_WEBHOOK_SECRET:secret,MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic_receipt_mail',MAIL_FROM:'receipts@example.test'},outbound:async request=>{
  const u=new URL(request.url)
  if(u.hostname==='api.sendgrid.com'){messages.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'correction-'+messages.length}})}
  if(u.hostname==='api.stripe.com'){
   const row=charges.get(u.pathname)||refunds.get(u.pathname)||transactions.get(u.pathname)
   if(row)return Response.json(row)
  }
  assert.fail(`Unexpected network edge ${request.method} ${u.origin}${u.pathname}`)
 }}
 const event=async(h,id,type,objectId)=>{
  const raw=JSON.stringify({id,type,data:{object:{id:objectId}}}),timestamp=Math.floor(Date.now()/1000)
  const signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
  const response=await h.mf.dispatchFetch(h.origin+'/api/coffer/giving/webhook',{method:'POST',headers:{host:new URL(h.origin).host,'stripe-signature':`t=${timestamp},v1=${signature}`},body:raw})
  assert.equal(response.status,200,await response.text())
 }
 const detail=(h,id)=>h.get('/api/coffer/letters/'+id)
 const issue=async(h,giftId)=>{
  const batch=await h.command('ack.prepare',{giftIds:[giftId]})
  await h.command('ack.approve',{batchId:batch.id,version:1})
  const sent=await h.command('ack.send',{batchId:batch.id,version:2})
  return {...await detail(h,batch.id),version:sent.version}
 }
 const paid=async(h,key)=>{
  const charge={id:'ch_'+key,object:'charge',paid:true,status:'succeeded',amount:35000,currency:'usd',created:at,metadata:{fund:'Literacy'},billing_details:{name:'Nora '+key,email:key+'@example.test'},balance_transaction:'txn_'+key,amount_refunded:0}
  charges.set('/v1/charges/'+charge.id,charge)
  transactions.set('/v1/balance_transactions/'+charge.balance_transaction,{id:charge.balance_transaction,type:'charge',source:charge.id,amount:35000,fee:1000,net:34000,currency:'usd',created:at})
  await event(h,'evt_paid_'+key,'charge.succeeded',charge.id)
  const person=(await h.get('/api/coffer/donors')).donors.find(d=>d.email===key+'@example.test')
  const gift=(await h.get('/api/coffer/donors/'+person.id)).gifts[0]
  // Imported successful charges have no benefit facts until staff answer.
  if(gift.goods==='unknown')await h.command('gift.classify',{giftId:gift.id,version:gift.version,goods:'none'})
  return {person,gift,charge}
 }
 const half=async(h,charge,key)=>{
  const refund={id:'re_'+key,object:'refund',status:'succeeded',charge:charge.id,balance_transaction:'txn_refund_'+key}
  refunds.set('/v1/refunds/'+refund.id,refund)
  transactions.set('/v1/balance_transactions/'+refund.balance_transaction,{id:refund.balance_transaction,type:'refund',source:refund,amount:-17500,fee:0,net:-17500,currency:'usd',created:at})
  await event(h,'evt_refund_'+key,'refund.created',refund.id)
 }
 await run(async h=>{
  await reviewed(h)
  const {person,gift,charge}=await paid(h,'receipt-original')
  const original=await issue(h,gift.id), old=original.letters[0]
  assert.ok(old.receipt_year && old.receipt_sequence,'Every issued cash receipt has a reserved annual identity')
  assert.ok(messages.at(-1).content[0].value.includes(`Receipt ${old.receipt_year}-${old.receipt_sequence}`),'The numbered document actually reaches the email edge')
  const annual=await h.command('ack.prepareStatements',{year:Number(gift.received_on.slice(0,4)),donorId:person.id})
  await h.command('ack.approve',{batchId:annual.id,version:1})
  const statement=(await detail(h,annual.id)).letters[0]
  assert.equal(statement.receipt_sequence,old.receipt_sequence+1,'Annual statements share the same sequence')
  await half(h,charge,'receipt-original')
  await event(h,'evt_refund_receipt-original','refund.created','re_receipt-original')
  assert.ok((await detail(h,original.batch.id)).letters[0].void_reason)
  assert.ok((await detail(h,annual.id)).letters[0].void_reason,'A refund invalidates every statement containing that gift')
  await h.command('ack.send',{batchId:annual.id,version:2},{status:409})
  await h.command('ack.export',{batchId:annual.id,version:2},{status:409})
  const member=await h.person('receipt-clerk@example.test')
  await h.command('ack.correct',{letterId:old.id},{as:member.cookie,status:403})
  const replacement=await h.command('ack.correct',{letterId:old.id})
  let corrected=(await detail(h,replacement.id)).letters[0]
  assert.equal(corrected.receipt_sequence,statement.receipt_sequence+1,'A half-refund correction reserves the next number')
  assert.equal(corrected.replaces_id,old.id);assert.equal(corrected.amount_cents,17500)
  assert.ok(corrected.body.includes(`${old.receipt_year}-${old.receipt_sequence}`))
  assert.match(corrected.body,/350\.00/);assert.match(corrected.body,/175\.00/)
  assert.ok(corrected.body.includes('Processor contribution changed'),'The corrected copy explains the actual change')
  assert.equal(messages.filter(m=>m.subject===corrected.subject).length,1,'Preparing a correction sends nothing')
  await h.command('ack.send',{batchId:replacement.id,version:1},{status:409})
  await h.command('ack.correct',{letterId:old.id},{status:409})
  await h.command('ack.approve',{batchId:replacement.id,version:1})
  await h.command('ack.send',{batchId:replacement.id,version:2})
  assert.ok(messages.at(-1).content[0].value.includes('Use this corrected receipt in place of the original'),'The donor is told in the submitted correction')
  const historical=await h.request(`/app/letters/${original.batch.id}/print`)
  assert.equal(historical.status,200);assert.match(await historical.text(),/VOID/)
  const cash=await donor(h,'Samuel Ortiz')
  const manual=await h.command('gift.record',{donorId:cash.id,amount:'400',receivedOn:'2025-09-12',method:'check',goods:'none',allocations:[{fund:'Books',amount:'300'},{fund:'Literacy',amount:'100'}]})
  const cashReceipt=await issue(h,manual.id)
  await h.command('gift.reverse',{giftId:manual.id,reason:'Replace the incorrect allocation with a new immutable gift'})
  const voided=(await detail(h,cashReceipt.batch.id)).letters[0]
  assert.ok(voided.void_reason,'Reversal to change a split voids the original without altering its number')
  assert.equal(voided.receipt_sequence,cashReceipt.letters[0].receipt_sequence)
  await h.command('ack.correct',{letterId:voided.id},{status:409})
  const property=await h.command('inKind.save',{donorId:cash.id,description:'Library shelving',quantity:'2',statedValue:'800',receivedOn:'2025-09-10',goods:'none'})
  const propertyAck=await h.command('inKind.acknowledge',{donorId:cash.id,inKindId:property.id,version:property.version,acknowledgedOn:'2025-09-12'})
  let propertyState=(await h.get('/api/coffer/in-kind?donorId='+cash.id)).gifts.find(g=>g.id===property.id)
  assert.equal(propertyState.acknowledgments[0].receipt_sequence,voided.receipt_sequence+1,'Property acknowledgments share the cash sequence')
  const propertyNumber=propertyState.acknowledgments[0].receipt_sequence
  await h.command('inKind.save',{donorId:cash.id,inKindId:property.id,version:propertyAck.version,description:'Library shelving, three units',quantity:'3',statedValue:'800',receivedOn:'2025-09-10',goods:'none',correctionReason:'Correct the quantity from the receiving record'})
  propertyState=(await h.get('/api/coffer/in-kind?donorId='+cash.id)).gifts.find(g=>g.id===property.id)
  assert.ok(propertyState.acknowledgments[0].void_reason)
  const propertyReissue=await h.command('inKind.acknowledge',{donorId:cash.id,inKindId:property.id,version:propertyState.version,acknowledgedOn:'2025-09-12'})
  propertyState=(await h.get('/api/coffer/in-kind?donorId='+cash.id)).gifts.find(g=>g.id===property.id)
  const propertyCopy=propertyState.acknowledgments.find(a=>a.id===propertyReissue.acknowledgmentId)
  assert.equal(propertyCopy.receipt_sequence,propertyNumber+1);assert.equal(propertyCopy.replaces_id,propertyAck.acknowledgmentId)
  const propertyDocument=await h.request(`/api/coffer/in-kind-acknowledgments/${propertyCopy.id}/download`)
  assert.ok((await propertyDocument.text()).includes(`Receipt ${propertyCopy.receipt_year}-${propertyCopy.receipt_sequence}`))
  const source=await donor(h,'Noah Bell'),survivor=await donor(h,'Noah Bell surviving record')
  const reassignedGift=await h.command('gift.record',{donorId:source.id,amount:'350',receivedOn:'2025-09-12',method:'check',goods:'none'})
  const reassignedReceipt=await issue(h,reassignedGift.id)
  const comparison=await h.get(`/api/coffer/duplicates/compare?source=${source.id}&target=${survivor.id}`)
  const merged=await h.command('donor.merge',{sourceDonorId:source.id,donorId:survivor.id,sourceVersion:comparison.source.version,version:comparison.target.version,fields:{},reason:'duplicate_record'})
  assert.ok((await detail(h,reassignedReceipt.batch.id)).letters[0].void_reason,'Reassignment through an audited merge invalidates the original recipient copy')
  assert.equal((await detail(h,reassignedReceipt.batch.id)).letters[0].receipt_sequence,reassignedReceipt.letters[0].receipt_sequence,'Reassignment preserves the receipt identity')
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await detail(h,reassignedReceipt.batch.id)).letters[0].void_reason,null,'Undo restores the valid original recipient and its receipt')
  const lastNumber=reassignedReceipt.letters[0].receipt_sequence
  const saved=await archive(h)
  await run(async fresh=>{
   await restore(fresh,saved)
   assert.deepEqual((await detail(fresh,replacement.id)).letters,(await detail(h,replacement.id)).letters,'Archive/restore retain exact corrections and annual numbers')
   assert.deepEqual((await detail(fresh,original.batch.id)).letters,(await detail(h,original.batch.id)).letters,'Original voided receipt remains historical')
   const extra=await fresh.command('gift.record',{donorId:cash.id,amount:'350',receivedOn:'2025-09-13',method:'check',goods:'none'})
   const next=await fresh.command('ack.prepare',{giftIds:[extra.id]})
   assert.equal((await detail(fresh,next.id)).letters[0].receipt_sequence,lastNumber+1,'Restoration never reuses a reserved number')
  },options)
  if(process.env.COFFER_CORRECTIONS_BROWSER){
   const directory=process.env.COFFER_CORRECTIONS_BROWSER;await mkdir(directory,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{
    const page=await context.newPage();page.setDefaultTimeout(15000)
    const capture=async(name,width)=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/RCPT-008-${name}-${width}.png`,fullPage:true})}
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000})
     const candidate=await paid(h,'browser-'+width), issued=await issue(h,candidate.gift.id)
     await half(h,candidate.charge,'browser-'+width)
     await page.goto(origin+'/app/letters/'+issued.batch.id)
     await capture('void',width)
     await page.getByRole('button',{name:'Prepare corrected receipt',exact:true}).click()
     await page.getByRole('button',{name:'Approve these letters',exact:true}).waitFor()
     await capture('prepared',width)
     await page.getByRole('button',{name:'Approve these letters',exact:true}).click()
     await page.getByRole('button',{name:'Send approved letters',exact:true}).click()
     await page.getByText('Email submitted · awaiting delivery',{exact:true}).waitFor()
     await capture('submitted',width)
     await page.getByRole('link',{name:'Print this letter / save PDF',exact:true}).click()
     await capture('print',width)
     await page.goto(origin+'/app/donors/'+cash.id)
     await page.locator('#in-kind-'+property.id).waitFor();await capture('property',width)
    }
    await page.close()
   })
  }
 },options)
}
