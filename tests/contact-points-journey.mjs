import { recognitionEdges, giveRecognition } from './recognition-edge.mjs'
import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {mkdir} from 'node:fs/promises'
export async function contactPointsJourney(){const receiptSubmissions=[],giving=recognitionEdges();await run(async h=>{
 await reviewed(h)
 const a=await donor(h,'Alex Contacts',{email:'synthetic-coffer-801@example.test',phone:'202-555-0101',household:'Contacts family'}),b=await donor(h,'Blake Contacts',{email:'synthetic-coffer-801@example.test',household:'Contacts family'})
 const state=()=>h.get('/api/coffer/donors/'+a.id)
 const save=async input=>{const d=(await state()).donor;return h.command('contact.save',{donorId:a.id,donorVersion:d.version,source:'synthetic-coffer-802',sourceOn:'2025-01-01',...input})}
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
 await h.command('ack.send',{batchId:receipt.id,version:2})
 assert.equal(receiptSubmissions.at(-1).personalizations[0].to[0].email,'synthetic-coffer-804@example.test','The real receipt send door submits to the selected primary work contact')
 const chosenGift=await h.command('gift.record',{donorId:a.id,amount:'320',receivedOn:'2025-02-15',method:'check',goods:'none'})
 const chosenReceipt=await h.command('ack.prepare',{giftIds:[chosenGift.id],emailType:'personal',addressType:'vacation'})
 const chosenLetter=(await h.get('/api/coffer/letters/'+chosenReceipt.id)).letters[0]
 assert.equal(chosenLetter.recipient_email,'synthetic-coffer-803@example.test');assert.equal(JSON.parse(chosenLetter.address).emailContactId,home.id)
 assert.equal(JSON.parse(chosenLetter.address).line1,'20 Lake Road')
 await h.command('ack.approve',{batchId:chosenReceipt.id,version:1});await h.command('ack.send',{batchId:chosenReceipt.id,version:2})
 assert.equal(receiptSubmissions.at(-1).personalizations[0].to[0].email,'synthetic-coffer-803@example.test','An explicit personal contact is submitted without changing the primary work contact')
 assert.equal((await state()).donor.email,'synthetic-coffer-804@example.test')
 const personalMail=receiptSubmissions.at(-1),reply=await h.request('/test-email',{method:'POST',body:{from:'synthetic-coffer-803@example.test',to:personalMail.reply_to.email,headers:{subject:'Re: '+personalMail.subject,'message-id':'<synthetic-coffer-813@example.test>'},raw:'Content-Type: text/plain; charset=utf-8\r\n\r\nThank you for the personal receipt.'}})
 assert.equal(reply.status,200);const replyOutcome=await reply.json();assert.equal(replyOutcome.rejected,null);assert.deepEqual(replyOutcome.forwarded,['owner@example.test'])
 assert.equal((await h.get('/api/coffer/replies')).find(r=>r.letter_id===chosenLetter.id).donor_id,a.id,'Replies from the exact bound nonprimary contact join the same donor history')
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
 // Household statements use that same document-day selection, including an explicit chosen address.
 await h.command('ack.discard',{batchId:june.id,version:1})
 const householdId=(await state()).donor.household_id;assert.ok(householdId)
 const householdWinter=await h.command('ack.prepareStatements',{year:2025,householdId},{headers:{'x-test-now':'2026-01-15T12:00:00Z'}})
 const householdLetter=(await h.get('/api/coffer/letters/'+householdWinter.id)).letters[0]
 assert.equal(householdLetter.household_id,householdId);assert.equal(JSON.parse(householdLetter.address).line1,'50 Winter Lane');assert.equal(householdLetter.amount_cents,62000)
 await h.command('ack.discard',{batchId:householdWinter.id,version:1})
 const householdVacation=await h.command('ack.prepareStatements',{year:2025,householdId,addressType:'vacation'},{headers:{'x-test-now':'2026-06-15T12:00:00Z'}})
 assert.equal(JSON.parse((await h.get('/api/coffer/letters/'+householdVacation.id)).letters[0].address).line1,'20 Lake Road')
 await h.command('ack.discard',{batchId:householdVacation.id,version:1})

 // The real licensed queue and scheduler verify the effective contact, not a dormant home address.
 const postConsent=d=>h.command('consent.record',{donorId:d.id,channel:'mail',status:'granted',method:'paper form',evidence:'synthetic-coffer-810',capturedOn:'2025-01-01'})
 await postConsent(a);await postConsent(b)
 const mailingList=await h.command('list.save',{name:'Contact household',filters:{q:'Contacts'}})
 const januaryHeaders={'x-test-now':'2026-01-15T12:00:00Z'}
 await prepareVerifiedMail(h,{headers:januaryHeaders})
 const winterMail=await h.command('appeal.prepare',{name:'January seasonal mail',channel:'mail',listId:mailingList.id},{headers:januaryHeaders})
 const winterRecipients=(await h.get('/api/coffer/appeals/'+winterMail.id)).recipients,winterRecipient=winterRecipients.find(r=>r.donor_id===a.id)
 assert.equal(JSON.parse(winterRecipient.address).line1,'50 Winter Lane');assert.equal(JSON.parse(winterRecipient.address).addressContactId,s.id)
 assert.equal(winterMail.pieceCount,2,'Household members at different effective addresses get separate postal pieces')
 await h.command('appeal.approve',{appealId:winterMail.id,version:1},{headers:januaryHeaders});await h.command('appeal.export',{appealId:winterMail.id,version:2},{headers:januaryHeaders})
 const marchHeaders={'x-test-now':'2026-03-31T12:00:00Z'}
 await prepareVerifiedMail(h,{headers:marchHeaders})
 const seasonBoundary=await h.command('appeal.prepare',{name:'End of seasonal window',channel:'mail',listId:mailingList.id},{headers:marchHeaders})
 assert.equal((await h.command('appeal.approve',{appealId:seasonBoundary.id,version:1},{headers:{'x-test-now':'2026-04-01T12:00:00Z'},status:409})).error,'ADDRESS_CHANGED','A changed seasonal window refuses approval while the pass remains inside 95 days')
 const juneHeaders={'x-test-now':'2026-06-15T12:00:00Z'}
 await prepareVerifiedMail(h,{headers:juneHeaders})
 const summerMail=await h.command('appeal.prepare',{name:'June primary mail',channel:'mail',listId:mailingList.id},{headers:juneHeaders})
 const summerRecipient=(await h.get('/api/coffer/appeals/'+summerMail.id)).recipients.find(r=>r.donor_id===a.id)
 assert.equal(JSON.parse(summerRecipient.address).line1,'1 Main Street');assert.notEqual(JSON.parse(summerRecipient.address).addressContactId,s.id)
 await h.command('appeal.approve',{appealId:summerMail.id,version:1},{headers:juneHeaders});await h.command('appeal.export',{appealId:summerMail.id,version:2},{headers:juneHeaders})
 const homeUnchanged=(await state()).donor;assert.equal(homeUnchanged.address_line1,'1 Main Street','Seasonal processing never rewrites the primary home contact')
 await prepareVerifiedMail(h,{headers:juneHeaders,addressType:'vacation'})
 const vacationMail=await h.command('appeal.prepare',{name:'Chosen vacation mail',channel:'mail',listId:mailingList.id,addressType:'vacation'},{headers:juneHeaders})
 const vacationRecipients=(await h.get('/api/coffer/appeals/'+vacationMail.id)).recipients
 assert.equal(vacationRecipients.length,1);assert.equal(vacationMail.excluded['no postal address'],1)
 assert.equal(JSON.parse(vacationRecipients[0].address).addressContactId,vacation.id);assert.equal(JSON.parse(vacationRecipients[0].address).line1,'20 Lake Road')
 await h.command('appeal.approve',{appealId:vacationMail.id,version:1},{headers:juneHeaders});await h.command('appeal.export',{appealId:vacationMail.id,version:2},{headers:juneHeaders})
 assert.match(await (await h.request('/api/coffer/appeals/'+winterMail.id+'/recipients.csv',{headers:juneHeaders})).text(),/50 Winter Lane/,'Previously exported winter mail retains its exact historical address')
 assert.ok((await state()).contactHistory.some(p=>p.point_id===vacation.id&&p.source==='ncoa'))
 const seasonal=points.find(p=>p.id===vacation.id)
 assert.ok(seasonal)
 const duplicates=await h.get('/api/coffer/duplicates')
 assert.ok(!duplicates.pairs.some(p=>[p.source.id,p.target.id].includes(a.id)&&[p.source.id,p.target.id].includes(b.id)),'Household sharing remains separate people')
 await h.command('consent.record',{donorId:a.id,channel:'email',status:'withdrawn',method:'paper form',evidence:'synthetic-coffer-805',capturedOn:'2025-01-01'})
 await h.command('consent.record',{donorId:b.id,channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-806',capturedOn:'2025-01-01'})
 assert.equal((await h.get('/api/coffer/donors/'+b.id)).current.email.status,'granted')
 await donor(h,'Unrelated Additional Contact',{email:'synthetic-coffer-803@example.test'},{status:409})
 const unrelated=await donor(h,'Unrelated Contacts',{email:'synthetic-coffer-807@example.test'})
 await h.command('contact.save',{donorId:unrelated.id,donorVersion:1,kind:'email',type:'other',value:'synthetic-coffer-803@example.test'},{status:409})
 const exported=await h.request('/api/coffer/exports/constituents.csv?q=Alex%20Contacts');assert.equal(exported.status,200);const text=await exported.text();assert.match(text,/synthetic-coffer-803/);assert.match(text,/synthetic-coffer-804/);assert.match(text,/20 Lake Road/)
 const anonymous=await h.request('/api/coffer/commands',{as:'',method:'POST',body:{command:'contact.save',input:{donorId:a.id,donorVersion:(await state()).donor.version,kind:'email',type:'other',value:'forged@example.test'}}});assert.equal(anonymous.status,401)
 if(process.env.COFFER_CONTACT_BROWSER){const directory=process.env.COFFER_CONTACT_BROWSER;await mkdir(directory,{recursive:true});await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+a.id+'#contact-points');const panel=page.locator('#contact-points');await panel.getByText('Add email',{exact:true}).click();await panel.locator('details').filter({has:page.locator('summary',{hasText:'Add email'})}).locator('input[name=value]').fill('synthetic-coffer-808@example.test');await panel.getByRole('button',{name:'Save contact',exact:true}).first().click();await page.waitForURL('**/app/donors/**#contact-points');assert.ok((await panel.innerText()).includes('synthetic-coffer-808@example.test'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/DONOR-013-contacts-'+width+'.png',fullPage:true});for(const [name,path] of [['addresses','/app/addresses'],['postal-choices','/app/appeals'],['winter','/app/appeals/'+winterMail.id],['vacation','/app/appeals/'+vacationMail.id],['chosen-receipt','/app/letters/'+chosenReceipt.id]]){await page.goto(origin+path);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits '+width);await page.screenshot({path:directory+'/DONOR-013-'+name+'-'+width+'.png',fullPage:true})}
 }await page.close()})}
 const tribute=await h.command('gift.record',{donorId:b.id,amount:'40',receivedOn:'2025-08-01',method:'check',goods:'none'})
 await h.command('tribute.record',{giftId:tribute.id,kind:'honor',honoree:'Synthetic Honoree',notificationDonorId:a.id})
 const notice=await h.command('tributeNotification.prepare',{giftId:tribute.id})
 const frozenNotice=(await h.get('/api/coffer/donors/'+b.id)).tributeNotifications.find(n=>n.id===notice.id)
 assert.equal(frozenNotice.recipient_email,'synthetic-coffer-804@example.test');assert.equal(JSON.parse(frozenNotice.contact_snapshot).emailContactId,work.id)
 await h.command('tributeNotification.approve',{notificationId:notice.id,version:1})
 // The actual public giving form matches an existing nonprimary contact; it
 // does not create another person or replace the chosen primary contact.
 await h.api('/api/coffer/giving/campaigns',{name:'Contact matching',slug:'autumn-reading',description:'Synthetic contact matching campaign.',fund:'Reading',goal:'1000'})
 await giveRecognition(h,{name:'Alex Contacts',email:'synthetic-coffer-803@example.test',amount:'25.00'})
 const matched=await state(),onlineGift=matched.gifts.find(g=>g.source==='stripe'&&g.amount_cents===2500)
 assert.ok(onlineGift);assert.equal(onlineGift.donor_id,a.id)
 assert.deepEqual((await h.get('/api/coffer/donors?q=synthetic-coffer-803')).donors.map(d=>d.id),[a.id])
 assert.equal(matched.donor.email,'synthetic-coffer-804@example.test')
 const onlineReceipt=(await h.get('/api/coffer/letters/receipt-'+onlineGift.id)).letters[0]
 assert.equal(onlineReceipt.recipient_email,'synthetic-coffer-804@example.test');assert.equal(JSON.parse(onlineReceipt.address).emailContactId,work.id)
 const before=await state(),saved=await archive(h)
 await run(async fresh=>{await restore(fresh,saved);const restored=await fresh.get('/api/coffer/donors/'+a.id);assert.deepEqual(restored.contactPoints,before.contactPoints);assert.deepEqual(restored.contactHistory,before.contactHistory);await fresh.command('donor.erase',{donorId:a.id,confirm:'ERASE'});const after=JSON.stringify(await archive(fresh));assert.doesNotMatch(after,/synthetic-coffer-803|synthetic-coffer-804|20 Lake Road|50 Winter Lane/)})
},{entry:'tests/engagement-worker.ts',verifiedMail:true,bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-814',MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-811',MAIL_FROM:'receipts@example.test',COFFER_REPLY_DOMAIN:'replies.example.test'},outbound:async request=>{const u=new URL(request.url);if(u.hostname==='api.stripe.com')return giving.outbound(request);assert.equal(u.origin,'https://api.sendgrid.com');assert.equal(u.pathname,'/v3/mail/send');receiptSubmissions.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-812-'+receiptSubmissions.length}})}})}
