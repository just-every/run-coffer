import assert from 'node:assert/strict'
import {run,donor,reviewed,settings,archive,restore} from './harness.mjs'

export const receiptRulesJourney=()=>run(async h=>{
 await reviewed(h)
 const member=await h.person('receipt-entry@example.test')
 const d=await donor(h,'Morgan Receipt Rules')
 const record=(amount,goods='none',extra={},options={})=>h.command('gift.record',{donorId:d.id,amount,goods,receivedOn:'2026-03-12',method:'check',...extra},options)
 await record('300','religious',{goodsDescription:'Admission to a religious ceremony'},{status:409})
 await record('100','token',{goodsDescription:'Logo mug',goodsValue:'20',tokenBasis:'logo_cost',tokenCost:'8',onlyBenefit:true,charityLogo:true},{status:409})
 const ruleInput={...settings,threshold:'1000',religiousOrganization:'yes',tokenYear:2026,tokenMaxValue:'139',tokenMinGift:'69.50',tokenMaxCost:'13.90',tokenReviewed:'yes'}
 await h.command('settings.update',{...ruleInput,version:2},{as:member.cookie,status:403})
 await h.command('settings.update',{...ruleInput,version:2,ein:''},{status:400})
 await h.command('settings.update',{...ruleInput,version:2,letterTemplate:settings.letterTemplate.replace('EIN {{ein}}.','')},{status:400})
 await h.command('settings.update',{...ruleInput,version:2})
 await h.command('settings.update',{...ruleInput,version:2},{status:409})
 const cash=await record('250'),ticket=await record('80','provided',{goodsValue:'50',goodsDescription:'Gala dinner'})
 const at75=await record('75','provided',{goodsValue:'50',goodsDescription:'Small dinner'})
 const mug=await record('100','token',{goodsDescription:'Charity logo mug',goodsValue:'20',tokenBasis:'logo_cost',tokenCost:'8',onlyBenefit:true,charityLogo:true},{as:member.cookie})
 const tiny=await record('300','token',{goodsDescription:'Bookmark',goodsValue:'6',tokenBasis:'fair_value',onlyBenefit:true,fundraisingCampaign:true})
 await record('300','token',{goodsDescription:'Bookmark',goodsValue:'6.01',tokenBasis:'fair_value',onlyBenefit:true,fundraisingCampaign:true},{status:400})
 await record('69.49','token',{goodsDescription:'Logo mug',goodsValue:'20',tokenBasis:'logo_cost',tokenCost:'8',onlyBenefit:true,charityLogo:true},{status:400})
 await record('100','token',{goodsDescription:'Logo mug',goodsValue:'20',tokenBasis:'logo_cost',tokenCost:'13.91',onlyBenefit:true,charityLogo:true},{status:400})
 await record('300','token',{receivedOn:'2025-03-12',goodsDescription:'Bookmark',goodsValue:'1',tokenBasis:'fair_value',onlyBenefit:true,fundraisingCampaign:true},{status:409})
 const religious=await record('300','religious',{goodsDescription:'Admission to a religious ceremony'})
 const batch=await h.command('ack.prepare')
 const detail=await h.get(`/api/coffer/letters/${batch.id}`)
 assert.deepEqual(detail.letters.map(l=>l.gift_id).sort(),[cash.id,ticket.id,tiny.id,religious.id].sort())
 const letter=id=>detail.letters.find(l=>l.gift_id===id).body
 for(const id of [cash.id,ticket.id,tiny.id,religious.id]){assert.match(letter(id),/Riverbend Literacy Project/);assert.match(letter(id),/12-3456789/);assert.match(letter(id),/March 12, 2026/)}
 assert.match(letter(cash.id),/\$250\.00/);assert.match(letter(cash.id),/No goods or services/)
 assert.match(letter(ticket.id),/Gala dinner worth \$50\.00/);assert.match(letter(ticket.id),/excess.*\$30\.00/)
 assert.match(letter(tiny.id),/insubstantial.*2026/);assert.match(letter(tiny.id),/\$300\.00/)
 assert.match(letter(religious.id),/solely|entirely of intangible religious benefits/);assert.doesNotMatch(letter(religious.id),/worth|\$0\.00|good-faith.*value/)
 // The low-value mug is below the queue threshold, but its annual receipt must use the same frozen exception.
 const annual=await h.command('ack.prepareStatements',{year:2026,donorId:d.id})
 const statement=(await h.get(`/api/coffer/letters/${annual.id}`)).letters[0]
 assert.match(statement.body,/Charity logo mug.*insubstantial|insubstantial.*Charity logo mug/s)
 assert.match(statement.body,/Total deductible portion: \$1,005\.00/)
 const property=await h.command('inKind.save',{donorId:d.id,description:'Donated laptop',quantity:'1',statedValue:'600',receivedOn:'2026-03-12',goods:'none',fund:'Unrestricted'})
 const propertyAck=await h.command('inKind.acknowledge',{donorId:d.id,inKindId:property.id,version:1,acknowledgedOn:'2026-03-12'})
 const propertyState=(await h.get(`/api/coffer/donors/${d.id}`)).inKind
 assert.match(propertyState.gifts[0].acknowledgments[0].body,/Donated laptop/);assert.doesNotMatch(propertyState.gifts[0].acknowledgments[0].body,/600|\$600/)
 await h.command('ack.approve',{batchId:batch.id,version:1})
 const saved=await archive(h)
 await run(async fresh=>{await restore(fresh,saved);assert.equal((await fresh.get(`/api/coffer/donors/${d.id}`)).gifts.find(g=>g.id===mug.id).receipt_benefit.costCents,800);assert.equal((await fresh.get(`/api/coffer/letters/${batch.id}`)).letters.find(l=>l.gift_id===religious.id).body,letter(religious.id))})
 if(process.env.COFFER_RECEIPT_BROWSER){const {receiptRulesBrowser}=await import('./receipt-rules-browser.mjs');await receiptRulesBrowser(h,d.id,batch.id,process.env.COFFER_RECEIPT_BROWSER)}
 const batches=(await h.get('/api/coffer/letters')).batches
 for(const b of batches){
  if(b.status==='prepared')await h.command('ack.discard',{batchId:b.id,version:b.version})
  else if(b.status==='approved')await h.command('ack.printed',{batchId:b.id,version:b.version})
 }
 const snapshot=(await h.get(`/api/coffer/donors/${d.id}`)).gifts.filter(g=>g.source!=='in_kind').map(g=>[g.id,g.amount_cents,g.received_on,g.fund])
 const other=await donor(h,'Receipt Rules Surviving Record')
 const comparison=await h.get(`/api/coffer/duplicates/compare?source=${d.id}&target=${other.id}`)
 const merged=await h.command('donor.merge',{sourceDonorId:d.id,donorId:other.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
 assert.equal((await h.get(`/api/coffer/donors/${other.id}`)).gifts.find(g=>g.id===mug.id).receipt_benefit.costCents,800)
 await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
 assert.deepEqual((await h.get(`/api/coffer/donors/${d.id}`)).gifts.filter(g=>g.source!=='in_kind').map(g=>[g.id,g.amount_cents,g.received_on,g.fund]),snapshot)
 const latest=await h.get('/api/coffer/settings')
 await h.command('settings.update',{...ruleInput,version:latest.version,tokenYear:2027,tokenMaxValue:'150',religiousOrganization:'no'})
 assert.equal((await h.get(`/api/coffer/letters/${batch.id}`)).letters.find(l=>l.gift_id===religious.id).body,letter(religious.id),'Existing approved receipts retain their original wording after rule changes')
 assert.equal((await h.get(`/api/coffer/donors/${d.id}`)).gifts.find(g=>g.id===mug.id).receipt_benefit.year,2026)
 await h.command('donor.erase',{donorId:d.id,confirm:'ERASE'})
 assert.ok(!JSON.stringify(await archive(h)).includes('Charity logo mug'))
 const anonymous=(await h.get('/api/coffer/donors')).donors
 assert.ok(!anonymous.some(row=>row.id===d.id))
})
