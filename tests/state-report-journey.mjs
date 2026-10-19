import assert from 'node:assert/strict'
import { run, donor, archive, restore, csvRows, reviewed, settings as letterSettings } from './harness.mjs'
import { recognitionEdges, giveRecognition } from './recognition-edge.mjs'

export async function stateReportJourney() {
 const edge = recognitionEdges()
 await run(async h => {
  await reviewed(h)
  const place = (region, extra = {}) => ({ region, city: 'Springfield', postalCode: '00000', ...extra })
  const ada = await donor(h, 'Ada State', place('IL')), ben = await donor(h, 'Ben State', place('Wisconsin')), cara = await donor(h, 'Cara State', place('ca'))
  const nora = await donor(h, 'Nora Noaddress', { addressLine1: '', city: '', region: '', postalCode: '' }), eve = await donor(h, 'Eve Abroad', place('ON', { country: 'Canada' }))
  const moe = await donor(h, 'Moe Mover', place('IL')), org = await donor(h, 'Lakeside Foundation', place('MN'))
  const spring = await h.api('/api/coffer/giving/campaigns', { name: 'Spring books', slug: 'spring-books', description: 'Books for spring.', fund: 'Reading', goal: '1000' })
  const autumn = await h.api('/api/coffer/giving/campaigns', { name: 'Autumn reading', slug: 'autumn-reading', description: 'Keep reading.', fund: 'Reading', goal: '1000' })
  const gift = (d, amount, receivedOn, extra = {}) => h.command('gift.record', { donorId: d.id, amount, receivedOn, method: 'check', fund: 'Reading', goods: 'none', ...extra })
  await gift(ada, '100', '2026-03-01'); await gift(ada, '999', '2025-12-31')
  await gift(ben, '200', '2026-04-01', { method: 'cash', fund: 'Library' })
  const cara1 = await gift(cara, '50', '2026-02-01'); await gift(cara, '25', '2026-05-01')
  await gift(nora, '30', '2026-02-02'); await gift(eve, '40', '2026-02-03'); await gift(org, '500', '2026-02-04')
  const moeMarch = await gift(moe, '70', '2026-03-15')
  // A split offline gift attributed to two campaigns, none through a giving form.
  await h.command('gift.record', { donorId: ben.id, amount: '100', receivedOn: '2026-04-02', method: 'check', goods: 'none', allocations: [{ amount: '60', fund: 'Reading', campaignId: spring.id }, { amount: '40', fund: 'Reading', campaignId: autumn.id }] })

  // REPORT-008: a move records the earlier address with its exact effective day.
  const move = (version, region, addressEffectiveOn, options) => h.command('donor.update', { donorId: moe.id, version, name: 'Moe Mover', email: 'moe.mover@example.org', addressLine1: '1 Main Street', city: 'Albany', region, postalCode: '12207', country: 'United States', addressEffectiveOn }, options)
  assert.equal((await move(1, 'NY', '2999-01-01', { status: 400 })).error, 'INPUT')
  await move(1, 'NY', '2026-06-01')
  assert.equal((await move(2, 'NJ', '2026-05-01', { status: 409 })).error, 'ADDRESS_ORDER', 'a move cannot predate the last recorded move')
  await gift(moe, '10', '2026-06-01'); await gift(moe, '80', '2026-07-01')
  await h.command('gift.reverse', { giftId: moeMarch.id, reason: 'Check returned unpaid' })
  await h.command('gift.reverse', { giftId: cara1.id, reason: 'Check returned unpaid' })
  // An online gift through the autumn giving form.
  await giveRecognition(h, { name: 'Ada State', email: 'ada.state@example.org', amount: '20.00' })

  const report = (query = '') => h.get('/api/coffer/reports/states?year=2026' + query)
  const r = await report(), row = label => r.rows.find(x => x.label === label || x.state === label)
  assert.deepEqual(r.rows.map(x => x.state ?? x.label), ['CA', 'IL', 'MN', 'NY', 'WI', 'Outside the United States', 'Unknown address'])
  // Moe's March gift and its later reversal stay in Illinois; the move day and later count in New York.
  assert.deepEqual(row('IL'), { state: 'IL', label: 'Illinois', donors: 2, gifts: 3, amountCents: 10000 + 2000 })
  assert.deepEqual(row('NY'), { state: 'NY', label: 'New York', donors: 1, gifts: 2, amountCents: 9000 })
  assert.deepEqual(row('CA'), { state: 'CA', label: 'California', donors: 1, gifts: 2, amountCents: 2500 })
  assert.deepEqual(row('WI'), { state: 'WI', label: 'Wisconsin', donors: 1, gifts: 2, amountCents: 30000 })
  assert.equal(row('MN').amountCents, 50000, 'an organization counts by its own address')
  assert.deepEqual([row('Outside the United States').amountCents, row('Unknown address').amountCents], [4000, 3000])
  // Rows sum to the ledger: the fund report for the same period agrees to the cent.
  const ledger = (await h.get('/api/coffer/reports/funds?from=2026-01-01&through=2026-12-31')).funds.reduce((s, f) => s + Number(f.amount_cents), 0)
  assert.equal(r.totalCents, ledger); assert.equal(r.rows.reduce((s, x) => s + x.amountCents, 0), ledger)
  assert.equal(r.start, '2026-01-01')

  // Filters: fund, channel, campaign (attribution) and giving form (online gifts through that page).
  assert.deepEqual((await report('&fund=Library')).rows.map(x => [x.state, x.amountCents]), [['WI', 20000]])
  assert.deepEqual((await report('&channel=cash')).rows.map(x => [x.state, x.amountCents]), [['WI', 20000]])
  assert.deepEqual((await report('&campaignId=' + spring.id)).rows.map(x => [x.state, x.amountCents]), [['WI', 6000]])
  assert.deepEqual((await report('&campaignId=' + autumn.id)).rows.map(x => [x.state, x.amountCents]), [['IL', 2000], ['WI', 4000]])
  assert.deepEqual((await report('&formId=' + autumn.id)).rows.map(x => [x.state, x.amountCents]), [['IL', 2000]])
  assert.equal((await h.get('/api/coffer/reports/states?year=2026&channel=pigeon', { status: 400 })).error, 'INPUT')
  // A fiscal year starting 1 July moves the window.
  const current = await h.get('/api/coffer/settings')
  await h.command('settings.update', { ...letterSettings, fiscalYearStart: '07-01', version: current.version })
  const fiscal = await h.get('/api/coffer/reports/states?year=2025&basis=fiscal')
  // FY2025 runs 1 July 2025 through 30 June 2026: Ada's December gift and every first-half 2026 entry, not the later reversals.
  assert.deepEqual([fiscal.start, fiscal.through, fiscal.totalCents], ['2025-07-01', '2026-06-30', 99900 + 112500])

  // CSV for registrations and renewals.
  const csv = await h.request('/api/coffer/reports/states.csv?year=2026')
  assert.match(csv.headers.get('content-disposition'), /coffer-giving-by-state\.csv/)
  const lines = csvRows(await csv.text())
  assert.equal(lines[0], '"State","State name","Donors","Gifts","Amount USD"')
  assert.ok(lines.includes('"NY","New York","1","2","90.00"'))
  assert.equal(lines.at(-1), `"","Total (ledger)","","","${(ledger / 100).toFixed(2)}"`)
  assert.match(await (await h.request('/app/reports/states?year=2026')).text(), /Giving by state[\s\S]*New York/)

  // Custody: history survives backup/restore and merge/undo exactly; erasure removes it.
  const before = (await report()).rows
  const lines2 = await archive(h)
  await run(async fresh => { await restore(fresh, lines2); assert.deepEqual((await fresh.get('/api/coffer/reports/states?year=2026')).rows, before) })
  const twin = await donor(h, 'Moe Twin', place('TX'))
  const comparison = await h.get(`/api/coffer/duplicates/compare?source=${twin.id}&target=${moe.id}`)
  const merged = await h.command('donor.merge', { sourceDonorId: twin.id, donorId: moe.id, sourceVersion: comparison.source.version, version: comparison.target.version, fields: { addressLine1: 'source', city: 'source', region: 'source', postalCode: 'source' }, reason: 'duplicate_record' })
  assert.deepEqual((await report()).rows.find(x => x.state === 'NY'), before.find(x => x.state === 'NY'), 'a merge-day address change never reassigns earlier gifts')
  await h.command('donor.unmerge', { mergeId: merged.mergeId, reason: 'incorrect_match' })
  assert.deepEqual((await report()).rows, before)
  const file = await (await h.request(`/api/coffer/donors/${moe.id}/data-request`, { method: 'POST', body: { requestedOn: '2026-07-02', method: 'email' } })).json()
  assert.deepEqual(['region', 'until_on', 'source'].map(k => file.records.donor_address_history[0][k]), ['IL', '2026-06-01', 'staff'], 'the donor’s own file holds their address history')
  await h.command('donor.erase', { donorId: moe.id, confirm: 'ERASE' })
  const erased = await report()
  assert.equal(erased.rows.find(x => x.state === 'NY'), undefined)
  assert.equal(erased.rows.find(x => x.label === 'Unknown address').amountCents, 3000 + 9000)
  assert.equal(erased.totalCents, ledger, 'erased gifts stay in the ledger total, under Unknown address')
  const db = await h.mf.getD1Database('DB')
  assert.equal((await db.prepare('SELECT count(*) AS n FROM cf_donor_address_history WHERE donor_id=?').bind(moe.id).first()).n, 0, 'no address history remains for the erased donor')
 }, { bindings: { STRIPE_SECRET_KEY: 'sk_test_recognition_edge', MAIL_PROVIDER: 'sendgrid' }, outbound: edge.outbound })
}

