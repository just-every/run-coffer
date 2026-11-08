import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'
import {assertToolAudit} from './mcp-journey.mjs'

test('TEAM-003: owner filters changes by person, record and action and downloads the same audit as CSV',()=>run(async h=>{
 await reviewed(h)
 const member=await h.person('entry@example.test'),as={as:member.cookie}
 const a=await donor(h,'Avery Quinn',{},as),b=await donor(h,'Robin Cole')
 await h.command('gift.record',{donorId:a.id,amountCents:30000,receivedOn:'2026-10-01',method:'check',goods:'none'},as)
 const key=await h.command('agent.create',{label:'Receipt assistant'})
 await h.command('ack.prepare',{}, {as:'',headers:{authorization:`Bearer ${key.token}`}})
 // The same authenticated log and CSV preserve correlated private-read access
 // after revocation, while agent and member credentials cannot read the log.
 const trace='00-abcdef0123456789abcdef0123456789-abcdef0123456789-00'
 const tool=await h.request('/api/coffer/mcp',{method:'POST',as:'',headers:{authorization:`Bearer ${key.token}`,accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'donors.context',traceparent:trace},body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'donors.context',arguments:{donorId:a.id},_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}}})
 assert.equal(tool.status,200)
 const answer=await tool.json();assert.equal(answer.result.structuredContent.donor.id,a.id)
 const access=await assertToolAudit(h,{...key,label:'Receipt assistant'},'preparation-only',[{requestId:tool.headers.get('x-request-id'),tool:'donors.context',answer}])
 assert.equal(access.length,2)
 for(const row of access)assert.equal(JSON.parse(row.detail).traceparent,trace)
 const record=await h.get('/api/coffer/audit?'+new URLSearchParams({person:key.id,action:'mcp.tool.outcome',record:a.id}))
 assert.equal(record.total,1);assert.deepEqual(record.rows,access.filter(row=>row.action==='mcp.tool.outcome'))
 const ignored={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'donors.context',arguments:{donorId:a.id},_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},'io.modelcontextprotocol/clientInfo':{name:42,version:'synthetic-coffer-1'}}}}
 const mcpHeaders={authorization:`Bearer ${key.token}`,accept:'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':'tools/call','mcp-name':'donors.context'}
 assert.equal((await h.request('/api/coffer/mcp',{method:'POST',as:'',headers:mcpHeaders,body:ignored})).status,400)
 delete ignored.params._meta['io.modelcontextprotocol/clientInfo']
 for(const [as,authorization,status]of [['','',401],[h.owner,'',403]])assert.equal((await h.request('/api/coffer/mcp',{method:'POST',as,headers:{...mcpHeaders,authorization},body:ignored})).status,status)
 ignored.params.name='synthetic-coffer-unknown-tool'
 assert.equal((await h.request('/api/coffer/mcp',{method:'POST',as:'',headers:{...mcpHeaders,'mcp-name':ignored.params.name},body:ignored})).status,400)
 assert.deepEqual(await assertToolAudit(h,{...key,label:'Receipt assistant'},'preparation-only'),access,'Malformed metadata, unknown tools and unauthenticated callers produce no tool audit facts')
 const all=await h.get('/api/coffer/audit')
 assert.ok(all.rows.some(r=>r.action==='auth.signin'&&r.actor_id===member.id))
 assert.ok(all.rows.some(r=>r.actor_id===key.id&&r.action==='ack.prepare'))
 const query=new URLSearchParams({person:member.id,record:a.id,action:'gift.record',from:'2026-01-01',to:'2026-12-31'})
 const filtered=await h.get('/api/coffer/audit?'+query)
 assert.equal(filtered.total,1)
 assert.equal(filtered.rows[0].actor_id,member.id)
 assert.equal(filtered.rows[0].donor_id,a.id)
 const response=await h.request('/api/coffer/audit.csv?'+query),csv=await response.text()
 assert.equal(response.status,200)
 assert.match(csv,/gift.record/);assert.match(csv,/30000/)
 assert.ok(!csv.includes(b.id));assert.ok(!csv.includes(key.token));assert.ok(!csv.includes('token_hash'))
 const downloads=await h.get('/api/coffer/audit?action=export.download')
 assert.equal(downloads.rows[0].subject_id,'/api/coffer/audit.csv')
 assert.equal((await h.request('/app/audit')).status,200)
 await h.get('/api/coffer/audit',{...as,status:403})
 await h.get('/api/coffer/audit.csv',{as:'',headers:{authorization:`Bearer ${key.token}`},status:403})
 await h.get('/api/coffer/audit',{as:'',status:401})
 await h.get('/api/coffer/audit.csv',{...as,status:403})
 await h.command('agent.revoke',{id:key.id})
 assert.deepEqual(await assertToolAudit(h,{...key,label:'Receipt assistant'},'preparation-only'),access)
}))

test('TEAM-003: the log pages without losing events and identity changes retain their actor',()=>run(async h=>{
 const member=await h.person('reader@example.test')
 for(let i=0;i<26;i++)await donor(h,`Community supporter ${i}`,{email:`supporter${i}@example.org`})
 const first=await h.get('/api/coffer/audit'),second=await h.get('/api/coffer/audit?page=1')
 assert.ok(first.more)
 assert.ok(second.rows.length)
 assert.ok(!second.rows.some(r=>first.rows.some(p=>p.id===r.id)))
 await h.api('/auth/operator/status',{operatorId:member.id,status:'inactive'})
 const result=await h.get('/api/coffer/audit?action=auth.operator.status')
 assert.equal(result.total,1)
 assert.equal(result.rows[0].actor_role,'owner')
}))
