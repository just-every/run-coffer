import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run} from './harness.mjs'

test('the demo opens on a lived-in pantry whose waiting work a person can finish, and an invitation sends nothing',()=>run(async h=>{
 const donors=await h.get('/api/coffer/donors')
 assert.ok(donors.total>=30,'sample donors')
 assert.equal((await h.get('/api/coffer/settings')).organisation,'Copper Hollow Food Pantry')
 const letters=await h.get('/api/coffer/letters')
 assert.ok(letters.due.some(g=>g.overdue)&&letters.due.some(g=>g.goods==='unknown'),'letters due, one overdue, one needing a goods answer')
 assert.deepEqual([...new Set(letters.batches.map(b=>b.status))].sort(),['exported','prepared','sent'])
 // The seeded batch and appeals are frozen as Coffer freezes them, so their content checks pass.
 const prepared=letters.batches.find(b=>b.status==='prepared')
 assert.equal((await h.command('ack.approve',{batchId:prepared.id,version:prepared.version})).status,'approved')
 const appeals=(await h.get('/api/coffer/appeals')).appeals,waiting=appeals.find(a=>a.status==='prepared'),approved=appeals.find(a=>a.status==='approved')
 assert.equal((await h.command('appeal.approve',{appealId:waiting.id,version:waiting.version})).status,'approved')
 assert.equal((await h.command('appeal.export',{appealId:approved.id,version:approved.version})).status,'exported')
 const home=await h.request('/app');assert.equal(home.status,200)
 // Base's invitation email completes as a simulated send: the mail edge sees nothing.
 assert.deepEqual(await h.api('/auth/invite',{email:'sam.ortiz@copperhollowpantry.example',role:'member',displayName:'Sam Ortiz',returnTo:'/app'},{status:202}),{status:'accepted'})
 assert.equal(h.messages.length,0)
},{entry:'tests/demo-worker.ts',bindings:{RER_DEMO:'1'}}))
