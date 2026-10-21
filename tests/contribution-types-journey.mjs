import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

/** GIFT-010 inherits receipt custody and REPORT-007 through their public doors.
 * No app internals, database fixtures or provider substitutes are used. */
export async function contributionTypesJourney(){
 await run(async h=>{
  const headers={'x-test-now':'2026-10-15T16:00:00Z'}
  const command=(name,input,options={})=>h.command(name,input,{...options,headers})
  const get=(path,options={})=>h.get(path,{...options,headers})
  await reviewed(h)
  const owner=await donor(h,'Synthetic Stock Donor'),sponsor=await donor(h,'Synthetic DAF Sponsor',{constituentKind:'organization',organizationType:'donor-advised fund sponsor'}),advisor=await donor(h,'Synthetic DAF Advisor'),retiree=await donor(h,'Synthetic QCD Donor')
  const typeState=d=>get(`/api/coffer/donors/${d.id}/contribution-types`)
  const donorState=d=>get('/api/coffer/donors/'+d.id)
  const propertyState=async()=>((await get('/api/coffer/in-kind?donorId='+owner.id)).gifts.find(g=>g.id===stock.id))
  const letters=id=>get('/api/coffer/letters/'+id)
  const report=()=>get('/api/coffer/reports/tax?year=2025')
  for(const [i,year] of [2021,2022,2023,2024].entries())await command('gift.record',{donorId:owner.id,amount:String((i+1)*100),receivedOn:`${year}-06-01`,method:'check',goods:'none'})
  const stock=await command('contribution.record',{donorId:owner.id,kind:'stock',symbol:'SYN',shares:'100',highPrice:'60',lowPrice:'40',receivedOn:'2025-06-01',goods:'none',fund:'Library'})
  const daf=await command('contribution.record',{donorId:sponsor.id,kind:'daf',advisorDonorId:advisor.id,amount:'6000',receivedOn:'2025-06-02',method:'check',goods:'none',fund:'Library'})
  const qcd=await command('contribution.record',{donorId:retiree.id,kind:'qcd',custodian:'Synthetic IRA Custodian',amount:'7000',receivedOn:'2025-06-03',method:'check',goods:'none',fund:'Library'})
  await command('contribution.record',{donorId:retiree.id,kind:'qcd',custodian:'Synthetic IRA Custodian',amount:'1',receivedOn:'2025-06-03',method:'check',goods:'provided',goodsValue:'1'},{status:400})
  const stockFacts=(await typeState(owner)).stocks[0],dafFacts=(await typeState(sponsor)).monetary[0],qcdFacts=(await typeState(retiree)).monetary[0]
  assert.equal(stockFacts.recorded_value_cents,500000);assert.equal(stockFacts.valuationBasis,'market_high_low_mean');assert.equal(stockFacts.monetaryCents,0)
  assert.equal(dafFacts.gift_id,daf.id);assert.equal(dafFacts.donor_id,sponsor.id);assert.equal(dafFacts.advisor_donor_id,advisor.id);assert.equal(dafFacts.net_cents,600000)
  assert.equal(qcdFacts.gift_id,qcd.id);assert.equal(qcdFacts.custodian,'Synthetic IRA Custodian');assert.equal(qcdFacts.net_cents,700000)
  const advisorFile=await donorState(advisor)
  assert.equal(advisorFile.gifts.filter(g=>g.kind==='gift').length,0,'The advisor receives no duplicate monetary gift')
  const advisorCredit=advisorFile.giftDepth.creditedGifts.find(c=>c.id===daf.softCreditId)
  assert.equal(advisorCredit.gift_id,daf.id);assert.equal(advisorCredit.gift_donor_id,sponsor.id)
  assert.equal(advisorCredit.amount_cents,600000);assert.equal(advisorCredit.recognized_cents,600000)
  assert.equal((await donorState(sponsor)).gifts.find(g=>g.id===daf.id).donor_id,sponsor.id)
  assert.equal((await donorState(retiree)).gifts.find(g=>g.id===qcd.id).goods,'none')
  const stockLedger=(await donorState(owner)).gifts.filter(g=>g.property_id===stock.id)
  assert.equal(stockLedger.length,1);assert.equal(stockLedger[0].amount_cents,0);assert.equal(stockLedger[0].stated_value_cents,500000)

  // First read real built-in documents, then test custom selection separately.
  await command('inKind.acknowledge',{donorId:owner.id,inKindId:stock.id,version:(await propertyState()).version,acknowledgedOn:'2025-06-04'})
  const originalStock=(await propertyState()).acknowledgments[0]
  assert.match(originalStock.body,/100[\s\S]*SYN/);assert.match(originalStock.body,/No goods or services/i)
  assert.doesNotMatch(originalStock.body,/\$|5,?000|4,?800|deductib/i,'Stock acknowledgment does not assign the property a dollar value')
  const builtin=await command('ack.prepare',{giftIds:[daf.id,qcd.id]}),builtinLetters=(await letters(builtin.id)).letters
  const builtinDaf=builtinLetters.find(l=>l.gift_id===daf.id),builtinQcd=builtinLetters.find(l=>l.gift_id===qcd.id)
  assert.match(builtinDaf.body,/6,?000\.00/);assert.doesNotMatch(builtinDaf.body,/deductib/i)
  assert.ok(builtinDaf.body.includes('Synthetic DAF Sponsor'));assert.ok(!builtinDaf.body.includes('Synthetic DAF Advisor'))
  assert.match(builtinQcd.body,/No goods or services/i);assert.ok(builtinQcd.body.includes('Synthetic IRA Custodian'))
  await command('ack.discard',{batchId:builtin.id,version:builtin.version})

  const catalog=await get('/api/coffer/template-fields'),templates={}
  for(const kind of ['stock','daf','qcd']){
   const definition=catalog.templates.find(t=>t.kind===kind)
   assert.ok(definition?.required.length,kind+' exposes its required receipt facts')
   const body='Synthetic '+kind+' receipt\n'+definition.required.map(f=>'{{'+f+'}}').join('\n')
   await command('letterTemplate.save',{kind,name:'Incomplete '+kind,subject:'Contribution acknowledgment',body:body.replace('{{'+definition.required[0]+'}}','')},{status:400})
   if(kind==='stock')await command('letterTemplate.save',{kind,name:'Stock with money',subject:'Stock',body:body+'\n{{amount}}'},{status:400})
   const saved=await command('letterTemplate.save',{kind,name:'Reviewed '+kind,subject:'Contribution acknowledgment',body})
   templates[kind]=await command('letterTemplate.save',{templateId:saved.id,version:saved.version,name:'Reviewed '+kind,subject:'Contribution acknowledgment',body:body+'\nReviewed facts.'})
  }
  // Competing general templates cannot override the contribution-specific kind.
  const majorDef=catalog.templates.find(t=>t.kind==='major_gift')
  await command('letterTemplate.save',{kind:'major_gift',name:'General major gift',minAmount:'1000',subject:'General thank-you',body:'GENERAL MAJOR\n'+majorDef.required.map(f=>'{{'+f+'}}').join('\n')})
  const correctedProperty=await command('inKind.save',{donorId:owner.id,inKindId:stock.id,version:(await propertyState()).version,description:'Publicly traded securities: 100 shares of SYN, transfer description corrected.',quantity:'100',statedValue:'5000',receivedOn:'2025-06-01',goods:'none',fund:'Library',form8283:'not_section_b',correctionReason:'Corrected transfer description; shares and market value unchanged.'})
  const voidStock=(await propertyState()).acknowledgments.find(a=>a.id===originalStock.id)
  assert.ok(voidStock.void_reason);assert.equal(voidStock.body,originalStock.body);assert.equal(voidStock.receipt_sequence,originalStock.receipt_sequence)
  await command('inKind.acknowledge',{donorId:owner.id,inKindId:stock.id,version:correctedProperty.version,acknowledgedOn:'2025-06-05'})
  const correctedStock=(await propertyState()).acknowledgments.find(a=>a.replaces_id===originalStock.id)
  assert.ok(correctedStock);assert.equal(correctedStock.template_id,templates.stock.id);assert.equal(correctedStock.template_version,templates.stock.version)
  assert.match(correctedStock.body,/Synthetic stock receipt/);assert.match(correctedStock.body,/transfer description corrected/)
  assert.doesNotMatch(correctedStock.body,/\$|5,?000|4,?800|deductib/i)
  assert.ok(correctedStock.body.includes(`${originalStock.receipt_year}-${originalStock.receipt_sequence}`))
  assert.ok(correctedStock.receipt_sequence>originalStock.receipt_sequence)
  const stockDownload=await h.request(`/api/coffer/in-kind-acknowledgments/${correctedStock.id}/download`,{headers})
  assert.equal(stockDownload.status,200);const stockDocument=await stockDownload.text()
  assert.ok(stockDocument.includes(`${correctedStock.receipt_year}-${correctedStock.receipt_sequence}`));assert.match(stockDocument,/transfer description corrected/);assert.doesNotMatch(stockDocument,/\$|5,?000|4,?800/)
  const batch=await command('ack.prepare',{giftIds:[daf.id,qcd.id]}),custom=(await letters(batch.id)).letters
  const customDaf=custom.find(l=>l.gift_id===daf.id),customQcd=custom.find(l=>l.gift_id===qcd.id)
  for(const [kind,letter] of [['daf',customDaf],['qcd',customQcd]]){
   assert.equal(letter.template_kind,kind);assert.equal(letter.template_id,templates[kind].id);assert.equal(letter.template_version,templates[kind].version)
   assert.match(letter.body,new RegExp('Synthetic '+kind+' receipt'));assert.doesNotMatch(letter.body,/GENERAL MAJOR/)
   assert.equal(letter.receipt_year,correctedStock.receipt_year);assert.ok(letter.receipt_sequence>correctedStock.receipt_sequence)
  }
  const documents=[originalStock,...builtinLetters,correctedStock,...custom]
  assert.equal(new Set(documents.map(l=>`${l.receipt_year}-${l.receipt_sequence}`)).size,documents.length,'All property and monetary documents share annual numbering without reuse')
  assert.doesNotMatch(customDaf.body,/deductib/i);assert.ok(customQcd.body.includes('Synthetic IRA Custodian'));assert.match(customQcd.body,/No goods or services/i)
  const frozen=custom.map(l=>({id:l.id,body:l.body,template_id:l.template_id,template_version:l.template_version}))
  const qcdDef=catalog.templates.find(t=>t.kind==='qcd')
  await command('letterTemplate.save',{templateId:templates.qcd.id,version:templates.qcd.version,name:'Future QCD receipt',subject:'Future contribution acknowledgment',body:'FUTURE COPY\n'+qcdDef.required.map(f=>'{{'+f+'}}').join('\n')})
  assert.deepEqual((await letters(batch.id)).letters.map(l=>({id:l.id,body:l.body,template_id:l.template_id,template_version:l.template_version})),frozen,'Template edits preserve the already prepared document')
  const approved=await command('ack.approve',{batchId:batch.id,version:batch.version})
  const exported=await command('ack.export',{batchId:batch.id,version:approved.version})
  await command('ack.markSent',{batchId:batch.id,version:exported.version,sentOn:'2026-10-15',method:'mail'})

  let working=await report()
  assert.deepEqual(working.scheduleA.totals.map(y=>y.monetaryCents),[10000,20000,30000,40000,1300000])
  assert.equal(working.scheduleA.monetaryCents,1400000);assert.equal(working.scheduleA.noncashStatedCents,500000)
  assert.equal(working.scheduleB.contributionTotalCents,1300000);assert.equal(working.scheduleB.noncashStatedCents,500000);assert.equal(working.scheduleB.workingContributionCents,1800000)
  assert.deepEqual(working.scheduleB.rows.map(r=>r.donorId).sort(),[owner.id,sponsor.id,retiree.id].sort())
  assert.ok(!working.scheduleA.donors.some(r=>r.donorId===advisor.id));assert.ok(!working.scheduleB.rows.some(r=>r.donorId===advisor.id))
  const stockPaper=working.scheduleM.rows.find(r=>r.id===stock.id)
  assert.equal(working.scheduleM.giftCount,1);assert.equal(working.scheduleM.statedValueCents,500000)
  assert.equal(stockPaper.contributionType,'stock');assert.equal(stockPaper.valuationBasis,'market_high_low_mean')
  assert.equal(working.scheduleA.donors.find(r=>r.donorId===owner.id).monetaryCents,100000)
  assert.equal(working.scheduleA.donors.find(r=>r.donorId===sponsor.id).monetaryCents,600000)
  assert.equal(working.scheduleA.donors.find(r=>r.donorId===retiree.id).monetaryCents,700000)
  await command('taxReports.settings',{version:working.configuration.version,rule:'public_support',eligibilityConfirmed:true,periodStart:working.start,periodThrough:working.through,totalContributions:'250000'})
  assert.deepEqual((await report()).scheduleB.rows.map(r=>r.donorId).sort(),[sponsor.id,retiree.id].sort(),'The exact 2% stock contributor is excluded without dropping it from totals')

  const sale=await command('contribution.stockSale',{donorId:owner.id,inKindId:stock.id,version:(await typeState(owner)).stocks[0].version,soldOn:'2025-07-01',saleProceeds:'4800'})
  assert.equal(sale.saleProceedsCents,480000)
  const sold=(await typeState(owner)).stocks[0]
  assert.equal(sold.recorded_value_cents,500000);assert.equal(sold.sale_proceeds_cents,480000)
  assert.equal((await propertyState()).acknowledgments.find(a=>a.id===correctedStock.id).body,correctedStock.body)
  working=await report();assert.equal(working.scheduleM.statedValueCents,500000);assert.equal(working.scheduleB.contributionTotalCents,1300000)
  assert.equal(working.scheduleM.rows.find(r=>r.id===stock.id).disposedOn,'2025-07-01')
  await command('gift.reverse',{giftId:qcd.id,reversedOn:'2025-06-04',reason:'IRA distribution returned to its custodian.'})
  const voidQcd=(await letters(batch.id)).letters.find(l=>l.id===customQcd.id)
  assert.ok(voidQcd.void_reason);assert.equal(voidQcd.body,customQcd.body);assert.equal(voidQcd.receipt_sequence,customQcd.receipt_sequence)
  assert.equal((await typeState(retiree)).monetary.find(g=>g.gift_id===qcd.id).net_cents,0)
  await command('ack.correct',{letterId:customQcd.id},{status:409})
  working=await report();assert.equal(working.scheduleB.contributionTotalCents,600000);assert.equal(working.scheduleA.monetaryCents,700000);assert.equal(working.scheduleM.statedValueCents,500000)
  assert.deepEqual(working.scheduleB.rows.map(r=>r.donorId),[sponsor.id])
  const print=await h.request('/app/letters/'+batch.id+'/print',{headers});assert.equal(print.status,200);assert.match(await print.text(),/VOID/)
  if(process.env.COFFER_GIFT010_BROWSER){
   const directory=process.env.COFFER_GIFT010_BROWSER;await mkdir(directory,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000})
     for(const [label,person] of [['stock',owner],['daf',sponsor],['qcd',retiree]]){
      await page.goto(origin+'/app/donors/'+person.id);const panel=page.locator('#contribution-types');await panel.scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      await panel.screenshot({path:`${directory}/GIFT-010-${label}-${width}.png`})
      if(label==='stock'){
       const property=page.locator('#in-kind-'+stock.id)
       for(const summary of await property.locator('summary').filter({hasText:'Read property acknowledgment'}).all())await summary.click()
       await property.scrollIntoViewIfNeeded();await property.screenshot({path:`${directory}/GIFT-010-property-corrections-${width}.png`})
      }
     }
     await page.goto(origin+'/app/letters/'+batch.id+'/print');await page.getByText(/VOID/).first().waitFor()
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/GIFT-010-void-receipt-${width}.png`,fullPage:true})
     await page.goto(origin+'/app/reports/tax?year=2025');await page.getByRole('heading',{name:'Schedule B · contributors',exact:true}).waitFor()
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/GIFT-010-working-papers-${width}.png`,fullPage:true})
    }
    await page.close()
   })
  }
 })
}
