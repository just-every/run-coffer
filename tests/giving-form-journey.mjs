import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {run, reviewed, archive, restore} from './harness.mjs'
import {givingFormEdge} from './giving-form-edge.mjs'
import {givingFormBrowser} from './giving-form-browser.mjs'

const mailbox = value => ['synthetic-coffer-' + value, 'example.test'].join('@')
const editable = config => ({...config, questions: config.questions.map(({key, label, required}) => ({key, label, required}))})
const post = values => ({method: 'POST', as: '', headers: {'content-type': 'application/x-www-form-urlencoded'}, raw: new URLSearchParams(values).toString()})

export async function givingFormJourney() {
 const edge = givingFormEdge(), webhookSecret='synthetic-coffer-7002'
 await run(async h => {
  await reviewed(h)
  await h.command('fund.define', {name: 'Tutoring', restriction: 'purpose', detail: 'Neighborhood tutoring'})
  const definitions = [
   {key: 'reading_interests', label: 'Reading interests', kind: 'constituent', type: 'text', entry: 'pick-many', choices: ['Books', 'Tutoring']},
   {key: 'books', label: 'Books to sponsor', kind: 'gift', type: 'number'},
   {key: 'visit_date', label: 'Visit date', kind: 'gift', type: 'date'},
   {key: 'match_ok', label: 'Employer match available', kind: 'constituent', type: 'checkbox'},
   {key: 'class_year', label: 'Class year', kind: 'constituent', type: 'year'},
   {key: 'budget', label: 'Budget', kind: 'gift', type: 'currency'},
   {key: 'sponsor_amount', label: 'Sponsor amount', kind: 'gift', type: 'currency', entry: 'pick-one', choices: ['25.00', '125.75']},
   {key: 'match_amounts', label: 'Match amounts', kind: 'constituent', type: 'currency', entry: 'pick-many', choices: ['5.00', '10.50']},
  ]
  for (const d of definitions) await h.command('custom.define', d)
  const campaign = await h.api('/api/coffer/giving/campaigns', {name: 'Reading room appeal', slug: 'reading-room', description: 'Keep the reading room open.', fund: 'Reading', goal: '5000', imageBase64: (await readFile('tests/fixtures/campaign-page/story.png')).toString('base64'), imageType: 'image/png', imageDescription: 'Riverbend reading room mark', publicMedia: true, feeCoverEnabled: 'yes', feeCoverRateBps: 290, feeCoverFixedCents: 30})
  const path = '/api/coffer/giving/campaigns/' + campaign.id + '/form'
  const responses = () => h.get('/api/coffer/giving/campaigns/' + campaign.id + '/responses')
  const member = await h.person(mailbox('member'))
  const baseline = await h.get(path)
  await h.get(path, {as: '', status: 401})
  await h.get(path, {as: member.cookie, status: 403})
  await h.api(path, {...baseline, headline: 'Unauthorized change'}, {as: member.cookie, status: 403})
  await h.api(path, {...baseline, headline: 'Wrong origin'}, {headers: {origin: 'https://unrelated.example'}, status: 403})
  await h.api(path, {...baseline, primaryColor: '#ffffff'}, {status: 400})
  assert.deepEqual(await h.get(path), baseline)
  const browserResults = await givingFormBrowser(h, campaign, edge, '.cache/giving-forms',async(session,width)=>{
   if(width===1440)await edge.paidBeforeReturn(h,session,webhookSecret)
   else await h.api('/api/coffer/payments/sync',{payoutId:'po_form'})
   const captured=(await responses()).responses.find(r=>r.name==='Riverbend Reader '+width)
   assert.ok(captured,'Both signed charge delivery and operator sync retain the form response before any browser return')
   assert.equal(captured.fund,'Tutoring')
   assert.equal(captured.employer,'Riverbend Library')
   assert.equal(captured.answers.length,8)
  })
  let saved = await h.get(path)
  assert.equal(saved.questions.length, 8)
  await h.api(path, {...editable(saved), version: saved.version - 1}, {status: 409})
  assert.equal((await h.get(path)).version, saved.version)
  const {responses: paid} = await responses()
  assert.equal(paid.length, 2)
  for (const result of browserResults) {
   const contact = (await h.get('/api/coffer/donors')).donors.find(d => d.email === result.mailbox)
   assert.ok(contact)
   const history = await h.get('/api/coffer/donors/' + contact.id), capture = paid.find(p => p.donor_id === contact.id)
   assert.equal(history.gifts.length, 1)
   const gift = history.gifts[0], expected = result.width === 1440 ? 5000 : 5181
   assert.equal(gift.amount_cents, expected)
   assert.equal(gift.fund, 'Tutoring')
   assert.equal(gift.source, 'stripe')
   assert.equal(capture.gift_id, gift.id)
   assert.equal(capture.employer, 'Riverbend Library')
   assert.equal(capture.comment, 'For the Saturday reading circle ' + result.width)
   assert.deepEqual(Object.fromEntries(capture.answers.map(a => [a.key, a.value])), {reading_interests: ['Books', 'Tutoring'], books: '3', visit_date: '2026-11-20', match_ok: 'false', class_year: '2024', budget: '12575', sponsor_amount: '12575', match_amounts: ['500', '1050']})
   assert.equal(history.customValues.length, 8)
   assert.equal(history.customValues.find(v => v.field_key === 'budget').value, '"12575"')
   assert.equal(history.customValues.find(v => v.field_key === 'sponsor_amount').value, '"12575"')
   assert.equal(history.customValues.find(v => v.field_key === 'match_amounts').value, '["500","1050"]')
   assert.equal(history.customValues.find(v => v.field_key === 'books').record_id, gift.id)
   assert.equal(history.customValues.find(v => v.field_key === 'reading_interests').record_id, contact.id)
   assert.deepEqual(history.consents.map(c => c.status), result.width === 1440 ? ['granted'] : [])
   const receipt = await h.get('/api/coffer/letters/' + history.letters[0].batch_id)
   assert.equal(receipt.letters[0].amount_cents, expected)
   assert.ok(receipt.letters[0].body.includes(result.width === 1440 ? '$50.00' : '$51.81'))
   assert.ok(receipt.letters[0].template_kind)
   assert.ok(h.messages.some(m => JSON.stringify(m.to).includes(result.mailbox) && m.text.includes(result.width === 1440 ? '$50.00' : '$51.81')))
   const replay = await h.request('/give/reading-room/checkout', post(result.values))
   assert.equal(replay.status, 303, await replay.text())
   const changed = new URLSearchParams(result.values); changed.set('comment', 'A changed answer')
   assert.equal((await h.request('/give/reading-room/checkout', post(changed))).status, 409)
   assert.equal((await h.request('/giving/thanks?session_id=' + result.session.id, {as: ''})).status, 200)
   assert.equal((await responses()).responses.length, 2)
   assert.equal((await h.get('/api/coffer/donors/' + contact.id)).gifts.length, 1)
   assert.equal(h.messages.filter(m => JSON.stringify(m.to).includes(result.mailbox) && m.text.includes(result.width === 1440 ? '$50.00' : '$51.81')).length, 1)
   result.donorId = contact.id
  }
  assert.equal(edge.sessions.size, 2)
  const admin = await h.person(mailbox('admin'), 'admin')
  const authorized = await h.api(path, editable(saved), {as: admin.cookie})
  assert.equal(authorized.version, saved.version + 1)
  const revoke = await h.request('/auth/session/revoke', {method: 'POST', body: {sessionId: admin.session.id}})
  assert.equal(revoke.status, 204, await revoke.text())
  await h.api(path, editable(authorized), {as: admin.cookie, status: 401})
  await h.get('/api/coffer/giving/campaigns/' + campaign.id + '/responses', {as: admin.cookie, status: 401})
  saved = await h.get(path)
  assert.equal(saved.version, authorized.version)
  const valid = new URLSearchParams(browserResults[0].values)
  valid.set('requestId', randomUUID())
  valid.delete('answer.reading_interests')
  const beforeInvalid = edge.sessions.size
  const invalids = [valid, new URLSearchParams(browserResults[0].values), new URLSearchParams(browserResults[0].values), new URLSearchParams(browserResults[0].values)]
  invalids[1].set('answer.books', 'not a number')
  invalids[2].set('answer.reading_interests', 'Unpublished choice')
  invalids[3].set('designation', 'Unapproved fund')
  for (const [i, values] of invalids.entries()) {
   values.set('requestId', randomUUID()); values.set('formVersion', saved.version)
   const response = await h.request('/give/reading-room/checkout', {...post(values), headers: {'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '192.0.2.' + (20 + i)}})
   assert.equal(response.status, 400, await response.text())
  }
  assert.equal(edge.sessions.size, beforeInvalid, 'Invalid typed answers never reach payment submission')
  await h.get('/api/coffer/giving/campaigns/' + campaign.id + '/responses', {as: member.cookie, status: 403})
  await h.get('/api/coffer/giving/campaigns/' + campaign.id + '/responses', {as: '', status: 401})
  await h.api('/api/coffer/payments/sync', {payoutId: 'po_form'})
  const fees = await h.get('/api/coffer/payments/fees?payoutId=po_form')
  assert.deepEqual(fees.totals, {gross_cents: 10181, fee_cents: 358, net_cents: 9823})
  for (const group of [fees.byForm, fees.byCampaign]) assert.deepEqual(group.map(r => [r.id, r.gross_cents]), [[campaign.id, 10181]])
  assert.deepEqual(fees.byFund.map(r => [r.id, r.gross_cents]), [['Tutoring', 10181]])
  assert.equal((await h.get('/api/coffer/giving/campaigns/' + campaign.id)).raisedCents, 10181)
  const attribution = await h.get('/api/coffer/reports/attribution')
  assert.equal(attribution.channel.find(r => r.key === 'form').amountCents, 10181)
  assert.equal(attribution.campaign.find(r => r.key === campaign.id).amountCents, 10181)
  const backup = await archive(h)
  await run(async restored => {
   await restore(restored, backup)
   assert.deepEqual(await restored.get(path), saved)
   const restoredResponses = await restored.get('/api/coffer/giving/campaigns/' + campaign.id + '/responses')
   assert.deepEqual(restoredResponses.responses, (await responses()).responses)
  })
  const first = browserResults[0]
  await h.command('custom.set', {key: 'reading_interests', recordId: first.donorId, version: 1, value: ['Books'], source: 'Reviewed staff choice'})
  const anotherGift = new URLSearchParams(first.values)
  anotherGift.set('requestId', randomUUID()); anotherGift.set('formVersion', saved.version)
  anotherGift.set('answer.reading_interests', 'Tutoring'); anotherGift.set('comment', 'A second paid response')
  const laterCheckout = await h.request('/give/reading-room/checkout', {...post(anotherGift), headers: {'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '192.0.2.43'}})
  assert.equal(laterCheckout.status, 303, await laterCheckout.text())
  const laterSession = [...edge.sessions.values()].at(-1)
  const laterThanks = await h.request('/giving/thanks?session_id=' + laterSession.id, {as: ''})
  assert.equal(laterThanks.status, 200, await laterThanks.text())
  assert.equal((await responses()).responses.length, 3)
  assert.deepEqual((await responses()).responses.find(r => r.comment === 'A second paid response').answers.find(a => a.key === 'reading_interests').value, ['Tutoring'])
  await h.request('/giving/thanks?session_id=' + first.session.id, {as: ''})
  assert.equal((await h.get('/api/coffer/donors/' + first.donorId)).customValues.find(v => v.field_key === 'reading_interests').value, '["Books"]')
  await h.command('donor.erase', {donorId: first.donorId, confirm: 'ERASE'})
  assert.equal((await responses()).responses.length, 1)
  const replayAfterErasure = await h.request('/give/reading-room/checkout', {...post(first.values), headers: {'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '192.0.2.44'}})
  assert.equal(replayAfterErasure.status, 409, await replayAfterErasure.text())
  await h.request('/giving/thanks?session_id=' + first.session.id, {as: ''})
  const erasedArchive = JSON.stringify(await archive(h))
  assert.ok(!erasedArchive.includes('For the Saturday reading circle 1440'))
  assert.equal((await h.get('/api/coffer/giving/campaigns/' + campaign.id)).raisedCents, 15181)
  assert.equal((await responses()).responses.length, 1)
  assert.equal(edge.sessions.size, 3)
  // An abandoned checkout has no paid donor link. Correcting its mailbox must
  // not hide the private capture from the donor's ordinary erasure operation.
  const abandonedEmail = mailbox('abandoned'), correctedEmail = mailbox('corrected')
  const abandoned = await h.command('donor.create', {name: 'Synthetic abandoned donor', email: abandonedEmail})
  const pending = new URLSearchParams(browserResults[1].values)
  pending.set('requestId', randomUUID()); pending.set('formVersion', saved.version)
  pending.set('name', 'Synthetic abandoned donor'); pending.set('email', abandonedEmail)
  pending.set('comment', 'Synthetic abandoned private form comment')
  const pendingPost = () => ({...post(pending), headers: {'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '192.0.2.45'}})
  const abandonedCheckout = await h.request('/give/reading-room/checkout', pendingPost())
  assert.equal(abandonedCheckout.status, 303, await abandonedCheckout.text())
  const pendingSession = [...edge.sessions.values()].at(-1)
  assert.equal((await h.get('/api/coffer/donors/' + abandoned.id)).gifts.length, 0)
  assert.ok(JSON.stringify(await archive(h)).includes(pending.get('comment')), 'The pending capture is held before erasure')
  await h.command('donor.update', {donorId: abandoned.id, version: abandoned.version, name: 'Synthetic abandoned donor', email: correctedEmail})
  await h.command('donor.erase', {donorId: abandoned.id, confirm: 'ERASE'})
  const erasedPendingReplay = await h.request('/give/reading-room/checkout', pendingPost())
  assert.equal(erasedPendingReplay.status, 409, await erasedPendingReplay.text())
  await h.request('/giving/thanks?session_id=' + pendingSession.id, {as: ''})
  assert.ok(!JSON.stringify(await archive(h)).includes(pending.get('comment')), 'Erasure removes a capture tied to a corrected historical mailbox, and a payment return cannot restore it')
  assert.equal((await h.get('/api/coffer/donors')).donors.some(d => [abandonedEmail, correctedEmail].includes(d.email)), false)
  assert.equal((await h.get('/api/coffer/giving/campaigns/' + campaign.id)).raisedCents, 15181)
  assert.equal((await responses()).responses.length, 1)
  assert.equal(edge.sessions.size, 4)
 }, {bindings: {STRIPE_SECRET_KEY: 'synthetic-coffer-7001',STRIPE_WEBHOOK_SECRET:webhookSecret}, outbound: edge.outbound})
}
