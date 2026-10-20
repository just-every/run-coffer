import {receiptRulesJourney} from './receipt-rules-journey.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'

const gift=(h,donorId,amount,receivedOn='2025-08-10',extra={})=>h.command('gift.record',{donorId,amount,receivedOn,method:'check',goods:'none',...extra})

test('RCPT-002 RCPT-006: approved receipts survive marketing opt-outs, send once, track delivery and route bounces to print',async()=>{const {receiptDeliveryJourney}=await import('./receipt-delivery-journey.mjs');await receiptDeliveryJourney()})

test('a calendar-year statement itemizes every unreversed gift and totals deductible giving',()=>run(async h=>{
 await reviewed(h)
 const ana=await donor(h,'Ana Diaz',{email:null})
 const tributeGift=await gift(h,ana.id,'150','2025-03-01',{goods:'provided',goodsValue:'60',goodsDescription:'gala dinner'})
 await h.command('tribute.record',{giftId:tributeGift.id,kind:'memory',honoree:'Leela Diaz',notifiedName:'Mira Diaz'})
 await gift(h,ana.id,'25.50','2025-12-31')
 await gift(h,ana.id,'900','2024-12-31')
 const reversed=await gift(h,ana.id,'80','2025-06-01')
 await h.command('gift.reverse',{giftId:reversed.id,reason:'Check returned'})
 const b=await h.command('ack.prepareStatements',{year:2025})
 assert.equal(b.totalCents,17550)
 const d=await h.get(`/api/coffer/letters/${b.id}`),l=d.letters[0]
 assert.equal(l.amount_cents,17550)
 assert.match(l.body,/Total gifts: \$175\.50/)
 assert.equal(l.body.match(/Dear Ana Diaz/g).length,1,'One letter per statement, never a letter per gift')
 assert.deepEqual(l.body.match(/^\d+\. .+$/gm).map(line=>line.split(' · ')[0]),['1. March 1, 2025','2. December 31, 2025'],'Each gift is listed once')
 assert.match(l.body,/Total deductible portion: \$115\.50/)
 assert.match(l.body,/March 1, 2025/);assert.match(l.body,/December 31, 2025/)
 assert.match(l.body,/gala dinner worth \$60\.00/)
 assert.doesNotMatch(l.body,/\$900\.00|\$80\.00/)
 assert.equal(JSON.parse(l.statement_gifts).length,2)
 assert.equal(JSON.parse(l.statement_gifts).find(g=>g.id===tributeGift.id).tribute.honoree,'Leela Diaz')
 assert.ok(l.body.includes('Leela Diaz'))
 await h.command('ack.approve',{batchId:b.id,version:1})
 const sent=await h.command('ack.send',{batchId:b.id,version:2})
 assert.equal(sent.print,1)
 assert.equal((await h.get(`/api/coffer/donors/${ana.id}`)).letters[0].statement_year,2025)
 const print=await h.request(`/app/letters/${b.id}/print`);assert.equal(print.status,200);assert.match(await print.text(),/Total gifts: \$175\.50/)
 await h.command('ack.prepareStatements',{year:2025},{status:409})
 await gift(h,ana.id,'10','2025-11-01')
 const changed=await h.request(`/app/letters/${b.id}/print`);assert.equal(changed.status,409)
}))


test('RCPT-005: written acknowledgments, quid pro quo, frozen token exceptions, religious and property receipts',receiptRulesJourney)

test('RCPT-007: reviewed thank-you templates by kind and campaign, checked facts, precedence and the version on every letter',async()=>{const {letterTemplatesJourney}=await import('./letter-templates-journey.mjs');await letterTemplatesJourney()})

test('RCPT-008: annual receipt numbers, half-refund corrections, voided reversals, property custody and approved corrected delivery',async()=>{const {receiptCorrectionsJourney}=await import('./receipt-corrections-journey.mjs');await receiptCorrectionsJourney()})
