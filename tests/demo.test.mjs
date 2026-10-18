import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run} from './harness.mjs'

test('the demo opens on a lived-in pantry whose waiting work a person can finish, and an invitation sends nothing',()=>run(async h=>{
 const donors=await h.get('/api/coffer/donors')
 assert.ok(donors.total>=30,'sample donors')
 assert.equal((await h.get('/api/coffer/settings')).organisation,'Copper Hollow Food Pantry')
 const letters=await h.get('/api/coffer/letters')
 assert.ok(letters.due.some(g=>g.overdue)&&letters.due.some(g=>g.goods==='unknown'),'letters due, one overdue, one needing a goods answer')
 // Batches at every person's stage, and the campaign page's automatic receipts (approved by the online-receipts setting).
 assert.deepEqual([...new Set(letters.batches.map(b=>b.status))].sort(),['approved','exported','prepared','sent'])
 assert.ok(letters.batches.filter(b=>b.status==='approved').every(b=>b.prepared_by_role==='system'),'only automatic receipts start approved')
 // The seeded batch and appeals are frozen as Coffer freezes them, so their content checks pass.
 const prepared=letters.batches.find(b=>b.status==='prepared')
 assert.equal((await h.command('ack.approve',{batchId:prepared.id,version:prepared.version})).status,'approved')
 const appeals=(await h.get('/api/coffer/appeals')).appeals,waiting=appeals.find(a=>a.status==='prepared'),approved=appeals.find(a=>a.status==='approved')
 assert.equal((await h.command('appeal.approve',{appealId:waiting.id,version:waiting.version})).status,'approved')
 assert.equal((await h.command('appeal.export',{appealId:approved.id,version:approved.version})).status,'exported')
 const home=await h.request('/app');assert.equal(home.status,200)
 // Gifts: the campaign's progress and the monthly card Stripe declined and cleared on retry, in the selected donor's panel.
 const gifts=await (await h.request('/app/gifts')).text()
 assert.match(gifts,/Holiday Meals \d{4}<\/h2>/)
 assert.match(gifts,/class="is-selected"[^]*Terrence Jackson[^]*Card failed · retried/)
 assert.match(gifts,/Card declined[^]*Retry cleared/)
 // The development agent's saved thank-you waits for review, through drafting's own store.
 assert.match(gifts,/class="cf-agent"[^]*I wrote a thank-you[^]*Review and send/)
 assert.equal((await h.get('/api/coffer/agent/stewardship')).drafts.filter(d=>d.status==='draft').length,1)
 // Base's invitation email completes as a simulated send: the mail edge sees nothing.
 assert.deepEqual(await h.api('/auth/invite',{email:'sam.ortiz@copperhollowpantry.example',role:'member',displayName:'Sam Ortiz',returnTo:'/app'},{status:202}),{status:'accepted'})
 assert.equal(h.messages.length,0)
},{entry:'tests/demo-worker.ts',bindings:{RER_DEMO:'1'}}))
