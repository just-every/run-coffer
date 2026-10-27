import assert from 'node:assert/strict'
import {archive,donor,restore,reviewed,run,settings} from './harness.mjs'

const letterRows=lines=>lines.filter(p=>p.kind==='part').flatMap(p=>p.items).filter(i=>i.kind==='row'&&i.table==='cf_single_letters').map(i=>i.row)
const frozen=row=>Object.fromEntries(['recipient_name','address','subject','body','merge_blanks','template_id','template_version','context_snapshot','content_hash'].map(k=>[k,row[k]]))

/** The archive is a public custody door, including personal snapshots hidden by the UI. */
export async function singleLetterSnapshots(){
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'Ellis Snapshot'),other=await donor(h,'Jordan Context')
  await h.command('donor.profile',{donorId:d.id,version:1,firstName:'Ellis',lastName:'Snapshot',formalSalutation:'Dr. Snapshot',informalSalutation:'Ellis',envelopeName:'Ellis Snapshot household'})
  const gift=await h.command('gift.record',{donorId:d.id,amount:'420',receivedOn:'2025-08-10',method:'check',goods:'none'})
  for(const [key,kind] of [['single_board','constituent'],['single_reference','gift'],['single_topic','interaction']])await h.command('custom.define',{key,label:key,kind,type:'text'})
  await h.command('custom.set',{key:'single_reference',recordId:gift.id,value:'Reviewed gift reference'})
  const catalog=(await h.get('/api/coffer/template-fields')).templates.find(t=>t.kind==='first_gift')
  for(const field of ['email','postal_address','formal_salutation','household_addressee','custom.single_board','custom.single_reference','custom.single_topic'])assert.ok(catalog.fields.includes(field),field+' is available to the single-letter template')
  const body=settings.letterTemplate+'\nEnvelope {{envelope_name}}. Formal {{formal_salutation}}.\nEmail {{email}}\nPostal {{postal_address}}\nBoard {{custom.single_board|our board}}\nGift {{custom.single_reference|no reference}}\nConversation {{custom.single_topic}} {{custom.single_topic}}\nHousehold {{household_addressee|Individual donor}}'
  await h.command('letterTemplate.save',{kind:'first_gift',name:'Unknown snapshot field',subject:'Copy',body:body+' {{unknown_single_field|unavailable}}'},{status:400})
  const template=await h.command('letterTemplate.save',{kind:'first_gift',name:'Snapshot thanks',subject:'Copy for {{donor_name}}',body})
  const foreign=await h.command('interaction.record',{donorId:other.id,kind:'call',occurredOn:'2025-08-11',notes:'Other donor context'})
  await h.command('singleLetter.prepare',{donorId:d.id,templateId:template.id,contextId:gift.id,interactionId:foreign.id},{status:400})
  const beforeDonor=(await h.get('/api/coffer/donors/'+d.id)),oldAddress=beforeDonor.contactPoints.find(p=>p.kind==='address'&&p.is_primary)
  assert.ok(oldAddress)
  const copy=await h.command('singleLetter.prepare',{donorId:d.id,templateId:template.id,contextId:gift.id})
  const initial=letterRows(await archive(h)).find(r=>r.id===copy.id);assert.ok(initial)
  assert.equal(initial.recipient_name,'Ellis Snapshot household');assert.equal(initial.template_id,template.id);assert.equal(initial.template_version,1)
  assert.deepEqual(JSON.parse(initial.context_snapshot),{gifts:[{id:gift.id,version:1,net:42000}]})
  assert.equal(JSON.parse(initial.address).addressContactId,oldAddress.id);assert.equal(JSON.parse(initial.address).line1,'1 Main Street')
  assert.deepEqual(JSON.parse(initial.merge_blanks),['custom.single_topic'],'Repeated empty fields are frozen once and literal defaults are not blanks')
  assert.match(initial.body,/Board our board/);assert.match(initial.body,/Gift Reviewed gift reference/);assert.match(initial.body,/Formal Dr\. Snapshot/);assert.match(initial.body,/Household Individual donor/)
  const review=await(await h.request('/app/single-letters/'+copy.id)).text();assert.match(review,/Empty merge fields: custom\.single_topic/)
  const newAddress=await h.command('contact.save',{donorId:d.id,donorVersion:beforeDonor.donor.version,kind:'address',type:'work',primary:true,value:{line1:'72 Cedar Avenue',city:'Madison',region:'WI',postalCode:'53703'}})
  await h.command('custom.set',{key:'single_board',recordId:d.id,value:'New board term'})
  await h.command('custom.set',{key:'single_reference',recordId:gift.id,version:1,value:'New gift reference'})
  await h.command('letterTemplate.save',{templateId:template.id,version:1,name:'Changed thanks',subject:'Changed copy for {{donor_name}}',body:body.replaceAll('{{custom.single_topic}}','{{custom.single_topic|No conversation}}')+'\nChanged wording'})
  const changed=letterRows(await archive(h)).find(r=>r.id===copy.id)
  assert.deepEqual(frozen(changed),frozen(initial),'Contact, template, context, exact wording and blank review remain frozen after all source edits')
  const oldPage=await(await h.request('/app/single-letters/'+copy.id)).text();assert.match(oldPage,/1 Main Street/);assert.match(oldPage,/Empty merge fields: custom\.single_topic/);assert.doesNotMatch(oldPage,/72 Cedar Avenue|New board term|New gift reference|Changed wording/)
  const conversation=await h.command('interaction.record',{donorId:d.id,kind:'call',occurredOn:'2025-08-11',notes:'Reviewed donor conversation'})
  await h.command('custom.set',{key:'single_topic',recordId:conversation.id,value:'A literal {{amount}} conversation'})
  const current=await h.command('singleLetter.prepare',{donorId:d.id,templateId:template.id,contextId:gift.id,interactionId:conversation.id})
  const saved=await archive(h),currentRow=letterRows(saved).find(r=>r.id===current.id)
  assert.equal(currentRow.template_version,2);assert.deepEqual(JSON.parse(currentRow.merge_blanks),[])
  assert.equal(JSON.parse(currentRow.address).addressContactId,newAddress.id);assert.equal(JSON.parse(currentRow.address).interactionId,conversation.id)
  assert.match(currentRow.body,/Postal 72 Cedar Avenue/);assert.match(currentRow.body,/Board New board term/);assert.match(currentRow.body,/Gift New gift reference/);assert.match(currentRow.body,/A literal \{\{amount\}\} conversation/);assert.match(currentRow.body,/Changed wording/)
  await run(async fresh=>{await restore(fresh,saved);const restored=letterRows(await archive(fresh));assert.deepEqual(frozen(restored.find(r=>r.id===copy.id)),frozen(initial));assert.deepEqual(frozen(restored.find(r=>r.id===current.id)),frozen(currentRow))})
  await h.command('donor.erase',{donorId:d.id,confirm:'ERASE'})
  const erased=letterRows(await archive(h)).filter(r=>[copy.id,current.id].includes(r.id))
  assert.equal(erased.length,2,'Erasure retains anonymous copies rather than hiding live personal snapshots')
  for(const row of erased){assert.equal(row.status,'erased');assert.equal(row.recipient_name,'Erased donor');assert.equal(row.address,'{}');assert.equal(row.subject,'');assert.equal(row.body,'');assert.equal(row.merge_blanks,'[]');assert.equal(row.context_snapshot,'{}');assert.equal(row.content_hash,'')}
  assert.doesNotMatch(JSON.stringify(erased),/Ellis|Snapshot household|Main Street|Cedar Avenue|Reviewed gift reference|New gift reference|New board term|literal.*conversation/)
 })
}
