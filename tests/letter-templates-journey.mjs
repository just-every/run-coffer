import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore} from './harness.mjs'

const householdFields=['household_addressee','household_informal_salutation','household_formal_salutation']
const householdLine='Household: {{household_addressee|Individual donor}} / {{household_informal_salutation|Individual greeting}} / {{household_formal_salutation|Individual formal greeting}}'
const body='Dear {{donor_name}}, thank you for {{amount|Amount unavailable}} on {{gift_date}} to {{fund}}. {{goods_statement}} {{organization}} · EIN {{ein}}\nEmail: {{email|No email recorded}}\nAddress: {{postal_address|No postal address recorded}}'
const gift=(h,donorId,amount,receivedOn,extra={})=>h.command('gift.record',{donorId,amount,receivedOn,method:'check',goods:'none',...extra})

export async function letterTemplatesJourney(){
 await run(async h=>{
  await reviewed(h)
  const catalog=await h.get('/api/coffer/template-fields')
  assert.equal((await h.request('/api/coffer/template-fields',{as:''})).status,401)
  for(const entry of [catalog.settings,...catalog.templates]) {
   assert.ok(entry.fields.includes('email')&&entry.fields.includes('postal_address'))
   assert.ok(householdFields.every(field=>entry.fields.includes(field)))
   assert.ok(entry.required.every(field=>entry.fields.includes(field)))
  }
  const settingsVersion=(await h.get('/api/coffer/settings')).version
  const member=await h.person('templates.member@example.test')
  const save=(input,options)=>h.command('letterTemplate.save',input,options)
  // Each template is checked for the required receipt facts before it can be used.
  assert.equal((await save({kind:'first_gift',name:'First gift',subject:'Welcome',body:body.replace('{{goods_statement}} ','')},{status:400})).error,'TEMPLATE')
  assert.equal((await save({kind:'first_gift',name:'First gift',subject:'Welcome',body:body+' {{unrecognized_field}}'},{status:400})).error,'TEMPLATE')
  await save({kind:'first_gift',name:'First gift',subject:'Welcome',body},{as:member.cookie,status:403})
  await save({kind:'first_gift',name:'Unknown default',subject:'Welcome',body:body+' {{unknown_field|a default}}'},{status:400})
  await save({kind:'first_gift',name:'Nested default',subject:'Welcome',body:body+' {{email|{{donor_name}}}}'},{status:400})
  await save({kind:'first_gift',name:'Empty default',subject:'Welcome',body:body+' {{email| }}'},{status:400})
  // All current RCPT-007 kinds accept household tokens without changing required receipt facts.
  for(const {kind,required} of catalog.templates) {
   const sample={kind,name:'Household fields '+kind,subject:'Thank you {{household_formal_salutation|Supporter}}',body:required.map(f=>'{{'+f+'}}').join(' ')+'\n'+householdLine,...(kind==='major_gift'?{minAmount:'1000'}:{})}
   if(kind==='campaign')continue // The real campaign template below proves the same fields.
   const saved=await save(sample)
   const stored=(await h.get('/api/coffer/letter-templates')).templates.find(t=>t.id===saved.id)
   assert.ok(stored.body.includes('{{household_addressee|Individual donor}}'))
   await h.command('letterTemplate.retire',{templateId:saved.id,version:1})
  }
  const first=await save({kind:'first_gift',name:'First gift',subject:'Welcome, {{donor_name}}',body:'FIRST '+body})
  assert.equal(first.version,1)
  assert.equal((await save({templateId:first.id,version:1,name:'First gift',subject:'Welcome, {{donor_name}}',body:'FIRST v2 '+body})).version,2)
  await save({templateId:first.id,version:1,name:'Stale',subject:'Welcome',body},{status:409})
  assert.equal((await save({kind:'first_gift',name:'Second first-gift template',subject:'Welcome',body},{status:409})).error,'TEMPLATE_EXISTS')
  const major=await save({kind:'major_gift',name:'Major gift',minAmount:'1000',subject:'With gratitude',body:'MAJOR '+body})
  const tribute=await save({kind:'tribute',name:'Tribute',subject:'In tribute',body:'TRIBUTE '+body})
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Spring books',slug:'spring-books-templates',description:'Books and tutoring for our spring readers.',fund:'Reading',goal:'5000'})
  const spring=await save({kind:'campaign',campaignId:campaign.id,name:'Spring books thanks',subject:'Spring thanks',body:'CAMPAIGN '+body+'\n'+householdLine})
  // In-kind templates never merge a value; year-end templates must carry the itemized facts.
  await save({kind:'in_kind',name:'Property',subject:'Property',body:'{{donor_name}} {{gift_date}} {{description}} {{amount}} {{goods_statement}} {{organization}} {{ein}}'},{status:400})
  const property=await save({kind:'in_kind',name:'Property thanks',subject:'Your donated {{description}}',body:'PROPERTY Dear {{donor_name}}, on {{gift_date}} we received {{description|Property contribution}} (quantity {{quantity}}). {{goods_statement}} {{organization}} EIN {{ein}}\nEmail: {{email|No email recorded}}\nAddress: {{postal_address|No postal address recorded}}'})
  await save({kind:'year_end',name:'Year end',subject:'{{year}}',body:'Dear {{donor_name}} {{gift_list}} {{goods_statement}} {{organization}} {{ein}}'},{status:400})
  const yearEnd=await save({kind:'year_end',name:'Annual statement',subject:'Your {{year}} giving',body:householdLine+'\nYEAR-END Dear {{donor_name}}, your {{year}} gifts:\n{{gift_list}}\nTotal {{total|Total unavailable}} · goods {{goods_total}} · deductible {{deductible_total}}\n{{goods_statement}}\n{{organization}} EIN {{ein}}\nEmail: {{email|No email recorded}}\nAddress: {{postal_address|No postal address recorded}}'})

  const ana=await donor(h,'Ana Template'),bo=await donor(h,'Bo Template',{email:null,addressLine1:null,city:null,region:null,postalCode:null}),cy=await donor(h,'Cy Template')
  const a1=await gift(h,ana.id,'300','2025-08-01'),a2=await gift(h,ana.id,'400','2025-08-02'),a3=await gift(h,ana.id,'1500','2025-08-03')
  const a4=await gift(h,ana.id,'2000','2025-08-04',{fund:'Reading',campaignId:campaign.id}),a5=await gift(h,ana.id,'1200','2025-08-05')
  await h.command('tribute.record',{giftId:a5.id,kind:'memory',honoree:'Leela Template'})
  const b1=await gift(h,bo.id,'1000','2025-08-06'),c1=await gift(h,cy.id,'999.99','2025-08-07')
  const batch=await h.command('ack.prepare',{})
  const letters=(await h.get('/api/coffer/letters/'+batch.id)).letters,of=g=>letters.find(l=>l.gift_id===g.id)
  // Precedence: form or campaign, tribute, major gift (inclusive minimum), first gift, then the settings letter.
  assert.deepEqual([a1,a2,a3,a4,a5,b1,c1].map(g=>[of(g).template_kind,of(g).template_id,of(g).template_version]),[
   ['first_gift',first.id,2],['default',null,settingsVersion],['major_gift',major.id,1],['campaign',spring.id,1],['tribute',tribute.id,1],['major_gift',major.id,1],['first_gift',first.id,2]])
  assert.equal(of(a1).subject,'Welcome, Ana Template');assert.match(of(a1).body,/^FIRST v2 Dear Ana Template, thank you for \$300\.00 on August 1, 2025/)
  assert.match(of(a1).body,/EIN 12-3456789/);assert.match(of(a1).body,/No goods or services/)
  assert.ok(of(a1).body.includes('Email: '+(await h.get('/api/coffer/donors/'+ana.id)).donor.email))
  assert.ok(of(b1).body.includes('Email: No email recorded'))
  assert.ok(of(b1).body.includes('Address: No postal address recorded'))
  assert.ok(of(a1).body.includes('Address: 1 Main Street\nSpringfield\nIL\n62701'))
  assert.doesNotMatch(of(a2).body,/^(FIRST|MAJOR|CAMPAIGN|TRIBUTE)/)
  assert.match(of(a4).body,/^CAMPAIGN /);assert.match(of(a5).body,/^TRIBUTE [\s\S]*memory of Leela Template/)
  const page=await (await h.request('/app/letters/'+batch.id)).text()
  assert.ok(page.includes('First gift template v2')&&page.includes('Settings letter template v'+settingsVersion)&&page.includes('Form or campaign template v1'))
  // A retired template stops applying; the next applicable kind takes over and its version is recorded.
  await h.command('ack.discard',{batchId:batch.id,version:1})
  await h.command('letterTemplate.retire',{templateId:spring.id,version:1},{as:member.cookie,status:403})
  assert.equal((await h.command('letterTemplate.retire',{templateId:spring.id,version:1})).version,2)
  const again=await h.command('ack.prepare',{giftIds:[a4.id]})
  assert.deepEqual((await h.get('/api/coffer/letters/'+again.id)).letters.map(l=>[l.template_kind,l.template_version]),[['major_gift',1]])
  assert.deepEqual((await h.get('/api/coffer/letter-templates')).templates.map(t=>[t.kind,t.version]),[['tribute',1],['major_gift',1],['first_gift',2],['in_kind',1],['year_end',1]])

  const laptop=await h.command('inKind.save',{donorId:ana.id,description:'Donated laptop',quantity:'2',statedValue:'600',receivedOn:'2025-09-01',goods:'none',fund:'Reading'})
  const ack=await h.command('inKind.acknowledge',{donorId:ana.id,inKindId:laptop.id,version:laptop.version,acknowledgedOn:'2025-09-02'})
  const issued=(await h.get('/api/coffer/in-kind?donorId='+ana.id)).gifts.find(g=>g.id===laptop.id).acknowledgments.find(a=>a.id===ack.acknowledgmentId)
  assert.deepEqual([issued.template_kind,issued.template_id,issued.template_version],['in_kind',property.id,1])
  assert.equal(issued.subject,'Your donated Donated laptop');assert.match(issued.body,/^PROPERTY Dear Ana Template, on September 1, 2025 we received Donated laptop \(quantity 2\)\. No goods or services/)
  assert.doesNotMatch(issued.body,/\$|600/)

  const statements=await h.command('ack.prepareStatements',{year:2025,donorId:bo.id})
  const statement=(await h.get('/api/coffer/letters/'+statements.id)).letters[0]
  assert.deepEqual([statement.template_kind,statement.template_id,statement.template_version],['year_end',yearEnd.id,1])
  assert.equal(statement.subject,'Your 2025 giving');assert.ok(statement.body.startsWith('Household: Individual donor / Individual greeting / Individual formal greeting\n'));assert.match(statement.body.split('\n').slice(1).join('\n'),/^YEAR-END Dear Bo Template, your 2025 gifts:\n1\. August 6, 2025 · [^\n]* · \$1,000\.00 · goods or services: none · deductible \$1,000\.00\nTotal \$1,000\.00 · goods \$0\.00 · deductible \$1,000\.00/)

  assert.ok(issued.body.includes('Email: '+(await h.get('/api/coffer/donors/'+ana.id)).donor.email))
  assert.ok(statement.body.includes('Email: No email recorded'))
  const recurring=await save({kind:'recurring_start',name:'Monthly receipt',subject:'Monthly thanks',body})
  await h.command('letterTemplate.retire',{templateId:recurring.id,version:1})
  const settingsPage=await (await h.request('/app/settings')).text()
  assert.ok(settingsPage.includes('Thank-you templates')&&settingsPage.includes('Annual statement')&&settingsPage.includes('$1,000.00 or more'))
  if(process.env.COFFER_RCPT007_BROWSER){const {letterTemplatesBrowser}=await import('./letter-templates-browser.mjs');await letterTemplatesBrowser(h,{batchId:again.id,statementId:statements.id,directory:process.env.COFFER_RCPT007_BROWSER})}
  // RCPT-010: report every prepared recipient with a blank, deduplicating
  // repeated tokens across subject/body; absent fields with defaults are safe.
  const dee=await donor(h,'Dee Review',{email:null,addressLine1:null,city:null,region:null,postalCode:null})
  const eli=await donor(h,'Eli Review')
  const fay=await donor(h,'Fay Review',{email:null,household:'Review household'})
  const reviewBody=body+'\nUn-defaulted contact: {{email}} / {{postal_address}}'
  await save({templateId:first.id,version:2,name:'First gift',subject:'Thanks {{email}}',body:reviewBody})
  const reviewGifts=await Promise.all([dee,eli,fay].map(d=>gift(h,d.id,'300','2025-10-01')))
  const reviewBatch=await h.command('ack.prepare',{giftIds:reviewGifts.map(g=>g.id)})
  const review=await h.get('/api/coffer/letters/'+reviewBatch.id)
  assert.deepEqual(review.mergeReview.map(r=>({donorId:r.donorId,fields:r.fields})).sort((a,b)=>a.donorId.localeCompare(b.donorId)),[
   {donorId:dee.id,fields:['email','postal_address']},{donorId:fay.id,fields:['email']},
  ].sort((a,b)=>a.donorId.localeCompare(b.donorId)))
  assert.equal(review.mergeReview.find(r=>r.donorId===dee.id).recipientName,'Dee Review')
  assert.equal(review.mergeReview.find(r=>r.donorId===dee.id).letterId,review.letters.find(l=>l.donor_id===dee.id).id)
  assert.ok(review.letters.find(l=>l.donor_id===dee.id).body.includes('Un-defaulted contact:  / '))
  if(process.env.COFFER_RCPT007_BROWSER){const {mergeReviewBrowser}=await import('./letter-templates-browser.mjs');await mergeReviewBrowser(h,{batchId:reviewBatch.id,directory:process.env.COFFER_RCPT007_BROWSER,phase:'blanks'})}
  // Later donor and template edits cannot rewrite the prepared review or text.
  await h.command('donor.update',{donorId:dee.id,version:1,name:'Dee Corrected',email:'dee.corrected@example.test'})
  await save({templateId:first.id,version:3,name:'First gift',subject:'Thanks {{email|Contact not supplied}}',body:body+'\nUn-defaulted contact: {{email|Contact not supplied}} / {{postal_address|Address not supplied}}'})
  const unchanged=await h.get('/api/coffer/letters/'+reviewBatch.id)
  assert.deepEqual(unchanged.mergeReview,review.mergeReview)
  assert.deepEqual(unchanged.letters.map(l=>l.body),review.letters.map(l=>l.body))
  await h.command('ack.discard',{batchId:reviewBatch.id,version:1})
  const fixedBatch=await h.command('ack.prepare',{giftIds:reviewGifts.map(g=>g.id)})
  const fixed=await h.get('/api/coffer/letters/'+fixedBatch.id)
  assert.deepEqual(fixed.mergeReview,[])
  assert.ok(fixed.letters.find(l=>l.donor_id===dee.id).body.includes('dee.corrected@example.test / Address not supplied'))
  assert.ok(fixed.letters.find(l=>l.donor_id===fay.id).body.includes('Contact not supplied'))
  assert.ok(fixed.letters.find(l=>l.donor_id===eli.id).body.includes('eli.review@example.org'))
  if(process.env.COFFER_RCPT007_BROWSER){const {mergeReviewBrowser}=await import('./letter-templates-browser.mjs');await mergeReviewBrowser(h,{batchId:fixedBatch.id,directory:process.env.COFFER_RCPT007_BROWSER,phase:'fixed'})}
  await h.command('ack.approve',{batchId:fixedBatch.id,version:1})
  // Both individual and household annual statements expose the same review.
  const annualTemplate=(await h.get('/api/coffer/letter-templates')).templates.find(t=>t.id===yearEnd.id)
  await save({templateId:yearEnd.id,version:1,name:annualTemplate.name,subject:annualTemplate.subject,body:annualTemplate.body+'\nContact: {{email}}\nHousehold addressee: {{household_addressee}}'})
  const annualReviewBatch=await h.command('ack.prepareStatements',{year:2025,donorId:fay.id})
  const annualReview=await h.get('/api/coffer/letters/'+annualReviewBatch.id)
  assert.deepEqual(annualReview.mergeReview.map(r=>({donorId:r.donorId,fields:r.fields})),[{donorId:fay.id,fields:['email','household_addressee']}])
  const householdId=(await h.get('/api/coffer/donors/'+fay.id)).donor.household_id
  const family=await h.get('/api/coffer/households/'+householdId)
  await h.command('household.update',{householdId,version:family.household.version,addressee_override:'The Review Family',informal_override:'Review friends',formal_override:'The Review Household'})
  const householdBatch=await h.command('ack.prepareStatements',{year:2025,householdId})
  const householdReview=await h.get('/api/coffer/letters/'+householdBatch.id)
  assert.deepEqual(householdReview.mergeReview.map(r=>r.fields),[['email']])
  const frozenHousehold=householdReview.letters[0]
  assert.ok(frozenHousehold.body.includes('Household: The Review Family / Review friends / The Review Household'))
  assert.equal(frozenHousehold.recipient_name,'The Review Family')
  if(process.env.COFFER_RCPT007_BROWSER){const {mergeReviewBrowser}=await import('./letter-templates-browser.mjs');await mergeReviewBrowser(h,{batchId:householdBatch.id,directory:process.env.COFFER_RCPT007_BROWSER,phase:'household'})}
  const householdState=await h.get('/api/coffer/households/'+householdId)
  await h.command('household.update',{householdId,version:householdState.household.version,addressee_override:'Later household name',informal_override:'Later friends',formal_override:'Later formal name'})
  assert.deepEqual((await h.get('/api/coffer/letters/'+householdBatch.id)).letters[0],frozenHousehold,'Prepared household merge fields stay frozen after name changes')
  assert.equal((await h.command('ack.approve',{batchId:householdBatch.id,version:1},{status:409})).error,'HOUSEHOLD_CHANGED')
  // Templates, their versions and the recorded versions on letters travel with the archive.
  const saved=await archive(h)
  await run(async fresh=>{
   await restore(fresh,saved)
   assert.deepEqual((await fresh.get('/api/coffer/letter-templates')).templates.map(t=>[t.id,t.version]),(await h.get('/api/coffer/letter-templates')).templates.map(t=>[t.id,t.version]))
   assert.deepEqual((await fresh.get('/api/coffer/letters/'+again.id)).letters.map(l=>[l.template_id,l.template_version]),[[major.id,1]])
   assert.deepEqual((await fresh.get('/api/coffer/letters/'+reviewBatch.id)).mergeReview,review.mergeReview)
   assert.deepEqual((await fresh.get('/api/coffer/letters/'+annualReviewBatch.id)).mergeReview,annualReview.mergeReview)
   assert.deepEqual((await fresh.get('/api/coffer/letters/'+householdBatch.id)).mergeReview,householdReview.mergeReview)
   assert.equal((await fresh.get('/api/coffer/letters/'+householdBatch.id)).letters[0].body,frozenHousehold.body)
   assert.deepEqual((await fresh.get('/api/coffer/letters/'+fixedBatch.id)).mergeReview,[])
  })
 })
}
