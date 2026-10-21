import assert from 'node:assert/strict'
import {documentFormats,documentInput} from './document-fixtures.mjs'

export async function documentMatrix(h,{ada,other,gift,pledge,prospect,member,agent}){
 const admin=await h.person('document-admin@example.test','admin')
 const roles=[['owner',{}],['admin',{as:admin.cookie}],['member',{as:member.cookie}]]
 const targets=[['donor',ada.id],['gift',gift.id],['pledge',pledge.id],['opportunity',prospect.id]]
 const agentOptions={as:'',headers:{authorization:'Bearer '+agent.token}}
 const formats=documentFormats(),attachments=[]
 const secret='Private estate discussion: confidential board plans'
 const note=await h.command('interaction.record',{donorId:ada.id,kind:'note',notes:secret,confidential:true})
 for(const [role,options] of roles){
  for(const [kind,id] of targets)for(const format of formats){
   const title=`${role} ${kind} ${format.extension}`
   const input=documentInput(ada.id,kind,id,format,title)
   const doc=await h.api('/api/coffer/documents',input,options)
   const list=await h.get('/api/coffer/documents?donorId='+ada.id,options)
   const found=list.documents.find(d=>d.id===doc.id)
   assert.deepEqual([found.record_kind,found.record_id,found.title],[kind,id,title])
   assert.ok(!JSON.stringify(list).includes(secret))
   for(const door of ['preview','download']){
    const response=await h.request(`/api/coffer/documents/${doc.id}/${door}`,options)
    assert.equal(response.status,200,`${role} ${kind} ${format.extension} ${door}`)
    assert.equal(response.headers.get('content-type'),format.mediaType)
    assert.match(response.headers.get('content-disposition'),door==='preview'?/^inline;/:/^attachment;/)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),format.bytes)
   }
   attachments.push({doc,input,format})
  }
 }
 // Every denied reader is tested with real files present, including every parent and format.
 for(const [options,status] of [[agentOptions,403],[{as:''},401]]){
  await h.get('/api/coffer/documents?donorId='+ada.id,{...options,status})
  for(const {doc,input} of attachments){
   await h.api('/api/coffer/documents',input,{...options,status})
   for(const door of ['preview','download']){
    const response=await h.request(`/api/coffer/documents/${doc.id}/${door}`,options)
    assert.equal(response.status,status)
    const denied=await response.text()
    for(const value of [input.title,input.fileName,input.contentBase64,secret])assert.ok(!denied.includes(value),'A refusal contains no file metadata or content')
   }
  }
 }
 for(const [role,options] of roles){
  const input=attachments[0].input
  await h.api('/api/coffer/documents',{...input,donorId:other.id},{...options,status:409})
  await h.api('/api/coffer/documents',input,{...options,headers:{origin:'https://outside.example.test'},status:403})
  for(const ref of ['note:'+note.id,'research:'+ada.id])await h.api('/api/coffer/documents',{...input,recordRef:ref},{...options,status:400})
  await h.api('/api/coffer/documents',{...input,fileName:'../private.pdf'},{...options,status:400})
  await h.api('/api/coffer/documents',{...input,mediaType:'image/svg+xml'},{...options,status:400})
  for(const format of formats.filter(f=>f.extension!=='txt'))await h.api('/api/coffer/documents',{...input,mediaType:format.mediaType,contentBase64:Buffer.from('forged file').toString('base64')},{...options,status:400})
  assert.equal((await h.request(`/api/coffer/documents/${other.id}/download`,options)).status,404,role+' cannot read a foreign document identifier')
 }
 // Normal file reads never create a donor data request, nor expose confidential notes.
 const auditPath=`/api/coffer/audit?record=${ada.id}&action=donor.dataRequest`
 assert.equal((await h.get(auditPath)).total,0)
 const request={requestedOn:new Intl.DateTimeFormat('en-CA',{timeZone:(await h.get('/api/coffer/settings')).timezone}).format(new Date()),method:'email',reference:'DOC-008-MATRIX'}
 for(const options of [{as:member.cookie},agentOptions,{as:''}])await h.api(`/api/coffer/donors/${ada.id}/data-request`,request,{...options,status:options.as===''&&!options.headers?401:403})
 for(const [role,options] of roles.slice(0,2)){
  const file=await h.api(`/api/coffer/donors/${ada.id}/data-request`,request,options)
  assert.equal(file.records.record_documents.length,attachments.length)
  for(const {doc,format} of attachments)assert.deepEqual(Buffer.from(file.records.record_documents.find(d=>d.id===doc.id).content_base64,'base64'),format.bytes)
  assert.equal(file.withheld.confidentialStaffNotes,1)
  assert.ok(!JSON.stringify(file).includes(secret))
  const log=(await h.get(auditPath)).rows.find(row=>JSON.parse(row.detail).fileId===file.fileId)
  assert.equal(log.actor_role,role)
  const detail=JSON.parse(log.detail)
  assert.equal(detail.records.record_documents,attachments.length)
  assert.equal(detail.confidentialNotesWithheld,1)
  assert.deepEqual([detail.requestedOn,detail.method,detail.reference],[request.requestedOn,request.method,request.reference])
 }
 const input=attachments[0].input
 for(const options of [{as:admin.cookie},{as:member.cookie},agentOptions]){
  await h.api('/api/portability/exports',{},{...options,status:403})
  await h.api('/api/portability/imports',{manifest:{},confirmed:true},{...options,status:403})
  await h.command('donor.erase',{donorId:ada.id,confirm:'ERASE'},{...options,status:403})
 }
 await h.command('donor.erase',{donorId:ada.id,confirm:'yes'},{status:400})
 // MCP grants no document capability; known document operations are permission refusals.
 for(const name of ['documents.attach','documents.list','documents.preview','documents.download']){
  const response=await h.request('/api/coffer/mcp',{...agentOptions,method:'POST',headers:{...agentOptions.headers,accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':name},body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:input,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}}})
  assert.equal(response.status,403)
  const denied=await response.json();assert.equal(denied.error.data.code,'FORBIDDEN')
  assert.ok(!JSON.stringify(denied).includes(input.title))
 }
 return {admin,attachments}
}
