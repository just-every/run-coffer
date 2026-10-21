import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,reviewed,settings} from './harness.mjs'

const history=(h,d)=>h.get('/api/coffer/donors/'+d.id)
const profile=async(h,d,input)=>h.command('donor.profile',{donorId:d.id,version:(await history(h,d)).donor.version,...input})
const importFile=async(h,source,text)=>{
 const input={source,files:[{name:'constituents.csv',base64:Buffer.from(text).toString('base64')}]},preview=await h.api('/api/coffer/move-in/preview',input)
 assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
 let job=await h.api('/api/coffer/move-in/apply',{id:preview.id,fingerprint:preview.fingerprint})
 while(job.state==='applying')job=await h.api('/api/coffer/move-in/continue',{id:job.id})
}

const delivered=[]
const nameLine='{{prefix}} | {{first_name}} | {{middle_name}} | {{last_name}} | {{suffix}} | {{nickname}} | {{informal_salutation}} | {{formal_salutation}} | {{envelope_name}}'

test('DONOR-014: name parts compute informal, formal and envelope names; overrides stay as typed; receipts and imports use them',()=>run(async h=>{
 await reviewed(h)
 await h.command('settings.update',{...settings,version:(await h.get('/api/coffer/settings')).version,letterTemplate:settings.letterTemplate+'\n'+nameLine})
 const robert=await donor(h,'Robert Smith'),ana=await donor(h,'Ana Lee')
 await profile(h,robert,{prefix:'Dr.',firstName:'Robert',middleName:'A.',lastName:'Smith',suffix:'Jr.',nickname:'Bob'})
 assert.deepEqual((await history(h,robert)).names,{informal:'Bob',formal:'Dr. Smith',envelope:'Dr. Robert A. Smith Jr.'})
 await profile(h,ana,{prefix:'Ms.',firstName:'Ana',lastName:'Lee'})
 assert.deepEqual((await history(h,ana)).names,{informal:'Ana',formal:'Ms. Lee',envelope:'Ms. Ana Lee'})
 await profile(h,ana,{prefix:null})
 assert.deepEqual((await history(h,ana)).names,{informal:'Ana',formal:'Ana Lee',envelope:'Ana Lee'})
 const gift=d=>h.command('gift.record',{donorId:d.id,amount:'300',receivedOn:'2026-09-01',method:'check',goods:'none'})
 // Acknowledgment letters greet by the informal salutation and address the envelope name.
 await gift(robert)
 let batch=await h.command('ack.prepare',{}),letter=(await h.get('/api/coffer/letters/'+batch.id)).letters[0]
 assert.equal(letter.recipient_name,'Dr. Robert A. Smith Jr.');assert.match(letter.body,/Dear Bob,/)
 await h.command('ack.discard',{batchId:batch.id,version:1})
 // An override is kept exactly as typed when the parts change; a computed value follows them.
 await profile(h,robert,{envelopeName:'  The Smith Family ',formalSalutation:'Dr. and Mrs. Smith',nickname:'Bob'})
 assert.deepEqual((await history(h,robert)).names,{informal:'Bob',formal:'Dr. and Mrs. Smith',envelope:'The Smith Family'})
 batch=await h.command('ack.prepare',{});letter=(await h.get('/api/coffer/letters/'+batch.id)).letters[0]
 assert.equal(letter.recipient_name,'The Smith Family');assert.match(letter.body,/Dear Bob,/)
 const frozen=letter.body
 assert.ok(frozen.includes('Dr. | Robert | A. | Smith | Jr. | Bob | Bob | Dr. and Mrs. Smith | The Smith Family'))
 await h.command('ack.approve',{batchId:batch.id,version:1})
 await h.command('ack.send',{batchId:batch.id,version:2})
 assert.equal(delivered.length,1)
 assert.ok(delivered[0].content[0].value.includes(frozen),'Receipt email uses the exact reviewed name fields')
 const print=await h.request('/app/letters/'+batch.id+'/print')
 assert.equal(print.status,200);assert.ok((await print.text()).includes('The Smith Family'))
 await profile(h,robert,{envelopeName:'',formalSalutation:null,nickname:'Rob'})
 assert.deepEqual((await history(h,robert)).names,{informal:'Rob',formal:'Dr. Smith',envelope:'Dr. Robert A. Smith Jr.'})
 assert.equal((await h.get('/api/coffer/letters/'+batch.id)).letters[0].body,frozen,'Already approved name merges remain frozen after profile changes')
 const statementBody='Dear {{donor_name}},\n{{year}}\n{{gift_list}}\n{{total}} {{goods_total}} {{deductible_total}}\n{{goods_statement}}\n{{organization}} {{ein}}\n'+nameLine
 await h.command('letterTemplate.save',{kind:'year_end',name:'Personal annual statement',subject:'{{formal_salutation}} — {{year}}',body:statementBody})
 const statement=await h.command('ack.prepareStatements',{year:2026,donorId:robert.id})
 const annual=(await h.get('/api/coffer/letters/'+statement.id)).letters[0]
 assert.equal(annual.subject,'Dr. Smith — 2026');assert.match(annual.body,/Dear Rob,/)
 assert.ok(annual.body.includes('Dr. | Robert | A. | Smith | Jr. | Rob | Rob | Dr. Smith | Dr. Robert A. Smith Jr.'))
 await h.command('ack.approve',{batchId:statement.id,version:1})
 const propertyTemplate='Dear {{donor_name}}, {{gift_date}} {{description}} {{quantity}} {{goods_statement}} {{organization}} {{ein}}\n'+nameLine
 await h.command('letterTemplate.save',{kind:'in_kind',name:'Personal property letter',subject:'Thank you, {{formal_salutation}}',body:propertyTemplate})
 const property=await h.command('inKind.save',{donorId:robert.id,description:'Reading tables',quantity:'2',statedValue:'400',receivedOn:'2026-09-01',goods:'none'})
 const issued=await h.command('inKind.acknowledge',{donorId:robert.id,inKindId:property.id,version:1,acknowledgedOn:'2026-09-02'})
 const propertyDoc=await h.request('/api/coffer/in-kind-acknowledgments/'+issued.acknowledgmentId+'/download')
 assert.equal(propertyDoc.status,200)
 assert.ok((await propertyDoc.text()).includes('Dr. | Robert | A. | Smith | Jr. | Rob | Rob | Dr. Smith | Dr. Robert A. Smith Jr.'))
 if(process.env.COFFER_NAMES_BROWSER){const {namesBrowser}=await import('./names-browser.mjs');await namesBrowser(h,{batchId:batch.id,statementId:statement.id,donorId:robert.id})}
 // Importers carry the incumbent's own names unchanged, as overrides only where they differ from the computed value.
 await importFile(h,'bloomerang','Account Number,First Name,Last Name,Email,Informal Name,Envelope Name\n821,Gina,Frost,gina.frost@example.org,G,The Frost Family\n822,Hank,Frost,hank.frost@example.org,Hank,\n')
 const named=async email=>(await history(h,(await h.get('/api/coffer/donors?q='+email)).donors[0]))
 let gina=await named('gina.frost'),hank=await named('hank.frost')
 assert.deepEqual([gina.donor.informal_salutation,gina.donor.envelope_name,gina.donor.formal_salutation],['G','The Frost Family',null])
 assert.deepEqual(gina.names,{informal:'G',formal:'Gina Frost',envelope:'The Frost Family'})
 assert.deepEqual([hank.donor.informal_salutation,hank.donor.envelope_name],[null,null])
 await importFile(h,'lgl','LGL Constituent ID,Name,Email,Short Salutation,Long Salutation,Addressee\n901,Ivy Moon,ivy.moon@example.org,Ives,Dr. Moon,Dr. and Mrs. Moon\n')
 const ivy=await named('ivy.moon')
 assert.deepEqual(ivy.names,{informal:'Ives',formal:'Dr. Moon',envelope:'Dr. and Mrs. Moon'})
},{bindings:{MAIL_PROVIDER:'sendgrid',MAIL_FROM:'receipts@example.test',MAIL_API_KEY:'synthetic-sendgrid-edge'},outbound:async request=>{
 assert.equal(new URL(request.url).hostname,'api.sendgrid.com')
 delivered.push(await request.json())
 return new Response(null,{status:202,headers:{'x-message-id':'synthetic-name-receipt'}})
}}))
