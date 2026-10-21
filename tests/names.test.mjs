import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'

const history=(h,d)=>h.get('/api/coffer/donors/'+d.id)
const profile=async(h,d,input)=>h.command('donor.profile',{donorId:d.id,version:(await history(h,d)).donor.version,...input})
const importFile=async(h,source,text)=>{
 const input={source,files:[{name:'constituents.csv',base64:Buffer.from(text).toString('base64')}]},preview=await h.api('/api/coffer/move-in/preview',input)
 assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
 let job=await h.api('/api/coffer/move-in/apply',{id:preview.id,fingerprint:preview.fingerprint})
 while(job.state==='applying')job=await h.api('/api/coffer/move-in/continue',{id:job.id})
}

test('DONOR-014: name parts compute informal, formal and envelope names; overrides stay as typed; receipts and imports use them',()=>run(async h=>{
 await reviewed(h)
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
 await profile(h,robert,{envelopeName:'  The Smith Family ',formalSalutation:'Dr. and Mrs. Smith',nickname:'Rob'})
 assert.deepEqual((await history(h,robert)).names,{informal:'Rob',formal:'Dr. and Mrs. Smith',envelope:'The Smith Family'})
 batch=await h.command('ack.prepare',{});letter=(await h.get('/api/coffer/letters/'+batch.id)).letters[0]
 assert.equal(letter.recipient_name,'The Smith Family');assert.match(letter.body,/Dear Rob,/)
 await profile(h,robert,{envelopeName:'',formalSalutation:null})
 assert.deepEqual((await history(h,robert)).names,{informal:'Rob',formal:'Dr. Smith',envelope:'Dr. Robert A. Smith Jr.'})
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
}))
