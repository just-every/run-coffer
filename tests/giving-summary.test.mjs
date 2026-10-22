import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run, donor, reviewed, settings } from './harness.mjs'

// DONOR-011: the API and record page tell the same ledger-derived story.
test('giving summary follows fiscal boundaries, reversals, pledges and separate recognition', () => run(async h => {
 await reviewed(h)
 let s = await h.get('/api/coffer/settings')
 await h.command('settings.update', {...settings, version:s.version, fiscalYearStart:'02-30'}, {status:400})
 await h.command('settings.update', {...settings, version:s.version, fiscalYearStart:'07-01',timezone:'UTC'})
 const ana = await donor(h, 'Ana Summary'), sponsor = await donor(h, 'Summary Sponsor')
 const currentDay = new Date().toISOString().slice(0,10)
 const fiscalYear = Number(new Date().toISOString().slice(0,4)) - (new Date().toISOString().slice(5,10) < '07-01' ? 1 : 0)
 const give = (amount, receivedOn, donorId=ana.id) => h.command('gift.record', {donorId,amount,receivedOn,method:'check',goods:'none'})
 await give('100', `${fiscalYear-2}-07-01`)
 await give('300', `${fiscalYear-1}-06-30`)
 await give('450', `${fiscalYear-1}-07-01`)
 const reversed = await give('900', `${fiscalYear}-07-01`)
 await h.command('gift.reverse', {giftId:reversed.id,reason:'Returned check',reversedOn:currentDay})
 const recentGift=await give('250', currentDay)
 const outside = await give('500', currentDay,sponsor.id)
 await h.command('softCredit.record',{giftId:outside.id,donorId:ana.id,amount:'125'})
 await h.command('pledge.create',{donorId:ana.id,amount:'1200',pledgedOn:`${fiscalYear}-07-01`,fund:'Unrestricted',installments:[{dueOn:`${fiscalYear+1}-07-01`,amount:'1200'}]})
 const history = await h.get(`/api/coffer/donors/${ana.id}`), summary = history.summary
 assert.equal(summary.lifetimeCents,110000)
 assert.equal(summary.giftCount,4)
 assert.equal(summary.firstGift.amountCents,10000)
 assert.equal(summary.firstGift.receivedOn,`${fiscalYear-2}-07-01`)
 assert.equal(summary.largestGift.amountCents,45000)
 assert.equal(summary.lastGift.amountCents,25000)
 assert.equal(summary.consecutiveGivingYears,3)
 assert.equal(summary.openPledgeCents,120000)
 assert.equal(summary.softCreditCents,12500)
 assert.deepEqual(summary.recurring,[])
 assert.equal(summary.fiscalYear.currentCents,25000)
 assert.equal(summary.fiscalYear.previousCents,45000)
 assert.equal(summary.fiscalYear.start,`${fiscalYear}-07-01`)
 const html = await (await h.request(`/app/donors/${ana.id}`)).text()
 for (const cents of [summary.lifetimeCents,summary.openPledgeCents,summary.softCreditCents,summary.largestGift.amountCents]) assert.ok(html.includes((cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'})))
 // RCPT-010: the recipient's actual prepared receipt carries the same business
 // facts, with recognition separate from hard gifts and no reversed gift count.
 await h.command('letterTemplate.save',{kind:'major_gift',minAmount:'1',name:'Giving summary receipt',subject:'Your giving',body:'{{donor_name}} {{amount}} {{gift_date}} {{goods_statement}} {{organization}} {{ein}}\nSummary: {{total_given}}; {{gift_count}}; {{first_gift_amount}} {{first_gift_date}}; {{largest_gift_amount}} {{largest_gift_date}}; {{last_gift_amount}} {{last_gift_date}}; {{consecutive_giving_years}}; {{current_fiscal_year_given}}; {{previous_fiscal_year_given}}; {{open_pledge_balance}}; {{soft_credit_total}}; {{recurring_plan_count}}'})
 const batch=await h.command('ack.prepare',{giftIds:[recentGift.id]})
 const letter=(await h.get('/api/coffer/letters/'+batch.id)).letters[0]
 assert.equal(letter.body.split('\nSummary: ')[1],`$1,100.00; 4; $100.00 ${fiscalYear-2}-07-01; $450.00 ${fiscalYear-1}-07-01; $250.00 ${currentDay}; 3; $250.00; $450.00; $1,200.00; $125.00; 0`)
 await h.get(`/api/coffer/donors/${ana.id}`,{as:'',status:401})
}))
