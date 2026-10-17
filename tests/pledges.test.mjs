import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'

const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10)
const receivedOn='2025-08-10'

test('dated pledges remind once, match real gifts by fund and donor, and reopen balances on reversal',()=>{
 const messages=[]
 let uncertainNext=false
 return run(async h=>{
  await reviewed(h)
  const ana=await donor(h,'Ana Pledge')
  await h.command('consent.record',{donorIds:[ana.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic donor requests email',capturedOn:'2025-01-01'})
  const schedule={donorId:ana.id,amount:'200',pledgedOn:'2025-01-01',fund:'Library',installments:[{dueOn:day(2),amount:'100'},{dueOn:day(30),amount:'100'}]}
  await h.command('pledge.create',{...schedule,amount:'300'},{status:400})
  const pledge=await h.command('pledge.create',schedule)
  const history=()=>h.get(`/api/coffer/donors/${ana.id}`)
  let p=(await history()).pledges.find(p=>p.id===pledge.id)
  assert.equal(p.remaining_cents,20000)
  const installmentId=p.installments[0].id
  await h.command('pledge.remind',{donorId:ana.id},{as:'',status:401})
  const [first,second]=await Promise.all([h.command('pledge.remind',{pledgeId:p.id}),h.command('pledge.remind',{pledgeId:p.id})])
  assert.equal(first.submitted+second.submitted,1)
  assert.equal(messages.length,1)
  assert.equal(messages[0].personalizations[0].to[0].email,'ana.pledge@example.org')
  assert.match(messages[0].content[0].value,/\$100\.00/)
  assert.match(messages[0].content[0].value,/Library/)
  const wrong=await h.command('gift.record',{donorId:ana.id,amount:'100',receivedOn,method:'check',goods:'none',fund:'Other'})
  await h.command('pledge.match',{giftId:wrong.id,installmentId},{status:409})
  const gift=await h.command('gift.record',{donorId:ana.id,amount:'60',receivedOn,method:'check',goods:'none',fund:'Library',installmentId})
  p=(await history()).pledges.find(p=>p.id===pledge.id)
  assert.equal(p.paid_cents,6000)
  assert.equal(p.installments[0].remaining_cents,4000)
  const final=await h.command('gift.record',{donorId:ana.id,amount:'40',receivedOn,method:'check',goods:'none',fund:'Library'})
  await h.command('pledge.match',{giftId:final.id,installmentId})
  await h.command('pledge.match',{giftId:final.id,installmentId},{status:409})
  p=(await history()).pledges.find(p=>p.id===pledge.id)
  assert.equal(p.paid_cents,10000)
  assert.equal(p.remaining_cents,10000)
  assert.equal(p.installments[0].remaining_cents,0)
  assert.equal((await h.command('pledge.remind',{pledgeId:p.id})).submitted,0)
  assert.equal(messages.length,1)
  await h.command('gift.reverse',{giftId:gift.id,reason:'Synthetic returned check'})
  p=(await history()).pledges.find(p=>p.id===pledge.id)
  assert.equal(p.paid_cents,4000)
  assert.equal(p.installments[0].remaining_cents,6000)
  // Payment before the reminder is due excludes it from mail entirely.
  const paid=await h.command('pledge.create',{...schedule,amount:'25',installments:[{dueOn:day(3),amount:'25'}]})
  const pending=(await history()).pledges.find(p=>p.id===paid.id)
  await h.command('gift.record',{donorId:ana.id,amount:'25',receivedOn,method:'check',goods:'none',fund:'Library',installmentId:pending.installments[0].id})
  assert.equal((await h.command('pledge.remind',{pledgeId:paid.id})).submitted,0)
  assert.equal(messages.length,1)
  const uncertainPledge=await h.command('pledge.create',{...schedule,amount:'10',installments:[{dueOn:day(4),amount:'10'}]})
  uncertainNext=true
  assert.equal((await h.command('pledge.remind',{pledgeId:uncertainPledge.id})).uncertain,1)
  assert.equal((await history()).pledges.find(p=>p.id===uncertainPledge.id).installments[0].reminder_status,'uncertain')
  assert.equal((await h.command('pledge.remind',{pledgeId:uncertainPledge.id})).submitted,0)
  assert.equal(messages.length,2)
  const page=await h.request(`/app/donors/${ana.id}`)
  assert.equal(page.status,200)
  const html=await page.text()
  assert.match(html,/name="schedule"/)
  assert.match(html,/name="installmentId"/)
 },{bindings:{MAIL_PROVIDER:'sendgrid'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.sendgrid.com')
  assert.equal(new URL(request.url).pathname,'/v3/mail/send')
  messages.push(await request.json())
  if(uncertainNext){uncertainNext=false;return new Response(null,{status:202})}
  return new Response(null,{status:202,headers:{'x-message-id':`pledge-message-${messages.length}`}})
 }})
})
