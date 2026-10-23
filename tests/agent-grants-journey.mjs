import assert from 'node:assert/strict'
import { run, donor, reviewed, settings } from './harness.mjs'

function doors(h,key) {
 const headers={authorization:`Bearer ${key.token}`},version='2026-07-28'
 let sequence=0
 const http=(command,input,status=200)=>h.command(command,input,{as:'',headers,status})
 const get=(path,status=200)=>h.get(path,{as:'',headers,status})
 const mcp=async(name,args={},expectedError=null,status=200)=>{
  const response=await h.request('/api/coffer/mcp',{method:'POST',as:'',headers:{...headers,accept:'application/json, text/event-stream','mcp-protocol-version':version,'mcp-method':'tools/call','mcp-name':name},body:{jsonrpc:'2.0',id:++sequence,method:'tools/call',params:{name,arguments:args,_meta:{'io.modelcontextprotocol/protocolVersion':version,'io.modelcontextprotocol/clientCapabilities':{}}}}})
  const answer=await response.json();assert.equal(response.status,status,JSON.stringify(answer))
  if(status!==200)return answer
  assert.equal(answer.error,undefined,JSON.stringify(answer))
  assert.equal(answer.result.isError,!!expectedError,JSON.stringify(answer))
  const value=answer.result.structuredContent??JSON.parse(answer.result.content[0].text)
  if(expectedError)assert.equal(value.error,expectedError)
  return value
 }
 return {http,get,mcp}
}

/** One public-door journey for the named-grant authority boundary, through
 * ordinary HTTP and MCP. Only the paid mail submission edge is replaced. */
export async function agentGrantsJourney() {
 const messages=[]
 return run(async h=>{
  await reviewed(h)
  const template=await h.command('letterTemplate.save',{kind:'major_gift',name:'Standard thank-you',minAmount:'250',subject:settings.letterSubject,body:settings.letterTemplate})
  const ana=await donor(h,'Scoped Ana'),ben=await donor(h,'Private Ben'),house=await donor(h,'Scoped Household',{household:'Private household label'})
  const relative=await donor(h,'Private household member',{household:'Private household label'})
  const relation=await h.command('relationship.create',{donorId:ana.id,relatedDonorId:ben.id,type:'friend'})
  const key=await h.command('agent.create',{label:'Named receipt assistant'}),otherKey=await h.command('agent.create',{label:'Second named client'})
  const permissions=['donors.list','donors.context','ack.prepare','ack.send']
  const grantInput={name:'Standard receipt approval',donorIds:[ana.id,house.id],permissions,dailyLimit:2,standingApproval:true}
  const member=await h.person('grant.member@example.test')
  await h.command('agentGrant.save',grantInput,{as:member.cookie,status:403})
  await h.command('agentGrant.save',{...grantInput,standingApproval:false},{status:400})
  const grant=await h.command('agentGrant.save',grantInput)
  for(const k of [key,otherKey])await h.command('agentGrant.attach',{keyId:k.id,grantId:grant.id})
  const api=doors(h,key),second=doors(h,otherKey)
  const list=await api.get('/api/coffer/donors');assert.equal(list.total,2);assert.deepEqual(new Set(list.donors.map(d=>d.id)),new Set([ana.id,house.id]))
  assert.equal((await api.mcp('donors.list')).total,2)
  const native=await api.get(`/api/coffer/donors/${house.id}`),rpc=await api.mcp('donors.context',{donorId:house.id})
  assert.deepEqual(native,rpc);assert.ok(!JSON.stringify(native).includes(relative.id));assert.ok(!JSON.stringify(native).includes('Private household'))
  assert.equal((await api.get(`/api/coffer/donors/${ana.id}`)).household,undefined)
  assert.equal((await api.get(`/api/coffer/donors/${ben.id}`,403)).error,'GRANT_SCOPE')
  await api.mcp('donors.context',{donorId:ben.id},'GRANT_SCOPE')
  assert.equal((await api.get('/api/coffer/settings',403)).error,'GRANT_FORBIDDEN')
  assert.equal((await api.get('/api/coffer/donors?relatedTo='+ben.id,403)).error,'GRANT_SCOPE')
  await api.http('donor.create',{name:'Forbidden'},403)
  await api.mcp('appeal.prepare',{name:'Forbidden audience',channel:'email'},'GRANT_FORBIDDEN')
  const privateGift=await h.command('gift.record',{donorId:ben.id,amount:'250',receivedOn:'2025-08-10',method:'check',goods:'none'})
  assert.equal((await api.http('ack.prepare',{giftIds:[privateGift.id]},403)).error,'GRANT_SCOPE')
  await api.mcp('ack.prepare',{giftIds:[privateGift.id]},'GRANT_SCOPE')
  await api.http('ack.prepare',{},400)
  // Related-recipient rendering is refused even on a scoped donor. The limited
  // context above never traversed that relationship or household.
  const relatedGift=await h.command('gift.record',{donorId:ana.id,amount:'250',receivedOn:'2025-08-10',method:'check',goods:'none'})
  await api.http('ack.prepare',{giftIds:[relatedGift.id]},403)
  await h.command('relationship.remove',{donorId:ana.id,relationshipId:relation.id})
  const gifts=[relatedGift]
  for(let i=0;i<2;i++)gifts.push(await h.command('gift.record',{donorId:ana.id,amount:'250',receivedOn:'2025-08-10',method:'check',goods:'none'}))
  const batches=[]
  for(const [index,gift] of gifts.entries())batches.push(index===1?await api.mcp('ack.prepare',{giftIds:[gift.id]}):await api.http('ack.prepare',{giftIds:[gift.id]}))
  // Both doors share one atomic daily counter. Parallel calls reach the same
  // real native letter-delivery reservation and network submission service.
  const sent=await Promise.all([api.http('ack.send',{batchId:batches[0].id,version:1}),api.mcp('ack.send',{batchId:batches[1].id,version:1})])
  assert.ok(sent.every(s=>s.submitted===1));assert.equal(messages.length,2)
  const detail=await h.get(`/api/coffer/letters/${batches[0].id}`)
  assert.equal(detail.approval.prepared_by_role,'agent');assert.equal(detail.approval.approved_by_role,'owner');assert.equal(detail.approval.content_hash,batches[0].contentHash)
  assert.ok(detail.events.filter(e=>e.actor_role==='agent').every(e=>{const d=JSON.parse(e.detail);return d.grantId===grant.id&&d.grantVersion===1}))
  assert.equal((await api.http('ack.send',{batchId:batches[2].id,version:1},409)).error,'DAILY_LIMIT')
  await api.mcp('ack.send',{batchId:batches[2].id,version:1},'DAILY_LIMIT')
  // The other key cannot consume its colleague’s prepared batch, despite
  // sharing the same grant and daily counter.
  await second.mcp('ack.send',{batchId:batches[2].id,version:1},'GRANT_SCOPE')
  await h.command('letterTemplate.save',{templateId:template.id,version:1,name:'Revised standard thank-you',minAmount:'250',subject:settings.letterSubject,body:settings.letterTemplate+' Thank you again.'})
  assert.equal((await api.http('ack.send',{batchId:batches[2].id,version:1},409)).error,'TEMPLATES_CHANGED')
  await api.mcp('ack.send',{batchId:batches[2].id,version:1},'TEMPLATES_CHANGED')
  const control=(await h.get('/api/coffer/agent-grants')).control
  await h.command('agentGrant.kill',{version:control.version,enabled:false})
  await api.http('ack.send',{batchId:batches[2].id,version:1},401)
  await api.mcp('ack.send',{batchId:batches[2].id,version:1},null,401)
  await api.get('/api/coffer/donors',401)
  await h.command('agentGrant.kill',{version:control.version+1,enabled:true})
  const narrow=await h.command('agentGrant.save',{...grantInput,id:grant.id,version:1,donorIds:[ana.id],permissions:['donors.list','donors.context'],standingApproval:false})
  assert.equal((await api.get('/api/coffer/donors')).total,1)
  await api.mcp('donors.context',{donorId:house.id},'GRANT_SCOPE')
  assert.equal((await api.http('ack.prepare',{giftIds:[gifts[2].id]},403)).error,'GRANT_FORBIDDEN')
  await h.command('agentGrant.disable',{id:grant.id,version:narrow.version})
  await api.get('/api/coffer/donors',403)
  await api.mcp('donors.list',{},null,401)
  assert.equal(messages.length,2,'Refusals never submit more mail')
  // Legacy keys retain their AGENT-001 behavior until explicitly attached.
  const legacy=doors(h,await h.command('agent.create',{label:'Legacy preparation client'}))
  assert.ok((await legacy.get('/api/coffer/donors')).total>1)
  await legacy.http('ack.send',{batchId:batches[2].id,version:1},403)
 },{bindings:{MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-1'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.sendgrid.com');assert.equal(new URL(request.url).pathname,'/v3/mail/send')
  messages.push(await request.json())
  return new Response(null,{status:202,headers:{'x-message-id':`synthetic-coffer-${messages.length}`}})
 }})
}
