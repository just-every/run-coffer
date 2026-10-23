import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {paidPortalPlan,portalTestEdge,portalForm,signInPortal,portalCopyEvent} from './portal-journey.mjs'
const gift=(h,d,amount,extra={})=>h.command('gift.record',{donorId:d.id,amount,receivedOn:'2025-06-01',method:'check',goods:'none',...extra})
const detail=(h,id)=>h.get('/api/coffer/letters/'+id)
const file=(name,rows)=>({name,base64:Buffer.from(rows.join('\r\n')+'\r\n').toString('base64')})

export async function annualStatementsJourney(){
 const edge=portalTestEdge()
 await run(async h=>{
  await reviewed(h)
  // Exact MOVE-002 incumbent export: source benefit facts remain authoritative.
  const input={source:'bloomerang',files:[file('constituents.csv',[
   'Account Number,Name,Email Address',
   'synthetic-coffer-2301,Synthetic Gala Donor,synthetic-coffer-2301@example.test',
   'synthetic-coffer-2307,Synthetic Unknown Goods,synthetic-coffer-2307@example.test',
  ]),file('gifts.csv',[
   'Transaction Number,Account Number,Transaction Type,Date,Amount,Fund,Non-Deductible Amount,Goods Description',
   'synthetic-coffer-2302,synthetic-coffer-2301,Donation,2025-05-01,150.00,Gala,60.00,Gala dinner',
   'synthetic-coffer-2309,synthetic-coffer-2307,Donation,2025-05-01,10.00,Library,,',
  ])]}
  const preview=await h.api('/api/coffer/move-in/preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
  let move=await h.api('/api/coffer/move-in/apply',{id:preview.id,fingerprint:preview.fingerprint,acknowledged:'no',...(preview.needsAcceptance?{acceptedReason:'Synthetic fixture columns intentionally preserved'}:{})})
  while(move.state==='applying')move=await h.api('/api/coffer/move-in/continue',{id:move.id})
  assert.equal(move.state,'completed')
  const gala=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='synthetic-coffer-2301@example.test');assert.ok(gala)
  const native=await gift(h,gala,'50',{receivedOn:'2025-09-01',fund:'Library'})
  const monthly=await paidPortalPlan(h,edge),oneTime=await donor(h,'Synthetic Printed Statement',{email:null})
  await gift(h,oneTime,'75')
  await h.command('contribution.record',{donorId:oneTime.id,kind:'qcd',custodian:'Synthetic annual IRA custodian',amount:'25',receivedOn:'2025-08-01',method:'check',goods:'none'})
  const sponsor=await donor(h,'Synthetic Annual DAF Sponsor',{email:'synthetic-coffer-2308@example.test',constituentKind:'organization',organizationType:'donor-advised fund sponsor'})
  const sponsorCash=await gift(h,sponsor,'100')
  await h.command('contribution.record',{donorId:sponsor.id,kind:'daf',advisorDonorId:gala.id,amount:'700',receivedOn:'2025-08-01',method:'check',goods:'none'})
  await h.command('inKind.save',{donorId:gala.id,description:'Synthetic annual noncash laptop',quantity:'1',statedValue:'900',receivedOn:'2025-07-01',goods:'none'})
  const a=await donor(h,'Synthetic Statement Alex',{email:'synthetic-coffer-2303@example.test',household:'Synthetic statement household'}),b=await donor(h,'Synthetic Statement Blake',{email:'synthetic-coffer-2304@example.test',household:'Synthetic statement household'})
  const ga=await gift(h,a,'100'),gb=await gift(h,b,'200'),joint=await gift(h,a,'300')
  await h.command('softCredit.record',{giftId:joint.id,donorId:b.id,amount:'300'})
  const deceased=await donor(h,'Synthetic Held Deceased',{email:'synthetic-coffer-2305@example.test'});await gift(h,deceased,'40')
  await h.command('donor.profile',{donorId:deceased.id,version:(await h.get('/api/coffer/donors/'+deceased.id)).donor.version,constituentStatus:'deceased',deceasedOn:'2025-12-01'})
  await h.command('solicitation.set',{donorId:gala.id,version:0,type:'stop',startsOn:'2025-01-01'})
  const statements=async()=>(await h.get('/api/coffer/letters')).batches.filter(b=>b.kind==='statement')
  const tick=async at=>{const response=await h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+Date.parse(at)+'&format=json');assert.equal(response.status,200,await response.text())}
  const beforeDeceasedLink=edge.state.messages.length
  assert.equal((await h.request('/giving/portal/request',portalForm({email:'synthetic-coffer-2305@example.test'}))).status,200)
  assert.equal(edge.state.messages.length,beforeDeceasedLink,'A deceased standalone account receives no automatic sign-in mail; a person must review the survivor path')
  const messagesBefore=edge.state.messages.length
  await tick('2025-12-31T23:00:00Z')
  assert.equal((await statements()).length,0,'December does not prepare a future January run')
  const statementGrant=async()=>(await h.get('/api/coffer/agent/grants')).find(g=>g.id==='statements')
  const saveStatementGrant=async enabled=>{const grant=await statementGrant();return h.api('/api/coffer/agent/grants',{id:grant.id,version:grant.version,dailyLimit:grant.daily_limit,enabled,scope:'all'})}
  const completeGrant=await statementGrant()
  await h.api('/api/coffer/agent/grants',{id:completeGrant.id,version:completeGrant.version,dailyLimit:completeGrant.daily_limit,enabled:true,scope:'selected',donorIds:gala.id},{status:400})
  await saveStatementGrant(false);await tick('2026-01-02T13:00:00Z')
  assert.equal((await statements()).length,0,'Stopping the named statements grant stops January preparation')
  await saveStatementGrant(true)
  const control=(await h.get('/api/coffer/agent-grants')).control
  await h.command('agentGrant.kill',{version:control.version,enabled:false});await tick('2026-01-02T13:00:00Z')
  assert.equal((await statements()).length,0,'The global agent switch also stops annual preparation')
  await h.command('agentGrant.kill',{version:control.version+1,enabled:true})
  await Promise.all([tick('2026-01-02T13:00:00Z'),tick('2026-01-02T13:00:00Z')])
  const batches=await statements()
  assert.equal(batches.length,1,'Concurrent January ticks prepare the prior year once')
  const batch=batches[0],prepared=await detail(h,batch.id)
  assert.equal(batch.status,'prepared');assert.equal(batch.statement_year,2025)
  assert.equal(edge.state.messages.length,messagesBefore,'January preparation never approves or automatically sends')
  assert.equal(prepared.letters.length,5,'Constituents receive individual pieces and two spouses receive one household piece')
  const letter=prepared.letters.find(l=>l.donor_id===gala.id),lines=JSON.parse(letter.statement_gifts)
  assert.equal(lines.length,2);assert.equal(lines.find(g=>g.source==='bloomerang')?.goods_cents??lines.find(g=>g.id!==native.id).goods_cents,6000)
  assert.match(letter.body,/Gala.*\$150\.00.*\$60\.00.*deductible \$90\.00/)
  assert.match(letter.body,/Total gifts: \$200\.00/);assert.match(letter.body,/Total deductible portion: \$140\.00/)
  assert.ok(lines.some(g=>g.id===native.id),'A native gift appears beside the imported gala payment')
  const sponsorLetter=prepared.letters.find(l=>l.donor_id===sponsor.id);assert.equal(sponsorLetter.amount_cents,10000);assert.deepEqual(JSON.parse(sponsorLetter.statement_gifts).map(g=>g.id),[sponsorCash.id]);assert.doesNotMatch(sponsorLetter.body,/700\.00/,'DAF grants remain excluded even beside an ordinary gift to the same sponsor')
  const qcdLetter=prepared.letters.find(l=>l.donor_id===oneTime.id);assert.match(qcdLetter.body,/IRA distribution via Synthetic annual IRA custodian; excluded from deductible portion/);assert.match(qcdLetter.body,/Total gifts: \$100\.00/);assert.match(qcdLetter.body,/Total deductible portion: \$75\.00/)
  const household=prepared.letters.find(l=>l.household_id)
  assert.equal(household.amount_cents,60000);assert.deepEqual(JSON.parse(household.statement_gifts).map(g=>g.id).sort(),[ga.id,gb.id,joint.id].sort())
  assert.match(household.body,/hard-credit donor/);assert.doesNotMatch(household.body,/Soft credit/)
  assert.match(prepared.letters.find(l=>l.donor_id===monthly.id).body,/\$25\.00/)
  assert.ok(!prepared.letters.some(l=>l.donor_id===deceased.id),'A deceased standalone donor waits for a person and is never addressed directly')
  const preparationAudit=(await h.get('/api/coffer/audit?action=ack.prepareStatements')).rows.find(e=>e.subject_id===batch.id)
  assert.equal(preparationAudit.actor_role,'agent');assert.equal(preparationAudit.actor_id,'coffer-automation:statements')
  assert.equal(JSON.parse(preparationAudit.detail).grantId,'automation:statements')
  const claims=(await h.get('/api/coffer/audit?action=automation.claim')).rows.filter(e=>JSON.parse(e.detail).command==='statement.prepare')
  assert.equal(claims.length,1,'Concurrent ticks consume one daily preparation-run reservation')
  assert.equal(JSON.parse(preparationAudit.detail).excluded['goods review statements'],1,'Only the subject with an absent source goods answer waits for a person')
  assert.equal(JSON.parse(preparationAudit.detail).excluded.deceased,1,'The human hold remains counted in the preparation audit')
  await tick('2026-01-03T13:00:00Z');assert.equal((await statements()).length,1)
  const login=await signInPortal(h,'synthetic-coffer-2301@example.test',edge.state.messages)
  assert.equal((await h.request('/giving/portal/document?letter='+letter.id,{as:login.cookie})).status,404)
  const invite=await h.request('/app/people/invite',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({email:'synthetic-coffer-2306@example.test',role:'member',displayName:'Synthetic statement member'}).toString()});assert.equal(invite.status,303)
  const invitation=edge.state.messages.findLast(m=>m.personalizations[0].to[0].email==='synthetic-coffer-2306@example.test'),inviteText=invitation.content.find(c=>c.type==='text/plain').value,inviteLink=new URL(inviteText.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0])
  const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:inviteLink.searchParams.get('token')}});assert.equal(confirmed.status,303)
  const member={cookie:confirmed.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')}
  await h.command('ack.approve',{batchId:batch.id,version:1},{as:member.cookie,status:403})
  await h.command('ack.approve',{batchId:batch.id,version:1})
  const sent=await h.command('ack.send',{batchId:batch.id,version:2})
  assert.equal(sent.submitted,4);assert.equal(sent.print,1)
  const copy=await h.request('/giving/portal/document?letter='+letter.id,{as:login.cookie});assert.equal(copy.status,200)
  assert.match(await copy.text(),/Total deductible portion: \$140\.00/)
  const beforeCopies=edge.state.messages.length
  const requestedCopy={letter:letter.id,requestId:randomUUID()}
  assert.equal((await h.request('/giving/portal/copy',portalForm(requestedCopy,login.cookie))).status,303)
  assert.equal(edge.state.messages.length,beforeCopies+1)
  assert.equal((await portalCopyEvent(h,edge,letter.id,requestedCopy.requestId,'delivered','synthetic-coffer-2504')).status,200)
  assert.match(await (await h.request('/giving/portal/history',{as:login.cookie})).text(),/Requested copy delivered\./,'The requested annual statement reaches a provider-confirmed delivered result')
  const householdRecipient=household.donor_id===a.id?'synthetic-coffer-2303@example.test':'synthetic-coffer-2304@example.test',otherSpouse=household.donor_id===a.id?'synthetic-coffer-2304@example.test':'synthetic-coffer-2303@example.test'
  const recipientSession=await signInPortal(h,householdRecipient,edge.state.messages),spouseSession=await signInPortal(h,otherSpouse,edge.state.messages)
  assert.equal((await h.request('/giving/portal/document?letter='+household.id,{as:recipientSession.cookie})).status,200,'The explicitly frozen recipient can download the approved household statement')
  assert.equal((await h.request('/giving/portal/document?letter='+household.id,{as:spouseSession.cookie})).status,404,'Household membership never grants the other spouse financial-document access')
  const names=await h.get('/api/coffer/households/'+household.household_id)
  await h.command('household.update',{householdId:household.household_id,version:names.household.version,headDonorId:b.id,informal_override:'Synthetic changed mailing names'})
  const frozenHousehold=(await detail(h,batch.id)).letters.find(l=>l.id===household.id)
  assert.equal(frozenHousehold.body,household.body);assert.equal(frozenHousehold.recipient_name,household.recipient_name);assert.equal(frozenHousehold.receipt_sequence,household.receipt_sequence);assert.equal(frozenHousehold.void_reason,null)
  assert.equal((await h.request('/giving/portal/document?letter='+household.id,{as:recipientSession.cookie})).status,200,'Later head and mailing-name changes preserve frozen recipient authorization')
  const savedOriginal=(await detail(h,batch.id)).letters.find(l=>l.id===letter.id)
  await h.command('gift.reverse',{giftId:native.id,reason:'The native check was entered in error'})
  assert.equal((await h.request('/giving/portal/document?letter='+household.id,{as:recipientSession.cookie})).status,200,'A financial change to another recipient’s document cannot hide this valid frozen household statement')
  assert.equal((await h.request('/giving/portal/document?letter='+letter.id,{as:login.cookie})).status,409,'A changed financial document is never downloadable as a valid statement')
  const correction=await h.command('ack.correct',{letterId:letter.id})
  const corrected=(await detail(h,correction.id)).letters[0]
  assert.equal(corrected.replaces_id,letter.id);assert.ok(corrected.receipt_sequence>savedOriginal.receipt_sequence)
  assert.match(corrected.body,/Corrected statement replacing/);assert.match(corrected.body,/What changed: Gift reversed/)
  assert.match(corrected.body,/Total gifts: \$150\.00/);assert.match(corrected.body,/Total deductible portion: \$90\.00/)
  assert.equal((await h.request('/giving/portal/document?letter='+corrected.id,{as:login.cookie})).status,404)
  await h.command('ack.send',{batchId:correction.id,version:1},{status:409})
  await h.command('ack.approve',{batchId:correction.id,version:1});await h.command('ack.send',{batchId:correction.id,version:2})
  assert.ok(edge.state.messages.at(-1).content[0].value.includes('Use this corrected statement in place of the original'))
  const original=(await detail(h,batch.id)).letters.find(l=>l.id===letter.id)
  assert.equal(original.body,savedOriginal.body);assert.equal(original.receipt_sequence,savedOriginal.receipt_sequence)
  await h.command('ack.correct',{letterId:letter.id},{status:409})
  const approved=await h.request('/giving/portal/document?letter='+corrected.id,{as:login.cookie});assert.equal(approved.status,200);assert.match(await approved.text(),/Corrected statement replacing/)
  const unknown=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='synthetic-coffer-2307@example.test'),unknownGift=(await h.get('/api/coffer/donors/'+unknown.id)).gifts.find(g=>g.kind==='gift')
  assert.equal(unknownGift.goods,'unknown');await h.command('ack.prepareStatements',{year:2025,donorId:unknown.id},{status:409})
  await h.command('gift.classify',{giftId:unknownGift.id,version:unknownGift.version,goods:'none'})
  const reviewedHold=await h.command('ack.prepareStatements',{year:2025,donorId:unknown.id})
  assert.match((await detail(h,reviewedHold.id)).letters[0].body,/Total gifts: \$10\.00/)
  if(process.env.COFFER_ANNUAL_BROWSER){
   await mkdir(process.env.COFFER_ANNUAL_BROWSER,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/letters/'+correction.id)
     await page.getByText('Corrected statement replacing',{exact:false}).first().waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${process.env.COFFER_ANNUAL_BROWSER}/RCPT-004-corrected-${width}.png`,fullPage:true})
     await page.goto(origin+'/app/letters/'+batch.id);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${process.env.COFFER_ANNUAL_BROWSER}/RCPT-004-household-and-import-${width}.png`,fullPage:true})
     await page.goto(origin+'/app/agent/grants')
     const annualGrant=page.locator('details').filter({has:page.locator('summary').filter({hasText:'January annual statement preparation'})})
     await annualGrant.locator('summary').click()
     assert.deepEqual(await annualGrant.locator('select[name=scope] option').evaluateAll(options=>options.map(option=>option.value)),['all'],'Annual preparation cannot select partial household records')
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${process.env.COFFER_ANNUAL_BROWSER}/RCPT-004-annual-grant-${width}.png`,fullPage:true})
    }
    await page.close()
   })
  }
 },{...edge.options,triggerHandlers:true})
}
