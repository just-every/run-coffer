import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'

const receivedOn='2026-09-01'
const payment=donorId=>({donorId,amount:'1000',receivedOn,method:'check',goods:'none'})
const funds=async h=>(await h.get('/api/coffer/reports/funds')).funds
const amounts=rows=>Object.fromEntries(rows.map(r=>[r.fund,r.amount_cents]))

test('a split check keeps one payment and one receipt while reporting each fund and its reversal',()=>run(async h=>{
 await reviewed(h)
 const person=await donor(h,'Nora Split'),input={...payment(person.id),allocations:[{fund:'Library',amountCents:60000},{fund:'Meals',amountCents:40000}]}
 await h.command('gift.record',input,{as:'',status:401})
 await h.command('gift.record',{...input,allocations:[{fund:'Library',amountCents:60000},{fund:'Meals',amountCents:39999}]},{status:400})
 await h.command('gift.record',{...input,allocations:[{fund:'Library',amount:'600.001'},{fund:'Meals',amount:'399.999'}]},{status:400})
 await h.command('gift.record',{...input,allocations:[{fund:'Library',amount:'1000'},{fund:'Meals',amount:'0'}]},{status:400})
 await h.command('gift.record',{...input,allocations:[{fund:'Library',amount:'600'},{fund:'Library',amount:'400'}]},{status:400})
 const gift=await h.command('gift.record',input)
 const history=await h.get(`/api/coffer/donors/${person.id}`)
 assert.equal(history.gifts.length,1)
 assert.equal(history.gifts[0].id,gift.id)
 assert.equal(history.totals.lifetimeCents,100000)
 assert.deepEqual(amounts(await funds(h)),{Library:60000,Meals:40000})
 const exported=await h.request('/app/funds/ledger.csv');assert.equal(exported.status,200)
 const csv=await exported.text();assert.match(csv,/600.00/);assert.match(csv,/400.00/)
 const saved=await archive(h),fresh=await installation()
 try{await restore(fresh,saved);assert.deepEqual(amounts(await funds(fresh)),{Library:60000,Meals:40000})}finally{await fresh.close()}
 await h.command('consent.record',{donorIds:[person.id],channel:'email',status:'granted',method:'paper form',evidence:'Requests updates on food programmes',capturedOn:receivedOn})
 const appeal=await h.command('appeal.prepare',{name:'Meals supporters',channel:'email',fund:'Meals'});assert.equal(appeal.recipients,1)
 const batch=await h.command('ack.prepare'),receipt=await h.get(`/api/coffer/letters/${batch.id}`)
 assert.equal(receipt.letters.length,1)
 assert.equal(receipt.letters[0].gift_id,gift.id)
 assert.equal(receipt.letters[0].amount_cents,100000)
 assert.match(receipt.letters[0].body,/\$1,000\.00/)
 await h.command('ack.discard',{batchId:batch.id,version:1})
 await h.command('gift.record',{...payment(person.id),amount:'25',fund:'Library'})
 assert.deepEqual(amounts(await funds(h)),{Library:62500,Meals:40000})
 await h.command('gift.reverse',{giftId:gift.id,reason:'Returned check',reversedOn:'2026-09-02'})
 assert.deepEqual(amounts(await funds(h)),{Library:2500,Meals:0})
 assert.equal((await h.get(`/api/coffer/donors/${person.id}`)).totals.lifetimeCents,2500)
}))

test('campaign allocations use their own funds, remain exact for large payments, and refuse ambiguous pledge attribution',()=>run(async h=>{
 const person=await donor(h,'Omar Campaign')
 const create=(name,fund)=>h.api('/api/coffer/giving/campaigns',{name,slug:name.toLowerCase(),description:'Fundraising campaign',fund,goal:'1000'})
 const library=await create('Books','Library'),meals=await create('Lunches','Meals')
 const input={...payment(person.id),amountCents:10000000000,allocations:[{campaignId:library.id,amountCents:6000000001},{campaignId:meals.id,amountCents:3999999999}]}
 await h.command('gift.record',{...input,allocations:[{campaignId:'missing',amountCents:6000000001},input.allocations[1]]},{status:400})
 await h.command('gift.record',{...input,allocations:[{...input.allocations[0],fund:'Meals'},input.allocations[1]]},{status:400})
 const pledge=await h.command('pledge.create',{donorId:person.id,amount:'1000',pledgedOn:'2026-08-01',fund:'Library',installments:[{dueOn:'2026-09-10',amount:'1000'}]})
 await h.command('gift.record',{...input,pledgeId:pledge.id},{status:400})
 const gift=await h.command('gift.record',input)
 const history=await h.get(`/api/coffer/donors/${person.id}`),installmentId=history.pledges.find(p=>p.id===pledge.id).installments[0].id
 await h.command('pledge.match',{giftId:gift.id,installmentId},{status:409})
 assert.deepEqual(amounts(await funds(h)),{Library:6000000001,Meals:3999999999})
 const campaigns=(await h.get('/api/coffer/giving/campaigns')).campaigns
 assert.equal(campaigns.find(c=>c.id===library.id).raised_cents,6000000001)
 assert.equal(campaigns.find(c=>c.id===meals.id).raised_cents,3999999999)
 assert.equal(history.gifts.length,1)
 assert.equal(history.totals.lifetimeCents,10000000000)
 await h.command('gift.reverse',{giftId:gift.id,reason:'Campaign check returned',reversedOn:'2026-09-02'})
 assert.deepEqual(amounts(await funds(h)),{Library:0,Meals:0})
 for(const campaign of (await h.get('/api/coffer/giving/campaigns')).campaigns)assert.equal(campaign.raised_cents,0)
}))

test('FIN-003: restricted funds carry purpose and time to accounting and release only received gifts',()=>run(async h=>{
 const nora=await donor(h,'Nora Restricted'),member=await h.person('finance.member@example.test')
 await h.command('fund.define',{name:'Library',restriction:'purpose',detail:'Books for local schools'},{as:'',status:401})
 await h.command('fund.define',{name:'Library',restriction:'purpose',detail:'Books for local schools'},{as:member.cookie,status:403})
 await h.command('fund.define',{name:'Library',restriction:'purpose',detail:'Books for local schools'})
 await h.command('fund.define',{name:'Next year',restriction:'time',detail:'Use after the grant period',releaseOn:'2027-01-01'})
 await h.command('fund.define',{name:'Operating',restriction:'unrestricted'})
 await h.command('fund.define',{name:'Library',restriction:'unrestricted'},{status:409})
 await h.command('fund.define',{name:'Bad time',restriction:'time',detail:'Missing date'},{status:400})
 const gift=await h.command('gift.record',{...payment(nora.id),allocations:[{fund:'Library',amount:'600'},{fund:'Next year',amount:'400'}]})
 await h.command('gift.record',{...payment(nora.id),amount:'125',fund:'Operating'})
 const spend={fund:'Library',amount:'250',spentOn:'2026-09-10',reference:'BILL-101',note:'School books received'}
 await h.command('fund.spend',spend,{as:member.cookie,status:403})
 await h.command('fund.spend',{...spend,fund:'Operating'},{status:409})
 await h.command('fund.spend',{...spend,amount:'601'},{status:409})
 await h.command('fund.spend',{...spend,spentOn:'2026-08-31'},{status:409})
 await h.command('fund.spend',spend)
 await h.command('fund.spend',spend,{status:409})
 const report=await h.get('/api/coffer/reports/restrictions?through=2026-09-30'),byName=Object.fromEntries(report.funds.map(f=>[f.fund,f]))
 assert.deepEqual(report.spends.map(s=>[s.fund,s.amount_cents,s.reference]),[['Library',25000,'BILL-101']])
 assert.deepEqual([byName.Library.given_cents,byName.Library.spent_cents,byName.Library.held_cents],[60000,25000,35000])
 assert.deepEqual([byName['Next year'].given_cents,byName['Next year'].held_cents],[40000,40000])
 assert.deepEqual([byName.Operating.given_cents,byName.Operating.held_cents],[12500,0])
 assert.equal((await h.get('/api/coffer/reports/restrictions?through=2026-09-05')).spends.length,0)
 const matured=(await h.get('/api/coffer/reports/restrictions?through=2027-01-01')).funds.find(f=>f.fund==='Next year')
 assert.deepEqual([matured.released_cents,matured.held_cents],[40000,0])
 const ledger=await (await h.request('/app/funds/ledger.csv')).text()
 assert.match(ledger,/Purpose restricted: Books for local schools/)
 assert.match(ledger,/Time restricted: Use after the grant period; release 2027-01-01/)
 await h.get('/api/coffer/reports/restrictions',{as:'',status:401})
 await h.get('/api/coffer/reports/restrictions?through=2026-99-01',{status:400})
 if(process.env.COFFER_RESTRICTION_BROWSER){const {restrictedFundsBrowser}=await import('./restricted-funds-browser.mjs');await restrictedFundsBrowser(h,process.env.COFFER_RESTRICTION_BROWSER)}
 await h.command('gift.reverse',{giftId:gift.id,reason:'Returned grant',reversedOn:'2026-09-20'})
 const reversed=(await h.get('/api/coffer/reports/restrictions?through=2026-09-30')).funds.find(f=>f.fund==='Library')
 const spent=process.env.COFFER_RESTRICTION_BROWSER?27000:25000
 assert.deepEqual([reversed.given_cents,reversed.spent_cents,reversed.held_cents],[0,spent,-spent],'Overspent restrictions remain visible after a refund')
}))
