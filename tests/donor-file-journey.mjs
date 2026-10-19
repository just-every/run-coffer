import assert from 'node:assert/strict'
import { run, donor } from './harness.mjs'

// The prospect-research edge is the only fake: WealthEngine's documented summary shape.
const outbound = async request => {
 const url = new URL(request.url), body = await request.json()
 assert.equal(url.origin, 'https://api.wealthengine.com')
 if (url.pathname === '/v1/session/create') return Response.json({ _id: 'temporary-provider-session' }, { status: 201 })
 return Response.json({ id: body.first_name === 'Ada' ? 4242 : 4343, client_id: body.client_id, identity: { first_name: body.first_name, last_name: body.last_name }, locations: [{ address: { city: 'Springfield' } }],
  wealth: { wealth_score: { text: 'Excellent', value: 92 }, networth: { text: '$5MM-$10MM' } },
  giving: { gift_capacity: { text: '$100K-$200K', text_low: '$100K', text_high: '$200K', value: 15, min: 1, max: 20 }, p2g_score: { text: '1|2 - Excellent', value: '12' }, estimated_annual_donations: { text: '$10K-$25K' } } })
}

export async function donorFileJourney() {
 await run(async h => {
  // Request and activity dates are organization-calendar days.
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: (await h.get('/api/coffer/settings')).timezone }).format(new Date())
  const ada = await donor(h, 'Ada Quill'), ben = await donor(h, 'Ben Other'), cara = await donor(h, 'Cara Quill'), dan = await donor(h, 'Dan Gone')
  const member = await h.person('file-member@example.test'), admin = await h.person('file-admin@example.test', 'admin'), owner = (await h.get('/auth/session')).operator
  const agent = await h.command('agent.create', { label: 'No donor files' })
  const gift = await h.command('gift.record', { donorId: ada.id, amount: '125', receivedOn: '2026-02-10', method: 'check', fund: 'Reading', goods: 'none', note: 'Ada gift note' })
  const benGift = await h.command('gift.record', { donorId: ben.id, amount: '300', receivedOn: '2026-02-11', method: 'cash', fund: 'Reading', goods: 'none', note: 'Ben private note' })
  await h.command('gift.record', { donorId: cara.id, amount: '40', receivedOn: '2026-01-05', method: 'cash', fund: 'Reading', goods: 'none' })
  await h.command('consent.record', { donorIds: [ada.id], channel: 'email', status: 'granted', method: 'paper form', evidence: 'Signed card at the fair', capturedOn: '2026-01-02' })
  await h.command('interaction.record', { donorId: ada.id, kind: 'meeting', occurredOn: day, who: 'Ada and Morgan', notes: 'Talked about the reading room.' })
  await h.command('interaction.record', { donorId: ada.id, kind: 'note', occurredOn: day, notes: 'Prefers morning calls' })
  await h.command('interaction.record', { donorId: ada.id, kind: 'note', occurredOn: day, notes: 'Confidential: estate plans', confidential: true })
  await h.command('interaction.record', { donorId: cara.id, kind: 'note', occurredOn: day, notes: 'Confidential: merged-record board seat', confidential: true })
  await h.command('relationship.create', { donorId: ada.id, relatedDonorId: ben.id, type: 'spouse' })
  await h.command('softCredit.record', { giftId: benGift.id, donorId: ada.id, amount: '50' })
  await h.command('softCredit.record', { giftId: gift.id, donorId: ben.id, amount: '25' })
  await h.command('match.record', { giftId: gift.id, employerDonorId: ben.id, amount: '125', dueBy: '2026-12-31' })
  await h.command('tribute.record', { giftId: gift.id, kind: 'honor', honoree: 'Grandma Quill', notifiedName: 'Noel Third', notifiedEmail: 'noel.third@example.org' })
  await h.command('pledge.create', { donorId: ada.id, amount: '90', pledgedOn: day, fund: 'Reading', installments: [{ dueOn: '2026-12-01', amount: '90' }] })
  const prospect = await h.command('prospect.save', { donorId: ada.id, ownerId: owner.id, stage: 'cultivate', askAmount: '500', expectedCloseOn: '2026-12-01', nextStep: 'Share the plan.' })
  const prospectId = prospect.prospectId ?? prospect.id, proposal = await h.command('proposal.save', { prospectId, title: 'Reading room', body: 'Proposal body for Ada.' })
  const documentText = 'Ada reading room proposal document'
  await h.command('proposal.attach', { prospectId, proposalId: proposal.id, version: proposal.version ?? 1, fileName: 'room.txt', mediaType: 'text/plain', contentBase64: Buffer.from(documentText).toString('base64') })
  const grant = await h.command('grant.save', { donorId: ada.id, program: 'Quill family grant', requestedAmount: '1500', loiDueOn: '2026-09-01', proposalDueOn: '2026-10-01', reportDueOn: '2026-10-15' })
  await h.command('grant.attach', { grantId: grant.id, version: grant.version, title: 'Grant letter', fileName: 'grant.txt', mediaType: 'text/plain', contentBase64: Buffer.from('Grant letter text').toString('base64') })
  await h.command('volunteer.record', { donorId: ada.id, role: 'Tutor', occurredOn: day, hours: '2' })
  await h.command('inKind.save', { donorId: ada.id, description: 'Donated laptop', quantity: '1', statedValue: '600', receivedOn: '2026-03-12', goods: 'none', fund: 'Reading' })
  await h.command('research.connect', { provider: 'wealthengine', apiKey: 'test-wealthengine-edge-only' })
  await h.command('research.screen', { donorIds: [ada.id, ben.id] })
  const comparison = await h.get(`/api/coffer/duplicates/compare?source=${cara.id}&target=${ada.id}`)
  await h.command('donor.merge', { sourceDonorId: cara.id, donorId: ada.id, sourceVersion: comparison.source.version, version: comparison.target.version, reason: 'duplicate_record' })
  await h.command('donor.erase', { donorId: dan.id, confirm: 'ERASE' })

  const path = id => `/api/coffer/donors/${id}/data-request`, request = { requestedOn: day, method: 'email', reference: 'TICKET-1042' }
  // Only the owner and admins produce a file; members, agents and anonymous callers are refused.
  await h.api(path(ada.id), request, { as: '', status: 401 })
  assert.equal((await h.api(path(ada.id), request, { as: member.cookie, status: 403 })).error, 'manager_required')
  await h.api(path(ada.id), request, { as: '', headers: { authorization: 'Bearer ' + agent.token }, status: 403 })
  assert.equal((await h.api(path(cara.id), request, { status: 409 })).error, 'DONOR_MERGED')
  assert.equal((await h.api(path(dan.id), request, { status: 404 })).error, 'NOT_FOUND')
  assert.equal((await h.api(path(ada.id), { ...request, reference: 'Ada asked by phone' }, { status: 400 })).error, 'INPUT')
  assert.equal((await h.api(path(ada.id), { ...request, requestedOn: '2999-01-01' }, { status: 400 })).error, 'INPUT')
  assert.equal((await h.api(path(ada.id), { ...request, method: 'carrier pigeon' }, { status: 400 })).error, 'INPUT')

  const mailBefore = h.messages.length
  const response = await h.request(path(ada.id), { method: 'POST', as: admin.cookie, body: request })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="coffer-donor-file-\d{4}-\d{2}-\d{2}\.json"$/)
  const text = await response.text(), file = JSON.parse(text), r = file.records
  assert.equal(h.messages.length, mailBefore, 'the file is never sent by Coffer')
  assert.match(file.delivery, /has not sent/)
  assert.equal(file.donorId, ada.id); assert.deepEqual(file.mergedRecordIds, [cara.id])
  // Every record type held about Ada, including the merged-in record.
  for (const kind of ['donors', 'gifts', 'consents', 'interactions', 'donor_notes', 'relationships', 'soft_credits', 'employer_matches', 'gift_tributes', 'pledges', 'pledge_installments', 'prospects', 'proposals', 'grants', 'grant_documents', 'volunteering', 'in_kind_gifts', 'research_results', 'events', 'donor_merges', 'donor_merge_journal', 'donor_merge_rows', 'donor_aliases'])
   assert.ok(r[kind]?.length, `file holds ${kind}`)
  assert.deepEqual(r.donors.map(d => d.name).sort(), ['Ada Quill', 'Cara Quill'])
  assert.deepEqual(r.gifts.map(g => g.amount_cents).sort((a, b) => a - b), [4000, 12500])
  assert.equal(r.gifts.find(g => g.id === gift.id).note, 'Ada gift note')
  assert.equal(r.consents[0].evidence, 'Signed card at the fair')
  // Confidential staff notes are owner/admin only: withheld from the donor's own file, with their count stated.
  assert.deepEqual(r.donor_notes.map(n => [n.body, n.confidential]), [['Prefers morning calls', 0]])
  for (const secret of ['Confidential: estate plans', 'Confidential: merged-record board seat']) assert.ok(!text.includes(secret), 'confidential staff notes are withheld')
  assert.deepEqual(file.withheld, { confidentialStaffNotes: 2, statement: '2 confidential staff notes withheld' })
  assert.ok(r.events.filter(e => e.action === 'interaction.record' && e.subject_kind === 'note').every(e => !/^counterpart-/.test(e.subject_id)), 'a withheld note is not shown as another person')
  assert.equal(Buffer.from(r.proposals[0].content_base64, 'base64').toString(), documentText)
  assert.equal(Buffer.from(r.grant_documents[0].content_base64, 'base64').toString(), 'Grant letter text')
  assert.ok(r.research_results.every(x => x.donor_id === ada.id && x.provider === 'wealthengine'))
  assert.match(file.labels.donor_notes, /Confidential staff notes are withheld/)
  assert.match(file.labels.research_results, /WealthEngine estimates.*never verified/)
  assert.deepEqual(file.notIncluded.map(x => x.record), ['donor_tokens', 'erased_stripe_customers'])
  // Nobody else: Ben appears only as one opaque counterpart, never by id, name, email, gift or note.
  for (const secret of [ben.id, 'Ben Other', 'ben.other@example.org', benGift.id, 'Ben private note', 'Noel Third', 'noel.third@example.org', dan.id, 'Dan Gone'])
   assert.ok(!text.includes(secret), `file leaks ${secret}`)
  const relation = r.relationships[0], counterpart = relation.donor_id === ada.id ? relation.related_donor_id : relation.donor_id
  assert.ok([relation.donor_id, relation.related_donor_id].includes(ada.id))
  assert.match(counterpart, /^counterpart-\d+$/)
  assert.equal(r.soft_credits.find(s => s.donor_id === ada.id).gift_id.startsWith('counterpart-'), true, 'the other donor’s gift is opaque')
  assert.equal(r.soft_credits.find(s => s.gift_id === gift.id).donor_id, counterpart, 'the same person keeps the same label')
  assert.equal(r.employer_matches[0].employer_donor_id, counterpart)
  assert.ok(r.events.some(e => e.action === 'softCredit.record' && /^counterpart-\d+$/.test(e.detail.giftId)), 'audit rows name the other donor’s gift by label')
  assert.equal(r.gift_tributes[0].honoree, 'Grandma Quill'); assert.equal(r.gift_tributes[0].notified_email, '[third party withheld]')
  // Read-only cross-check against the store: every table naming Ada or her merged record is in the file, row for row.
  const db = await h.mf.getD1Database('DB'), subject = JSON.stringify([ada.id, cara.id])
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'cf_*'").all()).results.map(t => t.name)
  let checked = 0
  for (const table of tables) {
   if (table === 'cf_donor_tokens') continue
   const columns = (await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(c => c.name).filter(c => c === 'donor_id' || c.endsWith('_donor_id'))
   if (!columns.length) continue
   // The request's own log row is written once the file is built.
   // Confidential staff notes are the one held row kind withheld by rule.
   const held = (await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE (${columns.map(c => `${c} IN (SELECT value FROM json_each(?1))`).join(' OR ')})${table === 'cf_donor_notes' ? ' AND confidential=0' : ''}`).bind(subject).first()).n - (table === 'cf_events' ? 1 : 0)
   if (held) { checked++; assert.ok((r[table.slice(3)]?.length ?? 0) >= held, `${table}: ${held} rows held, file has ${r[table.slice(3)]?.length ?? 0}`) }
  }
  assert.ok(checked >= 15)

  // The logged request: identifiers, date, method, reference and counts, no personal text.
  const audit = await h.get(`/api/coffer/audit?record=${ada.id}&action=donor.dataRequest`)
  assert.equal(audit.total, 1)
  const logged = audit.rows[0], detail = JSON.parse(logged.detail)
  assert.equal(logged.actor_id, admin.id); assert.equal(logged.actor_role, 'admin'); assert.equal(logged.subject_id, ada.id)
  assert.deepEqual({ fileId: detail.fileId, requestedOn: detail.requestedOn, method: detail.method, reference: detail.reference }, { fileId: file.fileId, requestedOn: day, method: 'email', reference: 'TICKET-1042' })
  assert.equal(detail.records.gifts, 2); assert.equal(detail.confidentialNotesWithheld, 2)
  assert.ok(!logged.detail.includes('Ada') && !logged.detail.includes('@'), 'no personal text in the audit row')
  await h.get(`/api/coffer/audit?record=${ada.id}&action=donor.dataRequest`, { as: member.cookie, status: 403 })

  // The donor page's native form downloads the same file for the owner.
  const page = await (await h.request(`/app/donors/${ada.id}`)).text()
  assert.match(page, new RegExp(`action="/app/donors/${ada.id}/data-request"`))
  assert.ok(!(await (await h.request(`/app/donors/${ada.id}`, { as: member.cookie })).text()).includes('data-request'), 'members do not see the form')
  const native = await h.request(`/app/donors/${ada.id}/data-request`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: new URLSearchParams({ requestedOn: day, method: 'letter', reference: '' }).toString() })
  assert.equal(native.status, 200); assert.equal(JSON.parse(await native.text()).request.method, 'letter')
  assert.equal((await h.get(`/api/coffer/audit?record=${ada.id}&action=donor.dataRequest`)).total, 2)

  // Alongside erasure: once Ada is erased, no file can be produced; the request log keeps no personal text.
  const erased = await h.command('donor.erase', { donorId: ada.id, confirm: 'ERASE' })
  assert.equal((await h.api(path(ada.id), request, { status: 404 })).error, 'NOT_FOUND')
  assert.equal((await h.api(path(erased.donorId), request, { status: 409 })).error, 'DONOR_ERASED')
 }, { outbound })
}
