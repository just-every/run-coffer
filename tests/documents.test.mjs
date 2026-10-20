import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {installation,donor,archive,restore,imported} from './harness.mjs'

function agreement(){
 const stream='BT /F1 16 Tf 50 740 Td (Pledge agreement) Tj 0 -30 Td (Riverbend literacy project - signed by Avery Chen) Tj ET'
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
 let output='%PDF-1.4\n';const offsets=[0]
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${o}\nendobj\n`})
 const xref=Buffer.byteLength(output)
 output+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return Buffer.from(output)
}

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
  const own=await attach('donor:'+ada.id,{}, {as:member.cookie})
  const gifts=await attach('gift:'+gift.id),opportunity=await attach('opportunity:'+prospect.id)
  const agreementDoc=await attach('pledge:'+pledge.id)
  // Photos use the same own-bucket door and preview policy.
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVh0AAAAASUVORK5CYII=','base64')
  const photo=await attach('donor:'+ada.id,{title:'Reading room photo',fileName:'room.png',mediaType:'image/png',contentBase64:png.toString('base64')})
  const otherFile=await h.api('/api/coffer/documents',{donorId:other.id,recordRef:'donor:'+other.id,title:'Other private agreement',fileName:'other.pdf',mediaType:'application/pdf',contentBase64:pdf.toString('base64')})
  const bindings=(await h.get('/api/coffer/documents?donorId='+ada.id)).documents
  assert.equal(bindings.length,5)
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
  if(process.env.COFFER_DOCUMENT_BROWSER){
   const {documentBrowser}=await import('./documents-browser.mjs')
   await documentBrowser(h,ada,pledge,pdf,process.env.COFFER_DOCUMENT_BROWSER)
  }
  const day=new Date().toISOString().slice(0,10),file=await h.api(`/api/coffer/donors/${ada.id}/data-request`,{requestedOn:day,method:'email',reference:'DOC-008'})
  const docs=(await h.get('/api/coffer/documents?donorId='+ada.id)).documents
  assert.equal(file.records.record_documents.length,docs.length)
  assert.ok(!file.records.record_documents.some(d=>d.id===otherFile.id))
  assert.deepEqual(Buffer.from(file.records.record_documents.find(d=>d.id===agreementDoc.id).content_base64,'base64'),pdf)
  assert.deepEqual(Buffer.from(file.records.record_documents.find(d=>d.id===photo.id).content_base64,'base64'),png)
  const duplicate=await donor(h,'Avery Chen duplicate')
  const before=(await h.get('/api/coffer/donors/'+ada.id)).donor
  const merged=await h.command('donor.merge',{sourceDonorId:ada.id,donorId:duplicate.id,sourceVersion:before.version,version:1,reason:'duplicate_record'})
  assert.equal((await h.get('/api/coffer/documents?donorId='+duplicate.id)).documents.length,docs.length)
  assert.deepEqual(Buffer.from(await (await h.request(`/api/coffer/documents/${agreementDoc.id}/download`)).arrayBuffer()),pdf)
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await h.get('/api/coffer/documents?donorId='+ada.id)).documents.length,docs.length)
  const saved=await archive(h)
  assert.equal(saved[0].objects.length,docs.length+1)
  const fresh=await installation()
  try{
   await restore(fresh,saved)
   for(const doc of docs){
    const response=await fresh.request(`/api/coffer/documents/${doc.id}/download`)
    assert.equal(response.status,200)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),doc.id===photo.id?png:pdf)
   }
   const restoredFile=await fresh.api(`/api/coffer/donors/${ada.id}/data-request`,{requestedOn:day,method:'email',reference:'RESTORE-008'})
   assert.deepEqual(Buffer.from(restoredFile.records.record_documents.find(d=>d.id===agreementDoc.id).content_base64,'base64'),pdf)
   await fresh.command('donor.erase',{donorId:ada.id,reason:'donor_request',confirm:'ERASE'})
   for(const doc of docs)assert.equal((await fresh.request(`/api/coffer/documents/${doc.id}/download`)).status,404)
   assert.equal((await fresh.request(`/api/coffer/documents/${otherFile.id}/download`)).status,200)
   const after=await archive(fresh)
   assert.equal(after[0].objects.length,1,'Erased PDF and image bytes leave the real R2 inventory; the other constituent is retained')
  }finally{await fresh.close()}
  const moved=await imported(h),importDonor=(await h.get('/api/coffer/donors')).donors.find(d=>d.source==='stripe')
  const importedGift=(await h.get('/api/coffer/donors/'+importDonor.id)).gifts.find(g=>g.kind==='gift')
  const importedDoc=await h.api('/api/coffer/documents',{donorId:importDonor.id,recordRef:'gift:'+importedGift.id,title:'Later signed receipt',fileName:'later.pdf',mediaType:'application/pdf',contentBase64:pdf.toString('base64')})
  await h.api('/api/coffer/imports/undo',{id:moved.job.id},{status:409})
  assert.equal((await h.request(`/api/coffer/documents/${importedDoc.id}/download`)).status,200,'A later attachment fences import undo')
 }finally{await h.close()}
})
