import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'

test('TEAM-003: owner filters changes by person, record and action and downloads the same audit as CSV',()=>run(async h=>{
 await reviewed(h)
 const member=await h.person('entry@example.test'),as={as:member.cookie}
 const a=await donor(h,'Avery Quinn',{},as),b=await donor(h,'Robin Cole')
 await h.command('gift.record',{donorId:a.id,amountCents:30000,receivedOn:'2026-10-01',method:'check',goods:'none'},as)
 const key=await h.command('agent.create',{label:'Receipt assistant'})
 await h.command('ack.prepare',{}, {as:'',headers:{authorization:`Bearer ${key.token}`}})
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
