import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { run, donor, archive, restore, installation } from './harness.mjs'
import { withBrowserWorker } from './browser-worker.mjs'

export async function grantsJourney() {
 await run(async h => {
  const headers = { 'x-test-now': '2026-10-15T16:00:00Z' }
  const get = (path, options = {}) => h.get(path, { ...options, headers })
  const command = (name, input, options = {}) => h.command(name, input, { ...options, headers })
  const foundation = await donor(h, 'Rivera Foundation'), other = await donor(h, 'Other Corporate Funder')
  const member = await h.person('grants-member@example.test'), owner = (await get('/auth/session')).operator
  const request = { donorId: foundation.id, program: 'Community reading grants', requestedAmount: '1500', loiDueOn: '2026-09-01', proposalDueOn: '2026-10-01', reportDueOn: '2026-10-15' }
  await command('grant.save', request, { as: '', status: 401 })
  const agent = await command('agent.create', { label: 'Read grants' })
  await h.command('grant.save', request, { as: '', headers: { ...headers, authorization: 'Bearer ' + agent.token }, status: 403 })
  let grant = await command('grant.save', request, { as: member.cookie })
  await command('grant.save', { ...request, grantId: grant.id, version: grant.version, requestedAmount: '1600' }, { as: member.cookie })
  await command('grant.save', { ...request, grantId: grant.id, version: grant.version }, { status: 409 })
  grant = { id: grant.id, version: grant.version + 1 }
  const content = 'Rivera Foundation grant proposal: reading access for families.\n'
  const form = new FormData()
  for (const [key, value] of Object.entries({ command: 'grant.attach', grantId: grant.id, version: String(grant.version), title: 'Reading access proposal' })) form.set(key, value)
  form.set('attachment', new Blob([content], { type: 'text/plain' }), 'reading-proposal.txt')
  const multipart = new Request('https://example.test/upload', { method: 'POST', body: form })
  const upload = await h.request('/app/actions', { method: 'POST', raw: new Uint8Array(await multipart.arrayBuffer()), as: member.cookie,
   headers: { ...headers, 'content-type': multipart.headers.get('content-type') } })
  assert.equal(upload.status, 303, await upload.text())
  const state = () => get('/api/coffer/grants'), find = s => s.grants.find(g => g.id === grant.id)
  let row = find(await state()); grant.version = row.version
  assert.equal(row.documents.length, 1)
  const documentId = row.documents[0].id
  const downloaded = await h.request(`/api/coffer/grant-documents/${documentId}/download`, { headers, as: member.cookie })
  assert.equal(downloaded.status, 200); assert.equal(await downloaded.text(), content)
  await get(`/api/coffer/grant-documents/${documentId}/download`, { as: '', status: 401 })
  await command('grant.attach', { grantId: grant.id, version: grant.version, title: 'Invalid', fileName: 'bad.pdf', mediaType: 'application/pdf', contentBase64: btoa('not a pdf') }, { status: 400 })
  grant = await command('grant.status', { grantId: grant.id, version: grant.version, status: 'loi_submitted', recordedOn: '2026-09-01', evidence: 'Submitted inquiry in the foundation portal; confirmation LOI-123.' }, { as: member.cookie })
  row = find(await state()); assert.equal(row.status, 'loi_submitted'); assert.equal(row.loi_submitted_on, '2026-09-01')
  grant = await command('grant.status', { grantId: grant.id, version: grant.version, status: 'proposal_submitted', recordedOn: '2026-10-01', evidence: 'Uploaded the reviewed proposal; confirmation PROP-456.' }, { as: member.cookie })
  const award = { grantId: grant.id, version: grant.version, awardAmount: '1200', awardedOn: '2026-10-10', evidence: 'Signed award letter received from the foundation.', fund: 'Reading access', ownerId: member.id,
   installments: [{ dueOn: '2026-10-12', amount: '500' }, { dueOn: '2026-10-14', amount: '700' }] }
  await command('fund.define', { name: 'Reading access', restriction: 'purpose', detail: 'Family reading access program' }, { as: member.cookie, status: 403 })
  await command('fund.define', { name: 'Reading access', restriction: 'purpose', detail: 'Family reading access program' })
  await command('fund.define', { name: 'General purpose', restriction: 'unrestricted' })
  await command('grant.award', { ...award, fund: 'General purpose' }, { status: 409 })
  await command('grant.award', { ...award, awardAmount: '1300' }, { status: 400 })
  assert.equal(find(await state()).status, 'proposal_submitted')
  assert.equal((await get('/api/coffer/donors/' + foundation.id)).pledges.length, 0, 'Refused awards create no pledge or partial tasks')
  const awarded = await command('grant.award', award, { as: member.cookie })
  await command('grant.award', award, { status: 409 })
  row = find(await state())
  assert.equal(row.pledge_id, awarded.pledgeId); assert.equal(row.awarded_cents, 120000)
  assert.equal(row.restriction, 'purpose'); assert.equal(row.fund, 'Reading access')
  assert.deepEqual(row.installments.map(i => [i.due_on, i.amount_cents]), [['2026-10-12', 50000], ['2026-10-14', 70000]])
  assert.deepEqual(row.tasks.map(t => [t.due_on, t.owner_id, t.status]), [['2026-10-15', member.id, 'open']])
  const history = await get('/api/coffer/donors/' + foundation.id)
  assert.ok(history.pledges.some(p => p.id === awarded.pledgeId))
  const payment = await command('gift.record', { donorId: foundation.id, amount: '500', receivedOn: '2026-10-12', fund: 'Reading access', method: 'check', goods: 'none', pledgeId: awarded.pledgeId, installmentId: row.installments[0].id }, { as: member.cookie })
  row = find(await state()); assert.equal(row.paid_cents, 50000); assert.equal(row.remaining_cents, 70000)
  await command('gift.record', { donorId: other.id, amount: '10', receivedOn: '2026-10-12', fund: 'Reading access', method: 'check', goods: 'none', pledgeId: awarded.pledgeId, installmentId: row.installments[1].id }, { status: 409 })
  await command('gift.reverse', { giftId: payment.id, reason: 'Returned check' })
  assert.equal(find(await state()).remaining_cents, 120000, 'A reversed installment payment reopens the real pledge balance')
  const task = row.tasks[0]
  await command('grant.assignReport', { grantId: row.id, version: row.version, taskId: task.id, taskVersion: task.version, ownerId: owner.id })
  await command('grant.completeReport', { grantId: row.id, version: row.version, taskId: task.id, taskVersion: task.version, completedOn: '2026-10-15', notes: 'Report uploaded to funder portal.' }, { status: 409 })
  const reassigned = find(await state()).tasks[0]
  await command('grant.completeReport', { grantId: row.id, version: row.version, taskId: task.id, taskVersion: reassigned.version, completedOn: '2026-10-15', notes: 'Report uploaded to funder portal; confirmation REPORT-789.' })
  assert.equal(find(await state()).tasks[0].status, 'done')
  const page = await h.request('/app/grants', { headers }); assert.equal(page.status, 200)
  if (process.env.COFFER_GRANTS_BROWSER) await grantsBrowser(h, foundation.id, grant.id, headers, process.env.COFFER_GRANTS_BROWSER)
  const saved = await archive(h), fresh = await installation({ entry: 'tests/advancing-clock-worker.ts' })
  try {
   await restore(fresh, saved)
   const copied = find(await fresh.get('/api/coffer/grants', { headers }))
   assert.equal(copied.pledge_id, awarded.pledgeId); assert.equal(copied.remaining_cents, 120000)
   const copy = await fresh.request(`/api/coffer/grant-documents/${documentId}/download`, { headers }); assert.equal(await copy.text(), content)
  } finally { await fresh.close() }
  const source = await get('/api/coffer/donors/' + foundation.id), target = await get('/api/coffer/donors/' + other.id)
  const merged = await command('donor.merge', { sourceDonorId: foundation.id, sourceVersion: source.donor.version, donorId: other.id, version: target.donor.version, reason: 'duplicate_record' })
  assert.equal(find(await state()).donor_id, other.id)
  await command('donor.unmerge', { mergeId: merged.mergeId, reason: 'incorrect_match' })
  assert.equal(find(await state()).donor_id, foundation.id)
  await command('donor.erase', { donorId: foundation.id, confirm: 'ERASE' })
  assert.ok(!(await state()).grants.some(g => g.id === grant.id))
  const gone = await h.request(`/api/coffer/grant-documents/${documentId}/download`, { headers }); assert.equal(gone.status, 404)
  const erasedArchive = JSON.stringify(await archive(h))
  assert.doesNotMatch(erasedArchive, /Community reading grants|Reading access proposal|REPORT-789/)
 }, { entry: 'tests/advancing-clock-worker.ts' })
}

async function grantsBrowser(h, donorId, grantId, headers, directory) {
 await mkdir(directory, { recursive: true })
 await withBrowserWorker(h, async (context, origin) => {
  await context.setExtraHTTPHeaders({ cookie: h.owner, ...headers })
  const page = await context.newPage()
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 1000 }); await page.goto(origin + '/app/pipeline')
   await page.screenshot({path:`${directory}/MAJOR-006-pipeline-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Foundation and corporate grants',exact:true}).click()
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
   await page.screenshot({ path: `${directory}/MAJOR-006-grants-${width}.png`, fullPage: true })
   const create = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create grant request', exact: true }) })
   await create.locator('select[name=donorId]').selectOption(donorId)
   await create.getByLabel('Grant program', { exact: true }).fill(`Community follow-up ${width}`)
   await create.getByLabel('Amount requested (USD)', { exact: true }).fill('800')
   await create.getByLabel('Letter of inquiry deadline',{exact:true}).fill('2026-09-01')
   await create.getByLabel('Proposal deadline',{exact:true}).fill('2026-10-01')
   await create.getByLabel('Report deadline',{exact:true}).fill('2026-10-15')
   await create.getByRole('button', { name: 'Create grant request', exact: true }).click()
   const created = page.locator('section').filter({ has: page.getByRole('heading', { name: `Community follow-up ${width}`, exact: true }) })
   await created.getByLabel('Document title', { exact: true }).fill(`Follow-up inquiry ${width}`)
   await created.locator('input[type=file]').setInputFiles({ name: 'inquiry.txt', mimeType: 'text/plain', buffer: Buffer.from('A reviewed foundation inquiry.') })
   await created.getByRole('button', { name: 'Upload grant document', exact: true }).click()
   await created.getByRole('link', { name: `Follow-up inquiry ${width} · inquiry.txt`, exact: true }).waitFor()
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
   await created.screenshot({ path: `${directory}/MAJOR-006-created-${width}.png` })
   for(const [status,on,evidence] of [['loi_submitted','2026-09-01','Inquiry submitted in the foundation portal.'],['proposal_submitted','2026-10-01','The reviewed proposal was uploaded before the committee meeting.']]) {
    await created.getByText('Record progress',{exact:true}).click()
    await created.getByLabel('Recorded grant status',{exact:true}).selectOption(status)
    await created.getByLabel('Recorded activity date',{exact:true}).fill(on)
    await created.getByLabel('Submission or decision evidence',{exact:true}).fill(evidence)
    await created.getByRole('button',{name:'Record grant progress',exact:true}).click()
   }
   await created.getByText('Record award and payment schedule',{exact:true}).click()
   await created.getByLabel('Awarded on',{exact:true}).fill('2026-10-10')
   await created.getByLabel('Restricted fund',{exact:true}).selectOption('Reading access')
   await created.getByLabel('Award evidence',{exact:true}).fill('The signed award letter confirms the reading access restriction.')
   await created.getByLabel('Payment schedule: YYYY-MM-DD | amount, one per line',{exact:true}).fill('2026-10-12|800')
   await created.getByRole('button',{name:'Record award',exact:true}).click()
   await page.screenshot({path:`${directory}/MAJOR-006-awarded-${width}.png`,fullPage:true})
   await created.getByText('Record installment payment',{exact:true}).click()
   await created.getByLabel('Payment received on',{exact:true}).fill('2026-10-12')
   await created.getByLabel('Payment reference',{exact:true}).fill(`foundation-check-${width}`)
   await created.getByRole('button',{name:'Record grant payment',exact:true}).click()
   await page.screenshot({path:`${directory}/MAJOR-006-payment-donor-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Grant requests for this constituent',exact:true}).click()
   await created.getByLabel('Report completion evidence',{exact:true}).fill('The final reading access report was uploaded to the foundation portal.')
   await created.getByRole('button',{name:'Complete report task',exact:true}).click()
   assert.ok(await created.getByText('$800.00 received · $0.00 remaining',{exact:true}).isVisible())
   await page.screenshot({path:`${directory}/MAJOR-006-completed-${width}.png`,fullPage:true})
   await page.locator(`#grant-${grantId}`).screenshot({ path: `${directory}/MAJOR-006-award-${width}.png` })
  }
 })
}
