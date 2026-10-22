import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import assert from 'node:assert/strict'
import {run,installation,donor,reviewed,archive,restore} from './harness.mjs'

export async function organizationsJourney() {
 const submitted=[]
 await run(async h=>{
  await reviewed(h)
  const org=await donor(h,'Lakeside Community Foundation',{constituentKind:'organization',organizationType:'foundation',website:'https://lakeside.example.org',ein:'12-9876543',region:'Minnesota'})
  const maya=await donor(h,'Dr. Maya Chen',{region:'CA'}),owen=await donor(h,'Owen Carter',{region:'NY'})
  await h.command('donor.profile',{donorId:maya.id,version:1,prefix:'Dr.',firstName:'Maya',lastName:'Chen',informalSalutation:'Maya'})
  await h.command('organization.contact',{donorId:org.id,version:1,contactDonorId:maya.id,role:'Program director',primary:true})
  await h.command('organization.contact',{donorId:org.id,version:2,contactDonorId:owen.id,role:'Grants officer'})
  await h.command('organization.contact',{donorId:org.id,version:2,contactDonorId:owen.id,role:'Old edit'},{status:409})
  await h.command('organization.contact',{donorId:org.id,version:3,contactDonorId:org.id,role:'Not a person'},{status:409})
  const key=await h.command('agent.create',{label:'Organization read-only'})
  await h.command('organization.contact',{donorId:org.id,version:3,contactDonorId:owen.id,role:'No agent writes'},{as:'',headers:{authorization:`Bearer ${key.token}`},status:403})
  const gift=await h.command('gift.record',{donorId:org.id,amount:'10000',receivedOn:'2026-09-01',method:'check',reference:'Foundation grant 2026',fund:'Food access',goods:'none'})
  const detail=()=>h.get('/api/coffer/donors/'+org.id)
  let state=await detail()
  assert.deepEqual([state.donor.constituent_kind,state.donor.organization_type,state.donor.website,state.donor.ein],['organization','foundation','https://lakeside.example.org','12-9876543'])
  assert.equal(state.organization.contacts.length,2)
  assert.equal(state.gifts.find(g=>g.id===gift.id).amount_cents,1000000)
  for(const contact of [maya,owen]){
   const person=await h.get('/api/coffer/donors/'+contact.id)
   assert.equal(person.totals.lifetimeCents,0);assert.equal(person.gifts.length,0)
   assert.deepEqual(person.organization.relatedGifts.map(g=>[g.id,g.donor_id,g.amount_cents]),[[gift.id,org.id,1000000]])
   const html=await (await h.request('/app/donors/'+contact.id)).text()
   assert.match(html,/Related organization gift/);assert.match(html,/credited to the organization only/)
  }
  // Every documented greeting source is exercised through a prepared receipt.
  for(const [input,expected] of [
   [{informalSalutation:null,nickname:'May'},'May'],
   [{nickname:null},'Maya'],
   [{firstName:null},'Dr. Chen'],
   [{firstName:'Maya',informalSalutation:'Maya'},'Maya'],
  ]) {
   const current=(await h.get('/api/coffer/donors/'+maya.id)).donor
   await h.command('donor.profile',{donorId:maya.id,version:current.version,...input})
   const temporary=await h.command('ack.prepare',{giftIds:[gift.id]})
   assert.ok((await h.get('/api/coffer/letters/'+temporary.id)).letters[0].body.includes('Dear '+expected+','))
   await h.command('ack.discard',{batchId:temporary.id,version:1})
  }
  await h.command('consent.record',{donorIds:[org.id],channel:'mail',status:'granted',method:'paper form',evidence:'Organization postal permission',capturedOn:'2026-09-01'})
  await prepareVerifiedMail(h)
  const namedMail=await h.command('appeal.prepare',{name:'Organization salutation',channel:'mail'})
  await h.command('appeal.approve',{appealId:namedMail.id,version:1});await h.command('appeal.export',{appealId:namedMail.id,version:2})
  const frozenRecipient=(await h.get('/api/coffer/appeals/'+namedMail.id)).recipients.find(r=>r.donor_id===org.id)
  assert.equal(JSON.parse(frozenRecipient.name_fields).informal_salutation,'Maya')
  const batch=await h.command('ack.prepare',{giftIds:[gift.id]})
  const letter=(await h.get('/api/coffer/letters/'+batch.id)).letters[0]
  assert.equal(letter.donor_id,org.id);assert.equal(letter.recipient_name,'Lakeside Community Foundation\nAttn: Dr. Maya Chen')
  assert.match(letter.body,/Dear Maya,/);assert.match(letter.body,/\$10,000\.00/)
  assert.equal(JSON.parse(letter.address).region,'MN')
  await h.command('ack.approve',{batchId:batch.id,version:1})
  const printed=await (await h.request('/app/letters/'+batch.id+'/print')).text()
  assert.match(printed,/Lakeside Community Foundation<br>Attn: Dr. Maya Chen/)
  assert.match(printed,/Dear Maya,/)
  await h.command('ack.send',{batchId:batch.id,version:2})
  assert.ok(submitted[0].content.find(c=>c.type==='text/plain').value.includes('Lakeside Community Foundation\nAttn: Dr. Maya Chen\n\n'))
  const states=await h.get('/api/coffer/reports/states?year=2026')
  assert.deepEqual(states.rows.map(r=>[r.state,r.amountCents,r.donors]),[['MN',1000000,1]])
  const noContact=await donor(h,'School Without Contact',{constituentKind:'organization',organizationType:'school'})
  const noContactGift=await h.command('gift.record',{donorId:noContact.id,amount:'250',receivedOn:'2026-09-01',method:'check',goods:'none'})
  const noContactBatch=await h.command('ack.prepare',{giftIds:[noContactGift.id]})
  const fallback=(await h.get('/api/coffer/letters/'+noContactBatch.id)).letters[0]
  assert.equal(fallback.recipient_name,'School Without Contact');assert.match(fallback.body,/Dear School Without Contact,/)
  await h.command('ack.discard',{batchId:noContactBatch.id,version:1})
  const annual=await h.command('ack.prepareStatements',{donorId:org.id,year:2026})
  const annualLetter=(await h.get('/api/coffer/letters/'+annual.id)).letters[0]
  assert.equal(annualLetter.recipient_name,letter.recipient_name);assert.match(annualLetter.body,/Dear Maya,/)
  const property=await h.command('inKind.save',{donorId:org.id,description:'Books for the reading room',quantity:'20',receivedOn:'2026-09-02',statedValue:'200',goods:'none'})
  const propertyAck=await h.command('inKind.acknowledge',{donorId:org.id,inKindId:property.id,version:1,acknowledgedOn:'2026-09-03'})
  const propertyText=await (await h.request('/api/coffer/in-kind-acknowledgments/'+propertyAck.acknowledgmentId+'/download')).text()
  assert.match(propertyText,/Lakeside Community Foundation\nAttn: Dr. Maya Chen/);assert.match(propertyText,/Dear Maya,/)
  // Primary replacement is atomic; old prepared documents remain exact.
  await h.command('organization.contact',{donorId:org.id,version:(await detail()).donor.version,contactDonorId:owen.id,role:'Grants officer',primary:true})
  state=await detail();assert.deepEqual(state.organization.contacts.filter(r=>r.is_primary).map(r=>r.contact_donor_id),[owen.id])
  assert.equal((await h.get('/api/coffer/letters/'+batch.id)).letters[0].body,letter.body)
  // Contacts follow exact merge/undo custody without becoming financial credits.
  const duplicate=await donor(h,'Owen Duplicate')
  const merged=await h.command('donor.merge',{donorId:duplicate.id,version:(await h.get('/api/coffer/donors/'+duplicate.id)).donor.version,sourceDonorId:owen.id,sourceVersion:(await h.get('/api/coffer/donors/'+owen.id)).donor.version,reason:'duplicate_record'})
  assert.equal((await detail()).organization.contacts.find(r=>r.is_primary).contact_donor_id,duplicate.id)
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await detail()).organization.contacts.find(r=>r.is_primary).contact_donor_id,owen.id)
  const own=await h.api('/api/coffer/donors/'+org.id+'/data-request',{requestedOn:'2026-09-20',method:'email'})
  assert.ok(own.records.organization_contacts.every(r=>r.contact_donor_id.startsWith('counterpart-')))
  assert.ok(!JSON.stringify(own).includes('Dr. Maya Chen'))
  const saved=await archive(h),copy=await installation()
  try{await restore(copy,saved);assert.deepEqual((await copy.get('/api/coffer/donors/'+org.id)).organization,(await detail()).organization)}finally{await copy.close()}
  if(process.env.COFFER_ORGANIZATION_BROWSER){const {organizationsBrowser}=await import('./organizations-browser.mjs');await organizationsBrowser(h,process.env.COFFER_ORGANIZATION_BROWSER)}
  await h.command('donor.erase',{donorId:maya.id,confirm:'ERASE',reason:'donor_request'})
  assert.equal((await detail()).organization.contacts.length,1)
  assert.equal((await h.get('/api/coffer/appeals/'+namedMail.id)).recipients.find(r=>r.donor_id===org.id).name_fields,null)
  assert.equal((await h.get('/api/coffer/letters/'+batch.id)).letters[0].body,'[erased]')
  assert.ok(!(await (await h.request('/api/coffer/in-kind-acknowledgments/'+propertyAck.acknowledgmentId+'/download')).text()).includes('Maya'))
 },{verifiedMail:true,bindings:{MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic_organization_mail',MAIL_FROM:'receipts@example.test'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.sendgrid.com')
  submitted.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'organization-'+submitted.length}})
 }})
}
