import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,reviewed,archive,restore,donor} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {blackbaudFixture,key,email,sourceFile} from './blackbaud-fixture.mjs'
const post=(h,action,input,options)=>h.api('/api/coffer/move-in/'+action,input,options)
const apply=async(h,p)=>{let job=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'});while(job.state==='applying')job=await post(h,'continue',{id:p.id});assert.equal(job.state,'completed');return job}
const fundAmounts=async h=>Object.fromEntries((await h.get('/api/coffer/reports/funds')).funds.map(r=>[r.fund,r.amount_cents]))

/** One public-door migration sanity journey covers cash, promises and private
 * source facts together. Only the documented Blackbaud HTTP edge is faked. */
export async function blackbaudJourney(){
 const f=blackbaudFixture()
 await run(async h=>{
  await reviewed(h)
  const owner=(await h.get('/auth/session')).operator
  f.review.owners[key(9001)]={id:owner.id,version:owner.version}
  const empty=(await h.get('/api/coffer/donors')).total
  const before=f.calls.length,member=await h.person(email(9091)),admin=await h.person(email(9092),'admin')
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'preview',f.input(),{as:member.cookie,status:403});await post(h,'preview',f.input(),{as:admin.cookie,status:401});assert.equal(f.calls.length,before)
  for(const flag of ['denied','badPages','crossHost']){f.state[flag]=true;await post(h,'preview',f.input(),{status:502});f.state[flag]=false;assert.equal((await h.get('/api/coffer/donors')).total,empty)}
  f.gifts[0].gift_splits[1].amount.value=199.99;await post(h,'preview',f.input(),{status:400});f.gifts[0].gift_splits[1].amount.value=200
  f.gifts[0].type='RecurringGift';await post(h,'preview',f.input(),{status:400});f.gifts[0].type='Donation'
  f.opportunities[0].status='Unmapped stage';await post(h,'preview',f.input(),{status:400});f.opportunities[0].status='Proposal'
  const ownerMapping=f.review.owners[key(9001)];f.review.owners[key(9001)]={id:admin.id,version:1}
  const badOwner=await post(h,'preview',f.input());assert.equal(badOwner.canApply,false);assert.ok(badOwner.diagnostics.some(d=>d.code==='SKY_OPPORTUNITY'));await post(h,'apply',{id:badOwner.id,fingerprint:badOwner.fingerprint},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,empty);f.review.owners[key(9001)]=ownerMapping
  const badAck=structuredClone(f.review);badAck.softCredits[key(9031)].interactionId=key(9021)
  const refused=await post(h,'preview',{...f.input(),files:[sourceFile(badAck)]});assert.equal(refused.canApply,false);assert.ok(refused.diagnostics.some(d=>d.code==='ACKNOWLEDGMENT_LINK'))
  await post(h,'apply',{id:refused.id,fingerprint:refused.fingerprint},{status:409})
  const staged=await post(h,'preview',f.input()),policy=await h.get('/api/coffer/pipeline')
  const changed=await h.command('prospect.stages',{version:policy.version,stages:policy.stages.map(s=>({...s,label:s.id==='ask'?'Source review changed':s.label}))})
  await post(h,'apply',{id:staged.id,fingerprint:staged.fingerprint},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,empty,'A changed native stage policy refuses before any source part is applied')
  await h.command('prospect.stages',{version:changed.version,stages:policy.stages})
  let preview=await post(h,'preview',f.input())
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.equal(preview.needsAcceptance,false,JSON.stringify(preview.unmapped))
  assert.equal(preview.sourceTotals.giftCount,3);assert.equal(preview.sourceTotals.amountCents,125000)
  assert.deepEqual(preview.sourceTotals.byFund,{Reading:{giftCount:3,amountCents:105000},Library:{giftCount:1,amountCents:20000}})
  assert.equal(preview.counts.opportunities,1);assert.equal(preview.counts.designations,2);assert.equal(preview.counts.householdsWithHead,1);assert.equal(preview.counts.householdsWithoutHead,2)
  assert.equal((await h.get('/api/coffer/donors')).total,empty,'Preview has no native records')
  for(const secret of [key(9998),key(9999),key(9997)])assert.ok(!JSON.stringify(preview).includes(secret))
  await post(h,'apply',{id:preview.id,fingerprint:'stale'},{status:409});await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:member.cookie,status:403});await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:admin.cookie,status:401})
  const directory=process.env.COFFER_SKY_SHOTS;if(directory)await mkdir(directory,{recursive:true})
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage();await page.goto(origin+'/app/move-in/crm')
   const form=page.locator('form').filter({has:page.getByRole('button',{name:'Preview NXT history',exact:true})})
   await form.getByLabel('Blackbaud access token',{exact:true}).fill(key(9998));await form.getByLabel('Blackbaud subscription key',{exact:true}).fill(key(9999))
   await form.locator('input[type=file]').setInputFiles({name:'sky-review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.review))})
   await form.locator('details').first().locator('summary').click();await form.getByLabel('Code meanings',{exact:true}).fill('Do not solicit = stop\nDo not mail = no mail\nSolicit once annually = limit 1')
   await form.getByRole('button',{name:'Preview NXT history',exact:true}).click();await page.waitForURL('**/app/move-in/crm/review?*')
   assert.match(await page.locator('body').innerText(),/Nothing blocks this move-in/)
   await page.getByText('Gifts · 3',{exact:true}).click();await page.getByText('Opportunities · 1',{exact:true}).click()
   assert.match(await page.locator('body').innerText(),/Library renewal/);assert.match(await page.locator('body').innerText(),/Proposal → Ask/);assert.match(await page.locator('body').innerText(),/\$300\.00/);assert.match(await page.locator('body').innerText(),/\$200\.00/)
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/sky-review-'+width+'.png',fullPage:true})}
   await page.setViewportSize({width:1440,height:1000})
   await page.locator('input[name=acknowledged][value=no]').check();await page.locator('input[name=confirm]').check();await page.getByRole('button',{name:'Move these records in',exact:true}).click();await page.waitForURL('**/app/move-in/crm/journal?*')
   while(await page.getByRole('button',{name:'Continue',exact:true}).count()){await page.getByRole('button',{name:'Continue',exact:true}).click();await page.waitForLoadState('domcontentloaded')}
   assert.match(await page.locator('body').innerText(),/All totals match/)
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/sky-journal-'+width+'.png',fullPage:true})}
   await page.close()
  })
  const people=(await h.get('/api/coffer/donors?status=all')).donors,person=n=>people.find(p=>p.name===f.people.find(s=>s.id===key(n)).name)
  const ava=await h.get('/api/coffer/donors/'+person(9001).id),bee=await h.get('/api/coffer/donors/'+person(9002).id),cleo=await h.get('/api/coffer/donors/'+person(9003).id)
  const mailChoice=bee.consents.find(c=>c.channel==='mail');assert.equal(mailChoice.status,'withdrawn');assert.equal(mailChoice.captured_on,'2026-09-01');assert.match(mailChoice.evidence,/Do not mail/);assert.ok(!mailChoice.evidence.includes('source date unknown'))
  const noAddress=await h.get('/api/coffer/donors/'+person(9004).id);assert.equal(noAddress.donor.email,null);assert.equal(noAddress.consents.find(c=>c.channel==='email').status,'withdrawn');assert.match(noAddress.consents.find(c=>c.channel==='email').evidence,/SKY constituent requests no email/)
  assert.equal(ava.donor.name,'Dr. Ava Reed');assert.equal(ava.donor.informal_salutation,'  Dearest Ava  ');assert.equal(ava.donor.envelope_name,'  The original Ava addressee  ')
  assert.deepEqual(ava.contactPoints.filter(p=>p.kind==='email').map(p=>p.type).sort(),['personal','work']);assert.equal(ava.contactPoints.filter(p=>p.kind==='email'&&p.is_primary).length,1)
  assert.equal(ava.customValues.find(v=>v.field_key==='sky_membership').value,'"Board"');assert.equal(ava.customValues.find(v=>v.field_key==='sky_detail').value,'"Books <and> music"')
  assert.equal(ava.gifts.length,1);const gift=ava.gifts[0]
  assert.equal(gift.amount_cents,50000);assert.equal(gift.goods,'provided');assert.equal(gift.goods_cents,5000);assert.equal(ava.totals.lifetimeCents,50000)
  assert.equal(gift.acknowledgment.status,'acknowledged');assert.equal(gift.acknowledgment.acknowledged_on,'2026-09-04');assert.equal(gift.acknowledgment.link.id,ava.depth.interactions[0].id);assert.match(gift.acknowledgment.source_reference,/Source letter 14/)
  assert.equal(bee.gifts[0].acknowledgment.status,'do not acknowledge');assert.equal(cleo.gifts[0].acknowledgment.status,'not acknowledged');assert.equal(bee.gifts[0].goods,'none')
  const credit=bee.giftDepth.creditedGifts[0];assert.equal(credit.amount_cents,10000);assert.equal(credit.acknowledgment.status,'acknowledged');assert.equal(credit.acknowledgment.link.id,bee.depth.interactions[0].id)
  assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.id),[cleo.gifts[0].id])
  assert.deepEqual(await fundAmounts(h),{Reading:105000,Library:20000})
  assert.equal(cleo.pledges[0].amount_cents,100000)
  const pipeline=await h.get('/api/coffer/pipeline'),opportunity=pipeline.opportunities[0]
  assert.equal(opportunity.stage,'ask');assert.equal(opportunity.donor_id,person(9003).id);assert.equal(opportunity.owner_id,owner.id);assert.equal(opportunity.ask_amount_cents,300000);assert.equal(opportunity.expected_amount_cents,240000);assert.equal(pipeline.totals.forecastCents,192000)
  assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed').totalCents,75000);assert.equal(ava.giftDepth.tributes[0].amount_permission,0)
  const hh=await h.get('/api/coffer/households/'+ava.donor.household_id)
  assert.equal(hh.household.head_donor_id,ava.donor.id);assert.equal(hh.household.head_source,'re-nxt');assert.ok(hh.household.head_imported_at);assert.equal(hh.household.addressee_override,'  The Reading Family  ');assert.equal(hh.household.formal_override,'Dear Reed Readers')
  assert.equal((await h.get('/api/coffer/households/'+cleo.donor.household_id)).household.head_donor_id,null);assert.equal((await h.get('/api/coffer/households/'+(await h.get('/api/coffer/donors/'+person(9005).id)).donor.household_id)).household.head_donor_id,null)
  await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const [name,path] of [['donor','/app/donors/'+ava.donor.id],['opportunity','/app/pipeline']]){await page.goto(origin+path);assert.ok((await page.locator('body').innerText()).includes(name==='donor'?'Ava':'Library renewal'));for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/sky-'+name+'-'+width+'.png',fullPage:true})}}await page.close()})
  const saved=await archive(h);for(const secret of [key(9998),key(9999),key(9997)])assert.ok(!JSON.stringify(saved).includes(secret))
  await run(async fresh=>{await restore(fresh,saved);assert.deepEqual(await fundAmounts(fresh),{Reading:105000,Library:20000});assert.equal((await fresh.get('/api/coffer/pipeline')).opportunities[0].expected_amount_cents,240000);await post(fresh,'undo',{id:preview.id});assert.equal((await fresh.get('/api/coffer/donors?status=all')).total,0);assert.equal((await fresh.get('/api/coffer/pipeline')).opportunities.length,0);assert.deepEqual(await fundAmounts(fresh),{});assert.ok(!(await fresh.get('/api/coffer/custom-fields')).fields.some(f=>f.key.startsWith('sky_')))})
  const repeat=await post(h,'preview',{...f.input(),solicitCodes:undefined});assert.equal(repeat.prior.state,'completed');assert.equal((await apply(h,repeat)).unchanged,true);assert.deepEqual(await fundAmounts(h),{Reading:105000,Library:20000})
  // A fresh read must compare changed source facts, even with the same review file.
  f.gifts[1].amount.value=251;f.gifts[1].gift_splits[0].amount.value=251;f.gifts[1].receipts[0].amount.value=251
  const changedSource=await post(h,'preview',f.input());assert.notEqual(changedSource.id,repeat.id);assert.equal(changedSource.canApply,false);assert.ok(changedSource.diagnostics.some(d=>d.code==='MOVE_IN_MAPPING'))
  await post(h,'apply',{id:changedSource.id,fingerprint:changedSource.fingerprint},{status:409});assert.deepEqual(await fundAmounts(h),{Reading:105000,Library:20000})
  f.gifts[1].amount.value=250;f.gifts[1].gift_splits[0].amount.value=250;f.gifts[1].receipts[0].amount.value=250
  await post(h,'undo',{id:preview.id});assert.equal((await h.get('/api/coffer/donors?status=all')).total,0)
  preview=await post(h,'preview',f.input());await apply(h,preview)
  const current=await h.get('/api/coffer/households/'+hh.household.id);await h.command('household.update',{householdId:hh.household.id,version:current.household.version,informal_override:'A later reviewed greeting'})
  await post(h,'undo',{id:preview.id},{status:409});assert.equal((await h.get('/api/coffer/households/'+hh.household.id)).household.informal_override,'A later reviewed greeting');assert.deepEqual(await fundAmounts(h),{Reading:105000,Library:20000})
  const notice=await h.command('tributeNotification.prepare',{giftId:gift.id}),prepared=(await h.get('/api/coffer/donors/'+ava.donor.id)).tributeNotifications.find(n=>n.id===notice.id);assert.equal(prepared.recipient_name,'River Reed');assert.ok(!prepared.body.includes('$500'))
  await h.command('gift.reverse',{giftId:bee.gifts[0].id,reason:'Source check returned',reversedOn:'2026-09-06'});assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed').totalCents,50000);assert.deepEqual(await fundAmounts(h),{Reading:80000,Library:20000})
  const first=await h.command('appeal.prepare',{name:'First NXT appeal',channel:'email'},{status:409});assert.equal(first.details['do not solicit'],1)
  const postal=(await h.get('/api/coffer/move-in/source-history?donorId='+bee.donor.id)).outreach.mail;assert.equal(postal.recipients.length,0);assert.equal(postal.excluded['consent withdrawn'],1)
  await h.command('consent.record',{donorIds:[cleo.donor.id],channel:'email',status:'granted',method:'paper form',evidence:key(9095),capturedOn:'2026-09-07'})
  const initial=await h.command('appeal.prepare',{name:'First annual ask',channel:'email',donorIds:[cleo.donor.id]});assert.equal(initial.recipients,1);const approved=await h.command('appeal.approve',{appealId:initial.id,version:initial.version});const exported=await h.command('appeal.export',{appealId:initial.id,version:approved.version});assert.equal(exported.status,'exported');await h.command('appeal.markSent',{appealId:initial.id,version:exported.version,sentOn:(await h.get('/api/coffer/letters')).today})
  const second=await h.command('appeal.prepare',{name:'Second annual ask',channel:'email',donorIds:[cleo.donor.id]},{status:409});assert.equal(second.details['solicitation limit'],1)
  const target=await donor(h,'Native merged identity'),source=(await h.get('/api/coffer/donors/'+cleo.donor.id)).donor
  await h.command('donor.merge',{sourceDonorId:source.id,donorId:target.id,sourceVersion:source.version,version:target.version,reason:'duplicate_record'})
  assert.equal((await h.get('/api/coffer/pipeline')).opportunities[0].donor_id,target.id);assert.equal((await h.get('/api/coffer/donors/'+target.id)).gifts[0].amount_cents,50000)
  await h.command('donor.erase',{donorId:target.id,confirm:'ERASE'});assert.equal((await h.get('/api/coffer/pipeline')).opportunities.length,0)
  assert.equal((await post(h,'preview',f.input())).canApply,false,'An erased merged identity cannot return through replay')
  const erased=await h.get('/api/coffer/move-in/journal?id='+preview.id);assert.equal(erased.job.redacted,1);assert.deepEqual(erased.job.report,{})
  await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{status:409});assert.ok(!JSON.stringify(await archive(h)).includes(email(9003)))
 },{outbound:f.outbound})
}
