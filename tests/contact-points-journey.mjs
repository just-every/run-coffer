import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {mkdir} from 'node:fs/promises'
export async function contactPointsJourney(){await run(async h=>{
 await reviewed(h)
 const a=await donor(h,'Alex Contacts',{email:'synthetic-coffer-801@example.test',phone:'202-555-0101',household:'Contacts family'}),b=await donor(h,'Blake Contacts',{email:'synthetic-coffer-801@example.test',household:'Contacts family'})
 const state=()=>h.get('/api/coffer/donors/'+a.id)
 const save=async input=>{const d=(await state()).donor;return h.command('contact.save',{donorId:a.id,donorVersion:d.version,source:'synthetic-coffer-802',sourceOn:'2025-01-01',...input},{entry:'tests/advancing-clock-worker.ts'})}
 const home=await save({kind:'email',type:'personal',value:'synthetic-coffer-803@example.test'})
 const work=await save({kind:'email',type:'work',value:'synthetic-coffer-804@example.test'})
 await save({kind:'phone',type:'home',value:'202-555-0102'})
 const vacation=await save({kind:'address',type:'vacation',value:{line1:'20 Lake Road',city:'Madison',region:'WI',postalCode:'53703',country:'United States'}})
 let points=(await state()).contactPoints
 assert.equal(points.filter(p=>p.kind==='email'&&p.is_primary).length,1)
 const make=await save({contactId:work.id,version:1,kind:'email',type:'work',value:'synthetic-coffer-804@example.test',primary:true})
 points=(await state()).contactPoints
 assert.deepEqual(points.filter(p=>p.kind==='email'&&p.is_primary).map(p=>p.id),[work.id])
 assert.equal((await state()).donor.email,'synthetic-coffer-804@example.test')
 const stale=await h.command('contact.save',{donorId:a.id,donorVersion:1,kind:'email',type:'work',value:'stale@example.test'},{status:409});assert.equal(stale.error,'VERSION')
 const history=(await state()).contactHistory
 assert.ok(history.some(r=>r.point_id===work.id&&r.version===1&&r.source==='synthetic-coffer-802'))
 assert.ok(history.some(r=>r.point_id===work.id&&r.version===2))
 assert.deepEqual((await h.get('/api/coffer/donors?q=synthetic-coffer-803')).donors.map(d=>d.id),[a.id],'Lookup searches a nonprimary email')
 assert.deepEqual((await h.get('/api/coffer/donors?q=202-555-0102')).donors.map(d=>d.id),[a.id],'Lookup searches a nonprimary phone')
 const gift=await h.command('gift.record',{donorId:a.id,amount:'300',receivedOn:'2025-01-15',method:'check',goods:'none'})
 const receipt=await h.command('ack.prepare',{giftIds:[gift.id]}),letter=(await h.get('/api/coffer/letters/'+receipt.id)).letters[0]
 assert.equal(letter.recipient_email,'synthetic-coffer-804@example.test')
 assert.equal(JSON.parse(letter.address).emailContactId,work.id)
 await h.command('ack.approve',{batchId:receipt.id,version:1})
 const mobile=await save({kind:'phone',type:'mobile',value:'202-555-0103',primary:true})
 assert.equal((await state()).donor.phone,'202-555-0103')
 const s=await save({kind:'address',type:'seasonal',value:{line1:'50 Winter Lane',city:'Tampa',region:'FL',postalCode:'33602',country:'United States'},startsOn:'11-01',endsOn:'03-31'})
 await h.command('contact.save',{donorId:a.id,donorVersion:(await state()).donor.version,kind:'address',type:'seasonal',value:{line1:'60 Overlap Lane',city:'Tampa',region:'FL',postalCode:'33602'},startsOn:'01-01',endsOn:'01-31'},{status:400})
 const january=await h.command('ack.prepareStatements',{year:2025,donorId:a.id},{headers:{'x-test-now':'2026-01-15T12:00:00Z'}})
 const winter=(await h.get('/api/coffer/letters/'+january.id)).letters[0]
 assert.equal(JSON.parse(winter.address).line1,'50 Winter Lane');assert.equal(JSON.parse(winter.address).addressContactId,s.id)
 await h.command('ack.discard',{batchId:january.id,version:1})
 const june=await h.command('ack.prepareStatements',{year:2025,donorId:a.id},{headers:{'x-test-now':'2026-06-15T12:00:00Z'}})
 assert.equal(JSON.parse((await h.get('/api/coffer/letters/'+june.id)).letters[0].address).line1,'1 Main Street')
 // Both document dates use the same yearly range without mutating the home address.

 const seasonal=points.find(p=>p.id===vacation.id)
 assert.ok(seasonal)
 const duplicates=await h.get('/api/coffer/duplicates')
 assert.ok(!duplicates.pairs.some(p=>[p.source.id,p.target.id].includes(a.id)&&[p.source.id,p.target.id].includes(b.id)),'Household sharing remains separate people')
 await h.command('consent.record',{donorId:a.id,channel:'email',status:'withdrawn',method:'paper form',evidence:'synthetic-coffer-805',capturedOn:'2025-01-01'})
 await h.command('consent.record',{donorId:b.id,channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-806',capturedOn:'2025-01-01'})
 assert.equal((await h.get('/api/coffer/donors/'+b.id)).current.email.status,'granted')
 const unrelated=await donor(h,'Unrelated Contacts',{email:'synthetic-coffer-807@example.test'})
 await h.command('contact.save',{donorId:unrelated.id,donorVersion:1,kind:'email',type:'other',value:'synthetic-coffer-803@example.test'},{status:409})
 const exported=await h.request('/api/coffer/exports/constituents.csv?q=Alex%20Contacts');assert.equal(exported.status,200);const text=await exported.text();assert.match(text,/synthetic-coffer-803/);assert.match(text,/synthetic-coffer-804/);assert.match(text,/20 Lake Road/)
 const anonymous=await h.request('/api/coffer/commands',{as:'',method:'POST',body:{command:'contact.save',input:{donorId:a.id,donorVersion:(await state()).donor.version,kind:'email',type:'other',value:'forged@example.test'}}});assert.equal(anonymous.status,401)
 if(process.env.COFFER_CONTACT_BROWSER){const directory=process.env.COFFER_CONTACT_BROWSER;await mkdir(directory,{recursive:true});await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+a.id+'#contact-points');const panel=page.locator('#contact-points');await panel.getByText('Add email',{exact:true}).click();await panel.locator('details').filter({has:page.locator('summary',{hasText:'Add email'})}).locator('input[name=value]').fill('synthetic-coffer-808@example.test');await panel.getByRole('button',{name:'Save contact',exact:true}).first().click();await page.waitForURL('**/app/donors/**#contact-points');assert.ok((await panel.innerText()).includes('synthetic-coffer-808@example.test'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/DONOR-013-contacts-'+width+'.png',fullPage:true})
 }await page.close()})}
 const tribute=await h.command('gift.record',{donorId:b.id,amount:'40',receivedOn:'2025-08-01',method:'check',goods:'none'})
 await h.command('tribute.record',{giftId:tribute.id,kind:'honor',honoree:'Synthetic Honoree',notificationDonorId:a.id})
 const notice=await h.command('tributeNotification.prepare',{giftId:tribute.id})
 const frozenNotice=(await h.get('/api/coffer/donors/'+b.id)).tributeNotifications.find(n=>n.id===notice.id)
 assert.equal(frozenNotice.recipient_email,'synthetic-coffer-804@example.test');assert.equal(JSON.parse(frozenNotice.contact_snapshot).emailContactId,work.id)
 await h.command('tributeNotification.approve',{notificationId:notice.id,version:1})
 const before=await state(),saved=await archive(h)
 await run(async fresh=>{await restore(fresh,saved);const restored=await fresh.get('/api/coffer/donors/'+a.id);assert.deepEqual(restored.contactPoints,before.contactPoints);assert.deepEqual(restored.contactHistory,before.contactHistory);await fresh.command('donor.erase',{donorId:a.id,confirm:'ERASE'});const after=JSON.stringify(await archive(fresh));assert.doesNotMatch(after,/synthetic-coffer-803|synthetic-coffer-804|20 Lake Road|50 Winter Lane/)})
},{entry:'tests/advancing-clock-worker.ts'})}
