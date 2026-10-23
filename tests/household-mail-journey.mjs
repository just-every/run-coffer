import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore,settings} from './harness.mjs'
import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {mkdir} from 'node:fs/promises'
export async function householdMailJourney(){await run(async h=>{
 await reviewed(h)
 const member=await h.person('synthetic-coffer-1603@example.test'),admin=await h.person('synthetic-coffer-1604@example.test','admin'),agent=await h.command('agent.create',{label:'synthetic-coffer-1605'}),asAgent={as:'',headers:{authorization:'Bearer '+agent.token}}
 const a=await donor(h,'Alex Household',{household:'Mail household'}),b=await donor(h,'Blake Household',{household:'Mail household'})
 const consent=(d,status='granted')=>h.command('consent.record',{donorId:d.id,channel:'mail',status,method:'paper form',evidence:'synthetic-coffer-901',capturedOn:'2025-01-01'})
 await consent(a);await consent(b)
 const give=(d,amount)=>h.command('gift.record',{donorId:d.id,amount,receivedOn:'2025-08-01',method:'check',goods:'none'})
 const ga=await give(a,'100'),gb=await give(b,'200'),joint=await give(a,'300')
 await h.command('softCredit.record',{giftId:joint.id,donorId:b.id,amount:'300'})
 const hid=(await h.get('/api/coffer/donors/'+a.id)).donor.household_id
 const hh=await h.get('/api/coffer/households/'+hid)
 await h.command('household.update',{householdId:hid,version:hh.household.version,addressee_override:'The Household Family',informal_override:'Alex and Blake',formal_override:'The Household Family'})
 const unverified=await h.command('ack.prepareStatements',{year:2025,householdId:hid})
 const unverifiedLetter=(await h.get('/api/coffer/letters/'+unverified.id)).letters[0]
 assert.equal(JSON.parse(unverifiedLetter.address).addressVerification,'unverified','Statements use stored addresses without waiting for processing')
 await h.command('ack.discard',{batchId:unverified.id,version:1})
 const prepare=async(onePiecePer)=>{await prepareVerifiedMail(h);return h.command('appeal.prepare',{name:'Household mailing '+(onePiecePer??'default'),channel:'mail',...(onePiecePer?{onePiecePer}:{}),postagePerPiece:'0.73'})}
 const grouped=await prepare(),detail=await h.get('/api/coffer/appeals/'+grouped.id)
 assert.equal(grouped.pieceCount,1);assert.equal(detail.mailPieces.length,1)
 const piece=detail.mailPieces[0],snapshot=JSON.parse(piece.snapshot)
 assert.equal(piece.name,'The Household Family');assert.equal(JSON.parse(piece.names).household_informal_salutation,'Alex and Blake')
 assert.deepEqual(snapshot.gifts.map(g=>g.id).sort(),[ga.id,gb.id,joint.id].sort());assert.equal(snapshot.gifts.reduce((n,g)=>n+g.amountCents,0),60000)
 assert.equal(snapshot.headStatus,'none');assert.equal(snapshot.gifts.length,3,'The joint hard-credit ID is counted once, with no soft-credit line')
 await h.command('appeal.approve',{appealId:grouped.id,version:1},{as:member.cookie,status:403});await h.command('appeal.approve',{appealId:grouped.id,version:1},{...asAgent,status:403});await h.command('appeal.approve',{appealId:grouped.id,version:1},{as:admin.cookie});await h.command('appeal.export',{appealId:grouped.id,version:2})
 const download=await h.request('/api/coffer/appeals/'+grouped.id+'/recipients.csv')
 assert.equal(download.status,200);const csv=await download.text();assert.equal(csv.trim().split('\r\n').length,2);assert.match(csv,/The Household Family,Alex and Blake/)
 const statement=await h.command('ack.prepareStatements',{year:2025,postagePerPiece:'0.73'})
 assert.deepEqual([statement.onePiecePer,statement.letters,statement.pieceCount,statement.estimatedPostageCents],['household',1,1,73])
 const statementDetail=await h.get('/api/coffer/letters/'+statement.id)
 assert.equal(statementDetail.letters[0].recipient_name,'The Household Family')
 assert.equal(JSON.parse(statementDetail.letters[0].address).addressVerification,'verified','Statements use the verified household address when available')
 assert.equal(statementDetail.letters[0].amount_cents,60000)
 assert.deepEqual(JSON.parse(statementDetail.letters[0].statement_gifts).map(g=>g.id).sort(),[ga.id,gb.id,joint.id].sort())
 await h.command('ack.discard',{batchId:statement.id,version:1})
 const constituentStatements=await h.command('ack.prepareStatements',{year:2025,onePiecePer:'constituent'})
 assert.deepEqual([constituentStatements.letters,constituentStatements.pieceCount],[2,2])
 const individuals=await h.get('/api/coffer/letters/'+constituentStatements.id)
 assert.equal(individuals.letters.reduce((n,l)=>n+l.amount_cents,0),60000)
 await h.command('ack.discard',{batchId:constituentStatements.id,version:1})
 const giftStatements=await h.command('ack.prepareStatements',{year:2025,onePiecePer:'gift'})
 assert.deepEqual([giftStatements.letters,giftStatements.pieceCount],[3,3])
 const giftStatementDetail=await h.get('/api/coffer/letters/'+giftStatements.id)
 assert.ok(giftStatementDetail.letters.every(l=>JSON.parse(l.statement_gifts).length===1))
 assert.equal(giftStatementDetail.letters.reduce((n,l)=>n+l.amount_cents,0),60000)
 await h.command('ack.approve',{batchId:giftStatements.id,version:1},{as:member.cookie,status:403});await h.command('ack.approve',{batchId:giftStatements.id,version:1},{...asAgent,status:403});await h.command('ack.approve',{batchId:giftStatements.id,version:1},{as:admin.cookie})
 await h.command('ack.discard',{batchId:giftStatements.id,version:2})
 const stableStatement=await h.command('ack.prepareStatements',{year:2025})
 await h.command('ack.approve',{batchId:stableStatement.id,version:1})
 const statementSnapshot=(await h.get('/api/coffer/letters/'+stableStatement.id)).letters[0]
 const separate=await prepare('constituent');assert.equal(separate.pieceCount,2)
 const byGift=await prepare('gift');assert.equal(byGift.pieceCount,3)
 // Only consenting people appear in the addressee, even when an override names both.
 await consent(b,'withdrawn')
 const single=await prepare('household'),singleDetail=await h.get('/api/coffer/appeals/'+single.id)
 assert.equal(single.pieceCount,1);assert.match(singleDetail.mailPieces[0].name,/Alex Household/);assert.doesNotMatch(singleDetail.mailPieces[0].name,/Blake|The Household Family/)
 assert.equal(single.excluded['consent withdrawn'],1)
 assert.equal(JSON.parse(singleDetail.mailPieces[0].snapshot).gifts.reduce((n,g)=>n+g.amountCents,0),60000,'Withdrawal changes the addressee, never the household hard-credit money')
 // Current-address grouping gives the distant member their own piece.
 await consent(b)
 const bd=(await h.get('/api/coffer/donors/'+b.id)).donor
 await h.command('donor.update',{donorId:b.id,version:bd.version,name:bd.name,email:bd.email,household:'Mail household',addressLine1:'2 Other Street',city:'Springfield',region:'IL',postalCode:'62701'})
 const distant=await prepare('household');assert.equal(distant.pieceCount,2)
 const stale=await prepare('household'),current=await h.get('/api/coffer/households/'+hid)
 await h.command('household.update',{householdId:hid,version:current.household.version,informal_override:'Later greeting'})
 assert.equal((await h.command('appeal.approve',{appealId:stale.id,version:1},{status:409})).error,'HOUSEHOLD_CHANGED')
 const keptStatement=(await h.get('/api/coffer/letters/'+stableStatement.id)).letters[0]
 assert.deepEqual([keptStatement.recipient_name,keptStatement.statement_gifts,keptStatement.household_snapshot,keptStatement.id],[statementSnapshot.recipient_name,statementSnapshot.statement_gifts,statementSnapshot.household_snapshot,statementSnapshot.id],'Non-financial edits retain the approved household run snapshot and numbering')
 const frozen=await h.get('/api/coffer/appeals/'+grouped.id);assert.deepEqual(frozen.mailPieces,detail.mailPieces,'Non-financial household changes preserve the exported snapshot')
 // Postal acknowledgment settings group envelopes while retaining each legal receipt.
 const back=(await h.get('/api/coffer/donors/'+b.id)).donor
 await h.command('donor.update',{donorId:b.id,version:back.version,name:back.name,email:back.email,household:'Mail household',addressLine1:'1 Main Street',city:'Springfield',region:'IL',postalCode:'62701'})
 const extraA=await give(a,'250'),extraB=await give(b,'250')
 await h.command('tribute.record',{giftId:extraA.id,kind:'memory',honoree:'Synthetic Reader'})
 const currentSettings=await h.get('/api/coffer/settings')
 await h.command('settings.update',{...settings,version:currentSettings.version,letterTemplate:settings.letterTemplate+'\nHousehold: {{household_addressee|Individual receipt}}'})
 const receiptGiftIds=[joint.id,extraA.id,extraB.id]
 for(const [mode,count] of [['gift',3],['constituent',2]]){
  const run=await h.command('ack.prepare',{giftIds:receiptGiftIds,onePiecePer:mode})
  assert.deepEqual([run.letters,run.pieceCount],[3,count]);await h.command('ack.discard',{batchId:run.id,version:1})
 }
 const acknowledgments=await h.command('ack.prepare',{giftIds:receiptGiftIds,onePiecePer:'household',postagePerPiece:'0.73'})
 assert.deepEqual([acknowledgments.letters,acknowledgments.pieceCount,acknowledgments.estimatedPostageCents],[3,1,73])
 const ackDetail=await h.get('/api/coffer/letters/'+acknowledgments.id)
 assert.equal(ackDetail.mailPieces.length,1);assert.equal(JSON.parse(ackDetail.mailPieces[0].letter_ids).length,3)
 assert.match(ackDetail.mailPieces[0].content,/Household: The Household Family/)
 assert.match(ackDetail.mailPieces[0].content,/Synthetic Reader/,'The new postal door retains tribute facts')
 await h.command('ack.approve',{batchId:acknowledgments.id,version:1},{as:member.cookie,status:403});await h.command('ack.approve',{batchId:acknowledgments.id,version:1},{...asAgent,status:403});await h.command('ack.approve',{batchId:acknowledgments.id,version:1});await h.command('ack.export',{batchId:acknowledgments.id,version:2})
 const paper=await h.request('/app/letters/'+acknowledgments.id+'/print'),paperText=await paper.text()
 assert.equal(paper.status,200);assert.equal((paperText.match(/<article class="letter"/g)||[]).length,1)
 for(const l of ackDetail.letters)assert.match(paperText,new RegExp('Receipt '+l.receipt_year+'-'+l.receipt_sequence))
 assert.match(paperText,/Hard-credit donor: Alex Household/);assert.match(paperText,/Hard-credit donor: Blake Household/)
 const labelPage=await (await h.request('/app/letters/'+acknowledgments.id+'/print?labels=1')).text();assert.equal((labelPage.match(/<address class="label"/g)||[]).length,1)
 const ackCsv=await (await h.request('/api/coffer/letters/'+acknowledgments.id+'/letters.csv')).text();assert.match(ackCsv,/addressee/);assert.equal((ackCsv.match(/The Household Family/g)||[]).length>=1,true)
 const singleCopy=await (await h.request('/app/letters/'+acknowledgments.id+'/print?letter='+ackDetail.letters[0].id)).text();assert.equal((singleCopy.match(/<article class="letter"/g)||[]).length,1)
 const staleGift=await give(a,'250'),staleAck=await h.command('ack.prepare',{giftIds:[staleGift.id],onePiecePer:'household'})
 const changedHousehold=await h.get('/api/coffer/households/'+hid)
 await h.command('household.update',{householdId:hid,version:changedHousehold.household.version,informal_override:'Another greeting'})
 await h.command('ack.approve',{batchId:staleAck.id,version:1},{status:409})
 assert.equal(await (await h.request('/app/letters/'+acknowledgments.id+'/print')).text(),paperText,'An exported grouped postal copy retains its exact names, numbers and gift facts after a household edit')
 // The mailing preview retains an explicitly selected deceased head and flags
 // overrides for review; it never chooses a replacement or rewrites old mail.
 await h.command('gift.record',{donorId:a.id,amount:'75',receivedOn:'2024-08-01',method:'check',goods:'none'})
 await h.command('household.update',{householdId:hid,version:(await h.get('/api/coffer/households/'+hid)).household.version,headDonorId:a.id})
 await donor(h,'Casey Household',{household:'Mail household'}) // Membership changes flag the retained manual overrides.
 await h.command('donor.profile',{donorId:a.id,version:(await h.get('/api/coffer/donors/'+a.id)).donor.version,constituentStatus:'deceased',deceasedOn:'2025-09-01'})
 assert.equal((await h.command('ack.prepareStatements',{year:2024,householdId:hid},{status:409})).error,'NAMES_UNCONFIRMED')
 await h.command('household.confirmNames',{householdId:hid,version:(await h.get('/api/coffer/households/'+hid)).household.version},{as:member.cookie})
 const headReview=await h.command('ack.prepareStatements',{year:2024,householdId:hid})
 const headLetter=(await h.get('/api/coffer/letters/'+headReview.id)).letters[0],headSnapshot=JSON.parse(headLetter.household_snapshot)
 assert.equal(headSnapshot.headStatus,'deceased');assert.equal(headSnapshot.overridesReview,true)
 assert.equal(headLetter.amount_cents,7500);assert.equal((await h.get('/api/coffer/households/'+hid)).household.head_donor_id,a.id,'The preview never guesses a replacement head')
 assert.deepEqual((await h.get('/api/coffer/letters/'+stableStatement.id)).letters[0].household_snapshot,statementSnapshot.household_snapshot,'Deceased-head changes preserve earlier statement snapshots')
 if(process.env.COFFER_HOUSEHOLD_MAIL_BROWSER){const directory=process.env.COFFER_HOUSEHOLD_MAIL_BROWSER;await mkdir(directory,{recursive:true});await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});for(const [name,path] of [['deceased-head-review','/app/letters/'+headReview.id],['prepare','/app/appeals'],['grouped','/app/appeals/'+grouped.id],['consent','/app/appeals/'+single.id],['distant','/app/appeals/'+distant.id],['statement-settings','/app/letters'],['household-statement','/app/letters/'+stableStatement.id],['acknowledgment','/app/letters/'+acknowledgments.id],['acknowledgment-print','/app/letters/'+acknowledgments.id+'/print'],['acknowledgment-labels','/app/letters/'+acknowledgments.id+'/print?labels=1']]){await page.goto(origin+path);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/RCPT-009-'+name+'-'+width+'.png',fullPage:true})}
 }await page.close()})}
 const saved=await archive(h);await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/appeals/'+grouped.id)).mailPieces,frozen.mailPieces);await fresh.command('donor.erase',{donorId:a.id,confirm:'ERASE'});assert.equal((await fresh.get('/api/coffer/appeals/'+grouped.id)).mailPieces.length,0);assert.equal((await fresh.get('/api/coffer/letters/'+acknowledgments.id)).mailPieces.length,0)})
},{verifiedMail:true})}
