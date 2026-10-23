import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import {householdsJourney} from './households-journey.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

// Called by the parent test registration. The shared household journey proves
// COMM-007's inherited roles, head eligibility, money and statement custody.
export async function mailAppealsJourney() {
 await run(mailReplies,{verifiedMail:true})
 await run(householdsJourney)
}

async function mailReplies(h) {
 await reviewed(h)
 const alex=await donor(h,'Alex Mail',{household:'Mail household',email:'synthetic-coffer-2101@example.test'})
 const blair=await donor(h,'Blair Mail',{household:'Mail household',email:'synthetic-coffer-2102@example.test'})
 const casey=await donor(h,'Casey Mail',{email:'synthetic-coffer-2103@example.test'})
 const noGift=await donor(h,'New Mail',{email:'synthetic-coffer-2104@example.test'})
 const restricted=await donor(h,'Restricted Mail',{household:'Mail household',email:'synthetic-coffer-2105@example.test'})
 const inactive=await donor(h,'Inactive Mail',{email:'synthetic-coffer-2106@example.test'})
 const deceased=await donor(h,'Deceased Mail',{email:'synthetic-coffer-2107@example.test'})
 const sponsor=await donor(h,'Outside Sponsor',{email:'synthetic-coffer-2108@example.test'})
 for(const d of [alex,blair,casey,noGift,restricted,inactive,deceased])await h.command('consent.record',{donorId:d.id,channel:'mail',status:'granted',method:'paper form',evidence:'synthetic-coffer-2109',capturedOn:'2025-01-01'})
 const profile=async(d,input)=>h.command('donor.profile',{donorId:d.id,version:(await h.get('/api/coffer/donors/'+d.id)).donor.version,...input})
 await profile(alex,{firstName:'Alex',lastName:'Mail',nickname:'Al'})
 await profile(casey,{firstName:'Casey',lastName:'Mail',informalSalutation:'Casey friend',envelopeName:'Casey Mail household'})
 await profile(inactive,{constituentStatus:'inactive',statusReason:'No current contact'})
 await profile(deceased,{constituentStatus:'deceased',deceasedOn:'2025-01-01'})
 await h.command('solicitation.set',{donorId:restricted.id,version:0,type:'stop',startsOn:'2025-01-01'})
 const give=(d,amount,receivedOn,extra={})=>h.command('gift.record',{donorId:d.id,amount,receivedOn,method:'check',goods:'none',...extra})
 const older=await give(alex,'100','2025-01-01')
 const other=await give(blair,'200','2025-02-01')
 const last=await give(alex,'150','2025-03-01',{allocations:[{fund:'Books',amount:'90'},{fund:'Meals',amount:'60'}]})
 const returned=await give(blair,'450','2025-04-01')
 await h.command('gift.reverse',{giftId:returned.id,reason:'Returned check'})
 const outside=await give(sponsor,'999','2025-05-01')
 await h.command('softCredit.record',{giftId:outside.id,donorId:alex.id,amount:'999'})
 await h.command('inKind.save',{donorId:blair.id,description:'synthetic-coffer-2110',quantity:'1',statedValue:'800',receivedOn:'2025-06-01',goods:'none'})
 await give(casey,'50','2025-01-01')
 const hid=(await h.get('/api/coffer/donors/'+alex.id)).donor.household_id
 const household=()=>h.get('/api/coffer/households/'+hid)
 assert.equal((await household()).headStatus,'none','Headless households remain valid')
 await h.command('household.update',{householdId:hid,version:(await household()).household.version,headDonorId:restricted.id,addressee_override:'Alex, Blair and Restricted',informal_override:'All three'})
 await prepareVerifiedMail(h)
 const appeal=await h.command('appeal.prepare',{name:'Spring mail replies',channel:'mail',cost:'10'})
 const detail=await h.get('/api/coffer/appeals/'+appeal.id)
 assert.deepEqual([appeal.recipients,appeal.pieceCount],[4,3])
 assert.equal(appeal.excluded['do not solicit'],1);assert.equal(appeal.excluded.inactive,1);assert.equal(appeal.excluded.deceased,1)
 const pieceFor=d=>detail.mailPieces.find(p=>JSON.parse(p.members).includes(d.id))
 const joint=pieceFor(alex),single=pieceFor(casey),blank=pieceFor(noGift)
 assert.equal(joint.id,pieceFor(blair).id)
 assert.doesNotMatch(joint.name,/Restricted/,'The restricted head never enters the consenting addressee')
 assert.match(joint.name,/Alex/);assert.match(joint.name,/Blair/)
 assert.equal(JSON.parse(joint.names).informal_salutation,'Al and Blair Mail')
 assert.deepEqual(JSON.parse(joint.snapshot).gifts.map(g=>g.id).sort(),[older.id,other.id,last.id].sort())
 assert.equal(joint.ask_cents,15000,'The actual last remaining hard gift supplies the ask, without an upgrade or soft credit')
 assert.deepEqual(JSON.parse(joint.snapshot).askBasis,{giftId:last.id,receivedOn:'2025-03-01',remainingCents:15000})
 assert.equal(single.name,'Casey Mail household');assert.equal(JSON.parse(single.names).informal_salutation,'Casey friend');assert.equal(single.ask_cents,5000)
 assert.equal(blank.ask_cents,null,'No history produces a blank ask, never an invented amount')
 assert.equal(new Set(detail.mailPieces.map(p=>p.response_code)).size,3)
 assert.ok(detail.mailPieces.every(p=>p.response_code&&p.response_code!==appeal.code))
 await h.command('appealCode.define',{code:joint.response_code,name:'Duplicate'},{status:409})
 const member=await h.person('synthetic-coffer-2113@example.test'),admin=await h.person('synthetic-coffer-2114@example.test','admin')
 const agent=await h.command('agent.create',{label:'synthetic-coffer-2115'})
 await h.command('appeal.approve',{appealId:appeal.id,version:1},{as:member.cookie,status:403})
 await h.command('appeal.approve',{appealId:appeal.id,version:1},{as:'',headers:{authorization:'Bearer '+agent.token},status:403})
 await h.command('appeal.approve',{appealId:appeal.id,version:1},{as:admin.cookie})
 await h.command('appeal.export',{appealId:appeal.id,version:2})
 const csv=await (await h.request('/api/coffer/appeals/'+appeal.id+'/recipients.csv')).text()
 const lines=csv.trim().split('\r\n')
 assert.equal(lines.length,4);assert.match(lines[0],/ask_amount,response_code$/)
 assert.ok(lines.find(l=>l.includes(joint.response_code)).includes('150.00,'+joint.response_code))
 assert.ok(lines.find(l=>l.includes(single.response_code)).startsWith('Casey Mail household,Casey friend,'))
 assert.match(csv,/1 Main Street/);assert.match(csv,/62701/)
 assert.ok(!csv.includes('synthetic-coffer-2101@example.test'),'Mail-house CSV never exposes email or extra donor fields')
 const sentOn=new Intl.DateTimeFormat('en-CA',{timeZone:(await h.get('/api/coffer/settings')).timezone}).format(new Date((await h.get('/api/coffer/appeals/'+appeal.id)).appeal.exported_at))
 await h.command('appeal.markSent',{appealId:appeal.id,version:3,sentOn})
 for(const d of [alex,blair,casey,noGift]){
  const history=await h.get('/api/coffer/donors/'+d.id)
  assert.ok(history.appeals.some(a=>a.id===appeal.id&&a.status==='sent'&&a.sent_on===sentOn))
  assert.match(await (await h.request('/app/donors/'+d.id)).text(),/Spring mail replies/)
 }
 assert.ok(!(await h.get('/api/coffer/donors/'+restricted.id)).appeals.some(a=>a.id===appeal.id))
 let batch=await h.command('giftBatch.create',{name:'Reply card checks',receivedOn:sentOn,method:'check',expected:'125',fund:'Books'})
 const row=(d,code,reference,amount='75')=>({batchId:batch.id,version:batch.version,donorId:d.id,amount,reference,goods:'none',responseCode:code})
 await h.command('giftBatch.add',row(alex,'synthetic-coffer-undefined','synthetic-coffer-2111'),{status:400})
 await h.command('giftBatch.add',{...row(alex,joint.response_code,'synthetic-coffer-2111'),channel:'email'},{status:400})
 batch={...batch,...await h.command('giftBatch.add',row(alex,joint.response_code.toLowerCase(),'synthetic-coffer-2111'))}
 const firstEntry=batch.entryId
 batch={...batch,...await h.command('giftBatch.add',row(casey,single.response_code,'synthetic-coffer-2112','50'))}
 const draft=await h.get('/api/coffer/gift-batches?id='+batch.id)
 assert.deepEqual(draft.entries.map(e=>e.appeal).sort(),[joint.response_code,single.response_code].sort())
 assert.equal((await h.get('/api/coffer/appeals/'+appeal.id)).results.responded,0,'Draft entries contribute no ledger money')
 // The correction door retains a stored code when no replacement is supplied.
 batch={...batch,...await h.command('giftBatch.edit',{...row(alex,undefined,'synthetic-coffer-2111'),entryId:firstEntry})}
 await h.command('giftBatch.close',{batchId:batch.id,version:batch.version-1},{status:409})
 const closed=await h.command('giftBatch.close',{batchId:batch.id,version:batch.version})
 await h.command('giftBatch.close',{batchId:batch.id,version:closed.version},{status:409})
 const after=(await h.get('/api/coffer/appeals/'+appeal.id)).results
 assert.deepEqual([after.responded,after.recipients,after.responseRate,after.gifts,after.dollarsCents],[2,4,0.5,2,12500])
 assert.deepEqual([after.pieceCount,after.respondedPieces,after.pieceResponseRate],[3,2,2/3])
 assert.deepEqual([after.delivered,after.opened,after.clicked],[null,null,null])
 for(const p of [joint,single])assert.equal(after.pieces.find(r=>r.pieceId===p.id).responded,true)
 assert.equal(after.pieces.find(r=>r.pieceId===blank.id).responded,false)
 const attribution=await h.get('/api/coffer/reports/attribution?from='+sentOn+'&to='+sentOn)
 assert.equal(attribution.channel.find(r=>r.key==='mail').amountCents,12500)
 assert.equal(attribution.appeal.find(r=>r.key===joint.response_code).amountCents,7500)
 assert.equal(attribution.appeal.find(r=>r.key===single.response_code).amountCents,5000)
 // Keep the existing run code working beside the more precise piece codes.
 await give(blair,'25',sentOn,{appeal:appeal.code})
 const combined=(await h.get('/api/coffer/appeals/'+appeal.id)).results
 assert.deepEqual([combined.responded,combined.gifts,combined.dollarsCents,combined.respondedPieces],[3,3,15000,2])
 const frozen=detail.mailPieces
 await prepareVerifiedMail(h)
 const stale=await h.command('appeal.prepare',{name:'Stale household reply run',channel:'mail'})
 await h.command('household.update',{householdId:hid,version:(await household()).household.version,informal_override:'Later greeting'})
 assert.equal((await h.command('appeal.approve',{appealId:stale.id,version:1},{status:409})).error,'HOUSEHOLD_CHANGED')
 assert.deepEqual((await h.get('/api/coffer/appeals/'+appeal.id)).mailPieces,frozen)
 assert.equal(await (await h.request('/api/coffer/appeals/'+appeal.id+'/recipients.csv')).text(),csv)
 if(process.env.COFFER_MAIL_APPEALS_BROWSER){
  const directory=process.env.COFFER_MAIL_APPEALS_BROWSER;await mkdir(directory,{recursive:true})
  await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   const native=await h.command('giftBatch.create',{name:'Native coded replies '+width,receivedOn:sentOn,method:'check',expected:'10',fund:'Books'})
   await page.goto(origin+'/app/gifts/batches?id='+native.id+'&donor='+alex.id)
   await page.getByLabel('Gift amount (USD)',{exact:true}).fill('10')
   await page.getByLabel('Check number',{exact:true}).fill('synthetic-coffer-'+width)
   await page.getByLabel('Reply response code (optional)',{exact:true}).fill(joint.response_code)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/COMM-007-coded-entry-${width}.png`,fullPage:true})
   await page.getByRole('button',{name:'Add gift',exact:true}).click()
   await page.getByText('Response '+joint.response_code,{exact:false}).waitFor()
   const savedNative=await h.get('/api/coffer/gift-batches?id='+native.id)
   assert.equal(savedNative.entries[0].appeal,joint.response_code)
   await page.screenshot({path:`${directory}/COMM-007-coded-row-${width}.png`,fullPage:true})
   for(const [name,path] of [['prepare','/app/appeals'],['pieces-results','/app/appeals/'+appeal.id],['donor-history','/app/donors/'+alex.id]]){
    await page.goto(origin+path);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`${directory}/COMM-007-${name}-${width}.png`,fullPage:true})
   }
  }await page.close()})
 }
 await h.command('gift.reverse',{giftId:closed.giftIds.find(id=>id!==firstEntry),reason:'Returned reply check'})
 const corrected=(await h.get('/api/coffer/appeals/'+appeal.id)).results
 assert.deepEqual([corrected.gifts,corrected.dollarsCents,corrected.respondedPieces,corrected.pieceResponseRate],[2,10000,1,1/3])
 const saved=await archive(h)
 await run(async fresh=>{
  await restore(fresh,saved)
  assert.deepEqual((await fresh.get('/api/coffer/appeals/'+appeal.id)).results,corrected)
  assert.deepEqual((await fresh.get('/api/coffer/appeals/'+appeal.id)).mailPieces,frozen)
  assert.equal((await fresh.get('/api/coffer/gift-batches?id='+batch.id)).entries.find(e=>e.id===firstEntry).appeal,joint.response_code)
  await fresh.command('donor.erase',{donorId:alex.id,confirm:'ERASE'})
  assert.ok(!(await fresh.get('/api/coffer/appeals/'+appeal.id)).mailPieces.some(p=>p.id===joint.id))
  assert.equal((await fresh.get('/api/coffer/appeals/'+appeal.id)).results.dollarsCents,10000,'Redaction retains non-identifying code-to-run ledger custody')
 })
}
