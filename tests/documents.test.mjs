import {test} from 'node:test'
import assert from 'node:assert/strict'
import {agreement} from './document-fixtures.mjs'
import {documentMatrix} from './document-matrix.mjs'
import {installation,donor,archive,restore,imported} from './harness.mjs'


test('DONOR-008: attach, preview and export record documents, restore their R2 bytes, and erase them with the constituent',async()=>{
 const h=await installation(),pdf=agreement()
 try{
  const owner=(await h.get('/auth/session')).operator,member=await h.person('document-staff@example.test'),agent=await h.command('agent.create',{label:'No document authority'})
  const ada=await donor(h,'Avery Chen'),other=await donor(h,'Jordan Patel')
  const gift=await h.command('gift.record',{donorId:ada.id,amount:'250',receivedOn:'2026-01-05',method:'check',fund:'Library',goods:'none'})
  const pledge=await h.command('pledge.create',{donorId:ada.id,amount:'1000',pledgedOn:'2026-01-01',fund:'Library',installments:[{dueOn:'2026-12-31',amount:'1000'}]})
  const prospect=await h.command('prospect.save',{donorId:ada.id,ownerId:owner.id,label:'Reading room pledge',stage:'identify',askAmount:'1000',expectedCloseOn:'2026-12-31',nextStep:'Review signed pledge'})
  const attach=(recordRef,extra={},options={})=>h.api('/api/coffer/documents',{donorId:ada.id,recordRef,title:'Signed pledge agreement',fileName:'pledge-agreement.pdf',mediaType:'application/pdf',contentBase64:pdf.toString('base64'),...extra},options)
  await attach('donor:'+ada.id,{}, {as:'',status:401})
  await attach('donor:'+ada.id,{}, {as:'',headers:{authorization:'Bearer '+agent.token},status:403})
  await attach('donor:'+other.id,{}, {status:409})
  await attach('donor:'+ada.id,{}, {headers:{origin:'https://outside.example.test'},status:403})
  await attach('gift:'+gift.id,{mediaType:'image/svg+xml'},{status:400})
  await attach('donor:'+ada.id,{fileName:'../private.pdf'},{status:400})
  await attach('donor:'+ada.id,{contentBase64:Buffer.from('not a PDF').toString('base64')},{status:400})
  const matrix=await documentMatrix(h,{ada,other,gift,pledge,prospect,member,agent,pdf})
  const own=await attach('donor:'+ada.id,{}, {as:member.cookie})
  const gifts=await attach('gift:'+gift.id),opportunity=await attach('opportunity:'+prospect.id)
  const agreementDoc=await attach('pledge:'+pledge.id)
  // Photos use the same own-bucket door and preview policy.
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVh0AAAAASUVORK5CYII=','base64')
  const photo=await attach('donor:'+ada.id,{title:'Reading room photo',fileName:'room.png',mediaType:'image/png',contentBase64:png.toString('base64')})
  const otherFile=await h.api('/api/coffer/documents',{donorId:other.id,recordRef:'donor:'+other.id,title:'Other private agreement',fileName:'other.pdf',mediaType:'application/pdf',contentBase64:pdf.toString('base64')})
  const bindings=(await h.get('/api/coffer/documents?donorId='+ada.id)).documents
  assert.equal(bindings.length,matrix.attachments.length+5)
  for(const [document,kind,recordId] of [[own,'donor',ada.id],[gifts,'gift',gift.id],[opportunity,'opportunity',prospect.id],[agreementDoc,'pledge',pledge.id]]){
   const bound=bindings.find(d=>d.id===document.id)
   assert.deepEqual([bound.record_kind,bound.record_id],[kind,recordId])
  }
  for(const entry of [own,gifts,opportunity,agreementDoc]){
   const response=await h.request(`/api/coffer/documents/${entry.id}/preview`,{as:member.cookie})
   assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf')
   assert.match(response.headers.get('content-disposition'),/^inline;/)
   assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf)
  }
  assert.equal((await h.request(`/api/coffer/documents/${own.id}/download`,{as:''})).status,401)
  assert.equal((await h.request(`/api/coffer/documents/${own.id}/preview`,{as:'',headers:{authorization:'Bearer '+agent.token}})).status,403)
  let browserFiles=0
  if(process.env.COFFER_DOCUMENT_BROWSER){
   const {documentBrowser}=await import('./documents-browser.mjs')
   browserFiles=await documentBrowser(h,process.env.COFFER_DOCUMENT_BROWSER)
  }
  const day=new Date().toISOString().slice(0,10),file=await h.api(`/api/coffer/donors/${ada.id}/data-request`,{requestedOn:day,method:'email',reference:'DOC-008'})
  const docs=(await h.get('/api/coffer/documents?donorId='+ada.id)).documents
  assert.equal(file.records.record_documents.length,docs.length)
  assert.ok(!file.records.record_documents.some(d=>d.id===otherFile.id))
  assert.deepEqual(Buffer.from(file.records.record_documents.find(d=>d.id===agreementDoc.id).content_base64,'base64'),pdf)
  assert.deepEqual(Buffer.from(file.records.record_documents.find(d=>d.id===photo.id).content_base64,'base64'),png)
  const duplicate=await donor(h,'Avery Chen duplicate')
  const before=(await h.get('/api/coffer/donors/'+ada.id)).donor
  const mergeInput={sourceDonorId:ada.id,donorId:duplicate.id,sourceVersion:before.version,version:1,reason:'duplicate_record'}
  for(const options of [{as:member.cookie},{as:'',headers:{authorization:'Bearer '+agent.token}}])await h.command('donor.merge',mergeInput,{...options,status:403})
  const merged=await h.command('donor.merge',{sourceDonorId:ada.id,donorId:duplicate.id,sourceVersion:before.version,version:1,reason:'duplicate_record'},{as:matrix.admin.cookie})
  await attach('donor:'+ada.id,{},{as:member.cookie,status:409})
  await h.get('/api/coffer/documents?donorId='+ada.id,{as:member.cookie,status:404})
  assert.equal((await h.get('/api/coffer/documents?donorId='+duplicate.id)).documents.length,docs.length)
  assert.deepEqual(Buffer.from(await (await h.request(`/api/coffer/documents/${agreementDoc.id}/download`)).arrayBuffer()),pdf)
  for(const options of [{as:member.cookie},{as:'',headers:{authorization:'Bearer '+agent.token}}])await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'},{...options,status:403})
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'},{as:matrix.admin.cookie})
  assert.equal((await h.get('/api/coffer/documents?donorId='+ada.id)).documents.length,docs.length)
  const saved=await archive(h)
  assert.equal(saved[0].objects.length,docs.length+1+browserFiles)
  const fresh=await installation()
  try{
   await restore(fresh,saved)
   for(const doc of docs){
    const response=await fresh.request(`/api/coffer/documents/${doc.id}/download`)
    assert.equal(response.status,200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(file.records.record_documents.find(d=>d.id===doc.id).content_base64,'base64'))
   }
   const restoredFile=await fresh.api(`/api/coffer/donors/${ada.id}/data-request`,{requestedOn:day,method:'email',reference:'RESTORE-008'})
   assert.deepEqual(Buffer.from(restoredFile.records.record_documents.find(d=>d.id===agreementDoc.id).content_base64,'base64'),pdf)
   for(const as of [member.cookie])assert.equal((await h.request(`/api/coffer/documents/${agreementDoc.id}/preview`,{as})).status,200)
   const restoredMember=await fresh.person('restored-file-member@example.test')
   await fresh.command('donor.erase',{donorId:ada.id,reason:'donor_request',confirm:'ERASE'})
   await fresh.api(`/api/coffer/donors/${ada.id}/data-request`,{requestedOn:day,method:'email'},{status:404})
   await fresh.api('/api/coffer/documents',{donorId:ada.id,recordRef:'donor:'+ada.id,title:'Erased attachment',fileName:'erased.pdf',mediaType:'application/pdf',contentBase64:pdf.toString('base64')},{as:restoredMember.cookie,status:409})
   for(const doc of docs)for(const door of ['download','preview'])for(const as of [fresh.owner,restoredMember.cookie])assert.equal((await fresh.request(`/api/coffer/documents/${doc.id}/${door}`,{as})).status,404)
   assert.equal((await fresh.request(`/api/coffer/documents/${otherFile.id}/download`)).status,200)
   const after=await archive(fresh)
   assert.equal(after[0].objects.length,saved[0].objects.length-docs.length,'Only the erased constituent’s stored files leave the real R2 inventory')
   const protectedRestore=await installation()
   try{
    await restore(protectedRestore,saved,{status:400,laterJournal:{sourceIdentity:after[0].sourceIdentity,epoch:after[0].epoch,journal:after[0].journal}})
    for(const doc of docs)assert.equal((await protectedRestore.request(`/api/coffer/documents/${doc.id}/download`)).status,404,'An older archive cannot revive erased bytes when the current erasure journal is supplied')
    assert.equal((await archive(protectedRestore))[0].objects.length,0)
   }finally{await protectedRestore.close()}
  }finally{await fresh.close()}
  const moved=await imported(h),importDonor=(await h.get('/api/coffer/donors')).donors.find(d=>d.source==='stripe')
  const importedGift=(await h.get('/api/coffer/donors/'+importDonor.id)).gifts.find(g=>g.kind==='gift')
  const importedDoc=await h.api('/api/coffer/documents',{donorId:importDonor.id,recordRef:'gift:'+importedGift.id,title:'Later signed receipt',fileName:'later.pdf',mediaType:'application/pdf',contentBase64:pdf.toString('base64')})
  await h.api('/api/coffer/imports/undo',{id:moved.job.id},{status:409})
  assert.equal((await h.request(`/api/coffer/documents/${importedDoc.id}/download`)).status,200,'A later attachment fences import undo')
 }finally{await h.close()}
})
