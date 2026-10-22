import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {mkdir} from 'node:fs/promises'
export async function householdMailJourney(){await run(async h=>{
 await reviewed(h)
 const a=await donor(h,'Alex Household',{household:'Mail household'}),b=await donor(h,'Blake Household',{household:'Mail household'})
 const consent=(d,status='granted')=>h.command('consent.record',{donorId:d.id,channel:'mail',status,method:'paper form',evidence:'synthetic-coffer-901',capturedOn:'2025-01-01'})
 await consent(a);await consent(b)
 const give=(d,amount)=>h.command('gift.record',{donorId:d.id,amount,receivedOn:'2025-08-01',method:'check',goods:'none'})
 const ga=await give(a,'100'),gb=await give(b,'200'),joint=await give(a,'300')
 await h.command('softCredit.record',{giftId:joint.id,donorId:b.id,amount:'300'})
 const hid=(await h.get('/api/coffer/donors/'+a.id)).donor.household_id
 const hh=await h.get('/api/coffer/households/'+hid)
 await h.command('household.update',{householdId:hid,version:hh.household.version,addressee_override:'The Household Family',informal_override:'Alex and Blake',formal_override:'The Household Family'})
 const prepare=async(onePiecePer)=>{await prepareVerifiedMail(h);return h.command('appeal.prepare',{name:'Household mailing '+(onePiecePer??'default'),channel:'mail',...(onePiecePer?{onePiecePer}:{}),postagePerPiece:'0.73'})}
 const grouped=await prepare(),detail=await h.get('/api/coffer/appeals/'+grouped.id)
 assert.equal(grouped.pieceCount,1);assert.equal(detail.mailPieces.length,1)
 const piece=detail.mailPieces[0],snapshot=JSON.parse(piece.snapshot)
 assert.equal(piece.name,'The Household Family');assert.equal(JSON.parse(piece.names).household_informal_salutation,'Alex and Blake')
 assert.deepEqual(snapshot.gifts.map(g=>g.id).sort(),[ga.id,gb.id,joint.id].sort());assert.equal(snapshot.gifts.reduce((n,g)=>n+g.amountCents,0),60000)
 assert.equal(snapshot.headStatus,'none');assert.equal(snapshot.gifts.length,3,'The joint hard-credit ID is counted once, with no soft-credit line')
 await h.command('appeal.approve',{appealId:grouped.id,version:1});await h.command('appeal.export',{appealId:grouped.id,version:2})
 const download=await h.request('/api/coffer/appeals/'+grouped.id+'/recipients.csv')
 assert.equal(download.status,200);const csv=await download.text();assert.equal(csv.trim().split('\r\n').length,2);assert.match(csv,/The Household Family,Alex and Blake/)
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
 const frozen=await h.get('/api/coffer/appeals/'+grouped.id);assert.deepEqual(frozen.mailPieces,detail.mailPieces,'Non-financial household changes preserve the exported snapshot')
 if(process.env.COFFER_HOUSEHOLD_MAIL_BROWSER){const directory=process.env.COFFER_HOUSEHOLD_MAIL_BROWSER;await mkdir(directory,{recursive:true});await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});for(const [name,path] of [['prepare','/app/appeals'],['grouped','/app/appeals/'+grouped.id],['consent','/app/appeals/'+single.id],['distant','/app/appeals/'+distant.id]]){await page.goto(origin+path);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/RCPT-009-'+name+'-'+width+'.png',fullPage:true})}
 }await page.close()})}
 const saved=await archive(h);await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/appeals/'+grouped.id)).mailPieces,frozen.mailPieces);await fresh.command('donor.erase',{donorId:a.id,confirm:'ERASE'});assert.equal((await fresh.get('/api/coffer/appeals/'+grouped.id)).mailPieces.length,0)})
},{verifiedMail:true})}
