import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { run, donor, reviewed } from './harness.mjs'
import { recognitionEdges, recognitionMember, form } from './recognition-edge.mjs'

const csv = (name, body) => ({ name, base64: Buffer.from(body).toString('base64') })
const crm = gifts => ({ source: 'lgl', files: [
 csv('constituents.csv', 'LGL Constituent ID,Name,Email Address\n901,Iris Import,iris.import@example.org\n'),
 csv('gifts.csv', `LGL Gift ID,LGL Constituent ID,Gift Type,Gift Date,Amount,Fund,Campaign,Appeal,Channel,Payment Type,Non-Deductible Amount\n${gifts}`),
] })

// Only Stripe (checkout) and mail are faked; entry, the giving page, the CRM move-in
// and the ledger report all run through the real HTTP doors.
export async function attributionJourney() {
 const edge = recognitionEdges()
 await run(async h => {
  await reviewed(h)
  const member = await recognitionMember(h, edge), day = new Intl.DateTimeFormat('en-CA', { timeZone: (await h.get('/api/coffer/settings')).timezone }).format(new Date())
  const ada = await donor(h, 'Ada Field'), ben = await donor(h, 'Ben Field')
  // Funds, a campaign and two appeals.
  await h.command('fund.define', { name: 'Reading', restriction: 'purpose', detail: 'Reading room books' })
  await h.command('fund.define', { name: 'General', restriction: 'unrestricted' })
  const campaign = await h.api('/api/coffer/giving/campaigns', { name: 'Spring reading', slug: 'spring-reading', description: 'Books for spring.', fund: 'Reading', goal: '5000' })
  assert.deepEqual(await h.command('appealCode.define', { code: 'SPRING-MAIL', name: 'Spring mail appeal' }), { code: 'SPRING-MAIL', name: 'Spring mail appeal' })
  await h.command('appealCode.define', { code: 'GALA-2026', name: 'Spring gala' })
  assert.equal((await h.command('appealCode.define', { code: 'spring-mail', name: 'Again' }, { status: 409 })).error, 'APPEAL_DEFINED')
  assert.equal((await h.command('appealCode.define', { code: '<b>', name: 'Markup' }, { status: 400 })).error, 'INPUT')
  await h.command('appealCode.define', { code: 'STAFF-ONLY', name: 'Member attempt' }, { as: member, status: 403 })

  // Entry: structured references, never free text; a campaign raises for its own fund.
  const mailed = await h.command('gift.record', { donorId: ada.id, amount: '100', receivedOn: day, method: 'check', fund: 'Reading', goods: 'none', campaignId: campaign.id, appeal: 'spring-mail', channel: 'mail' }, { as: member })
  assert.deepEqual([mailed.campaignId, mailed.appeal, mailed.channel], [campaign.id, 'SPRING-MAIL', 'mail'])
  assert.equal((await h.command('gift.record', { donorId: ada.id, amount: '5', receivedOn: day, method: 'cash', fund: 'Reading', goods: 'none', appeal: 'Free text appeal' }, { status: 400 })).error, 'APPEAL')
  assert.equal((await h.command('gift.record', { donorId: ada.id, amount: '5', receivedOn: day, method: 'cash', fund: 'General', goods: 'none', campaignId: campaign.id }, { status: 409 })).error, 'CAMPAIGN_FUND')
  assert.equal((await h.command('gift.record', { donorId: ada.id, amount: '5', receivedOn: day, method: 'cash', fund: 'General', goods: 'none', channel: 'carrier pigeon' }, { status: 400 })).error, 'INPUT')
  const gala = await h.command('gift.record', { donorId: ben.id, amount: '250', receivedOn: day, method: 'cash', fund: 'General', goods: 'none', appeal: 'GALA-2026', channel: 'event' })
  await h.command('gift.record', { donorId: ben.id, amount: '60', receivedOn: day, method: 'cash', goods: 'none', allocations: [{ fund: 'Reading', amountCents: 4000 }, { fund: 'General', amountCents: 2000 }], appeal: 'GALA-2026', channel: 'event' })
  await h.command('gift.reverse', { giftId: gala.id, reason: 'Bounced', reversedOn: day })
  const entryForm = await (await h.request(`/app/donors/${ada.id}`, { as: member })).text()
  for (const name of ['campaignId', 'appeal', 'channel']) assert.match(entryForm, new RegExp(`<select[^>]*name="${name}"`), `entry form chooses ${name}`)
  assert.match(entryForm, /<option value="SPRING-MAIL">Spring mail appeal \(SPRING-MAIL\)<\/option>/)

  // A form reached through a tracked link: the giving page carries the defined appeal, an unknown code carries none.
  const tracked = await (await h.request('/give/spring-reading?appeal=spring-mail', { as: '' })).text()
  assert.match(tracked, /<input type="hidden" name="appeal" value="SPRING-MAIL">/)
  assert.doesNotMatch(await (await h.request('/give/spring-reading?appeal=NOT-DEFINED', { as: '' })).text(), /name="appeal"/)
  const input = { requestId: randomUUID(), frequency: 'once','cf-turnstile-response':'synthetic-coffer-security-token', name: 'Cara Online', email: 'cara.online@example.org', amount: '40', appeal: 'SPRING-MAIL' }
  const checkout = await h.request('/give/spring-reading/checkout', { ...form(input), as: '' })
  assert.equal(checkout.status, 303, await checkout.text())
  const session = new URL(checkout.headers.get('location')).pathname.split('/').at(-1)
  assert.equal((await h.request('/giving/thanks?session_id=' + session, { as: '' })).status, 200)
  const cara = (await h.get('/api/coffer/donors')).donors.find(d => d.email === 'cara.online@example.org')
  const online = (await h.get(`/api/coffer/donors/${cara.id}`)).gifts.find(g => g.kind === 'gift')
  assert.equal(online.appeal, 'Spring mail appeal')

  // An import: the CRM's appeal column maps to defined appeals (an undefined one is defined from the import) and its channel column to a channel.
  const refused = await h.api('/api/coffer/move-in/preview', crm('IG9,901,Gift,2025-03-01,10.00,General,,GALA-2026,Pigeon,Cash,0.00\n'))
  assert.equal(refused.canApply, false); assert.ok(refused.diagnostics.some(d => d.code === 'CHANNEL'))
  const preview = await h.api('/api/coffer/move-in/preview', crm('IG1,901,Gift,2025-03-01,75.00,General,Winter reading,gala-2026,Event,Check,0.00\nIG2,901,Gift,2025-04-01,30.00,Reading,,Year-end letter,Mail,Check,0.00\nIG3,901,Gift,2025-05-01,20.00,General,,,,Cash,0.00\n'))
  assert.equal(preview.canApply, true, JSON.stringify(preview.diagnostics))
  let job = await h.api('/api/coffer/move-in/apply', { id: preview.id, fingerprint: preview.fingerprint })
  while (job.state === 'applying') job = await h.api('/api/coffer/move-in/continue', { id: preview.id })
  assert.equal(job.state, 'completed')

  // Totals by each dimension sum to the fund ledger for the same inclusive days.
  await h.get('/api/coffer/reports/attribution', { as: '', status: 401 })
  const report = await h.get(`/api/coffer/reports/attribution?from=2025-01-01&to=${day}`, { as: member })
  const db = await h.mf.getD1Database('DB')
  const ledger = (await db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS cents FROM cf_fund_ledger WHERE received_on BETWEEN ? AND ?').bind('2025-01-01', day).first()).cents
  assert.equal(report.ledgerCents, ledger); assert.equal(ledger, 10000 + 25000 - 25000 + 6000 + 4000 + 7500 + 3000 + 2000)
  for (const dimension of ['fund', 'campaign', 'appeal', 'channel'])
   assert.equal(report[dimension].reduce((sum, r) => sum + r.amountCents, 0), ledger, `${dimension} sums to the ledger`)
  const row = (dimension, key) => report[dimension].find(r => r.key === key)
  assert.deepEqual([row('fund', 'Reading').amountCents, row('fund', 'General').amountCents], [10000 + 4000 + 4000 + 3000, 2000 + 7500 + 2000])
  assert.deepEqual([row('campaign', campaign.id).amountCents, row('campaign', campaign.id).gifts], [10000 + 4000, 2])
  assert.equal(row('campaign', null).label, 'No campaign')
  assert.deepEqual([row('appeal', 'SPRING-MAIL').amountCents, row('appeal', 'SPRING-MAIL').gifts], [14000, 2])
  assert.deepEqual([row('appeal', 'GALA-2026').amountCents, row('appeal', 'GALA-2026').gifts], [6000 + 7500, 3], 'the reversal counts under its gift’s appeal')
  assert.equal(row('appeal', 'Year-end letter').amountCents, 3000); assert.equal(row('appeal', null).amountCents, 2000)
  assert.deepEqual(['form', 'mail', 'event'].map(k => row('channel', k).amountCents), [4000, 10000 + 3000, 6000 + 7500])
  assert.equal(row('channel', null).label, 'Channel not recorded'); assert.equal(row('channel', null).amountCents, 2000)
  assert.equal((await h.get(`/api/coffer/reports/attribution?from=${day}&to=2025-01-01`, { status: 400 })).error, 'INPUT')

  // The page shows every dimension and the appeals; only the owner and admins define one.
  const page = await (await h.request(`/app/gifts/attribution?from=2025-01-01&to=${day}`)).text()
  for (const text of ['By fund', 'By campaign', 'By appeal', 'By channel', 'Spring mail appeal', 'Year-end letter', 'from an import', '?appeal=SPRING-MAIL']) assert.ok(page.includes(text), text)
  assert.match(page, /name="command" value="appealCode.define"/)
  assert.doesNotMatch(await (await h.request('/app/gifts/attribution', { as: member })).text(), /value="appealCode.define"/)
 }, { bindings: { STRIPE_SECRET_KEY: 'synthetic-coffer-6000', MAIL_PROVIDER: 'sendgrid' }, outbound: edge.outbound })
}
