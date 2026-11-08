import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { run, donor, reviewed } from '/workspace/coffer-f172/tests/harness.mjs'
import { assertToolAudit } from '/workspace/coffer-f172/tests/mcp-journey.mjs'
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const receipt={head,door:'/api/coffer/mcp',profiles:[],providerSubmissions:0}
await run(async h=>{
 await reviewed(h)
 const allowed=await donor(h,'Synthetic probe supporter'),outside=await donor(h,'Synthetic withheld supporter')
 for(const profile of ['preparation-only','named-grant']){
  const key=await h.command('agent.create',{label:'Synthetic '+profile+' probe'})
  let grantId='preparation:'+key.id
  if(profile==='named-grant'){
   const grant=await h.command('agentGrant.save',{name:'Synthetic probe grant',donorIds:[allowed.id],permissions:['donors.list','donors.context','ack.prepare'],dailyLimit:1})
   grantId=grant.id
   await h.command('agentGrant.attach',{keyId:key.id,grantId})
  }
  const calls=[],transport=[]
  const call=async(tool,args={},extra={})=>{
   const response=await h.request('/api/coffer/mcp',{method:'POST',as:'',headers:{authorization:'Bearer '+key.token,accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':tool,traceparent:'00-abcdef0123456789abcdef0123456789-abcdef0123456789-01',...extra},body:{jsonrpc:'2.0',id:7,method:'tools/call',params:{name:tool,arguments:args,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:key.token,version:'synthetic-coffer-client-input'}}}}})
   assert.equal(response.status,200)
   const answer=await response.json(),requestId=response.headers.get('x-request-id')
   calls.push({requestId,tool,answer})
   const code=answer.result.isError?JSON.parse(answer.result.content[0].text).error:'OK'
   transport.push({rpcId:7,requestId,tool,outcome:answer.result.isError?'refused':'done',code})
   return answer.result.structuredContent??JSON.parse(answer.result.content[0].text)
  }
  await Promise.all([1,2,3].map(()=>call('donors.context',{donorId:allowed.id})))
  const refusal=await call('donors.context',{donorId:profile==='named-grant'?outside.id:'synthetic-coffer-absent'})
  assert.equal(refusal.error,profile==='named-grant'?'GRANT_SCOPE':'NOT_FOUND')
  const gift=await h.command('gift.record',{donorId:allowed.id,amount:'250',receivedOn:'2026-09-20',method:'check',goods:'none'})
  const replay={'idempotency-key':'synthetic-coffer-probe-idempotency'}
  const prepared=await call('ack.prepare',{giftIds:[gift.id]},replay)
  assert.deepEqual(await call('ack.prepare',{giftIds:[gift.id]},replay),prepared)
  assert.equal((await h.get('/api/coffer/letters/'+prepared.id)).batch.status,'prepared')
  await h.command('ack.approve',{batchId:prepared.id,version:prepared.version},{as:'',headers:{authorization:'Bearer '+key.token},status:403})
  assert.equal((await h.get('/api/coffer/letters/'+prepared.id)).batch.status,'prepared')
  await h.command('ack.approve',{batchId:prepared.id,version:prepared.version})
  assert.equal((await h.get('/api/coffer/letters/'+prepared.id)).batch.status,'approved')
  const rows=await assertToolAudit(h,key,profile,calls,[key.token,'synthetic-coffer-client-input','synthetic-coffer-probe-idempotency',...(profile==='named-grant'?[outside.id]:[])])
  await h.command('agent.revoke',{id:key.id})
  assert.deepEqual(await assertToolAudit(h,key,profile),rows)
  const rejected=await h.request('/api/coffer/mcp',{method:'POST',as:'',headers:{authorization:'Bearer '+key.token},body:{}})
  assert.equal(rejected.status,401)
  assert.equal(h.messages.length,0)
  receipt.profiles.push({profile,keyId:key.id,grantId,transport,rows,attempts:rows.filter(row=>row.action==='mcp.tool.attempt').length,outcomes:rows.filter(row=>row.action==='mcp.tool.outcome').length,revocationRetained:true,approvalRequired:true,approvalAfterHuman:'approved',preparationReplaySameBatch:true})
 }
})
await writeFile(process.env.PROBE_RECEIPT,JSON.stringify(receipt,null,2)+'\n')
console.info('PROBE PASS head='+head+' profiles=2 attempts='+receipt.profiles.reduce((n,p)=>n+p.attempts,0)+' outcomes='+receipt.profiles.reduce((n,p)=>n+p.outcomes,0)+' providerSubmissions=0')
