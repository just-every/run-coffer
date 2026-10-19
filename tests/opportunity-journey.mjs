import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { run, donor, archive, restore, imported } from './harness.mjs'
import { withBrowserWorker } from './browser-worker.mjs'

const headers = { 'x-test-now': '2026-10-15T16:00:00Z' }
async function pipelineFixture(h) {
 const owner = (await h.get('/auth/session')).operator, member = await h.person('riley.pipeline@example.test')
 const donors = await Promise.all(['Ada Rivera', 'Ben Okafor', 'Chen Foundation'].map(name => donor(h, name)))
 const campaigns = []
 for (const [name, slug] of [['Reading room renewal', 'reading-room-renewal'], ['Family literacy', 'family-literacy']]) campaigns.push(await h.api('/api/coffer/giving/campaigns', { name, slug, description: 'Community literacy and welcoming reading spaces.', fund: 'Library', goal: '50000' }))
 return { owner, member, donors, campaigns }
}
const ids = rows => rows.map(row => row.id).sort()
const renderedIds = html => [...html.matchAll(/data-opportunity="([^"]+)"/g)].map(match => match[1]).sort()
const plan = (donor, owner, campaign, extra = {}) => ({ donorId: donor.id, ownerId: owner.id, campaignId: campaign.id, label: 'Reading room leadership', stage: 'identify', askAmount: '1000.01', expectedAmount: '900.01', probability: 50, fund: 'Library', expectedCloseOn: '2026-12-15', nextStep: 'Arrange a reading room visit and discuss the proposal.', ...extra })

export async function opportunityJourney() {
 await run(async h => {
  const { owner, member, donors: [ada, ben, chen], campaigns: [reading, family] } = await pipelineFixture(h)
  const command = (name, input, options = {}) => h.command(name, input, { ...options, headers })
  const get = (path, options = {}) => h.get(path, { ...options, headers })
  const request = plan(ada, owner, reading)
  await command('prospect.save', request, { as: '', status: 401 })
  const agent = await command('agent.create', { label: 'Pipeline reader' })
  await h.command('prospect.save', request, { as: '', headers: { ...headers, authorization: 'Bearer ' + agent.token }, status: 403 })
  await command('prospect.save', { ...request, probability: 100.5 }, { status: 400 })
  await command('prospect.save', { ...request, ownerId: 'missing' }, { status: 409 })
  await command('prospect.save', { ...request, fund: 'Different fund' }, { status: 409 })
  const a = await command('prospect.save', request)
  const bInput = plan(ben, member, family, { label: 'Family literacy partnership', stage: 'cultivate', askAmount: '2000', expectedAmount: '1500', probability: 80 })
  const b = await command('prospect.save', bInput, { as: member.cookie })
  const cInput = plan(chen, member, reading, { label: 'Bookmobile renewal', stage: 'qualify', askAmount: '3000', expectedAmount: '2500', probability: 25 })
  const third = await command('prospect.save', cInput)
  let state = await get('/api/coffer/pipeline')
  assert.deepEqual([state.totals.askCents, state.totals.expectedCents, state.totals.forecastCents], [600001, 490001, 227501])
  assert.equal(state.opportunities.find(p => p.id === a.id).forecast_cents, 45001, 'Half-cent forecast rounds upward before summing')
  for (const [query, expected] of [[`ownerId=${member.id}`, [b, third]], ['stage=cultivate', [b]], [`campaignId=${reading.id}`, [a, third]], [`ownerId=${member.id}&campaignId=${reading.id}`, [third]]]) {
   assert.deepEqual(ids((await get('/api/coffer/pipeline?' + query)).opportunities), ids(expected))
   for (const view of ['board', 'list']) {
    const response = await h.request(`/app/pipeline?view=${view}&${query}`, { headers })
    assert.equal(response.status, 200); assert.deepEqual(renderedIds(await response.text()), ids(expected))
   }
  }
  const stages = await get('/api/coffer/prospect-stages')
  const configured = [...stages.stages, { id: 'committee', label: 'Committee review', outcome: 'open' }]
  await command('prospect.stages', { version: stages.version, stages: configured }, { as: member.cookie, status: 403 })
  const savedStages = await command('prospect.stages', { version: stages.version, stages: configured })
  await command('prospect.stages', { version: stages.version, stages: configured }, { status: 409 })
  const committee = await command('prospect.save', { ...bInput, id: b.id, version: b.version, stage: 'committee' })
  await command('prospect.stages', { version: savedStages.version, stages: stages.stages }, { status: 409 })
  await command('prospect.stages', { version: savedStages.version, stages: configured.map(s => s.id === 'committee' ? { ...s, outcome: 'won' } : s) }, { status: 409 })
  const renamed = await command('prospect.stages', { version: savedStages.version, stages: configured.map(s => s.id === 'committee' ? { ...s, label: 'Committee decision' } : s) })
  assert.equal((await get('/api/coffer/pipeline?stage=committee')).opportunities[0].id, b.id)
  assert.ok(renamed.version > savedStages.version)
  let moved = a
  for (const stage of ['qualify', 'cultivate', 'ask']) moved = await command('prospect.save', { ...request, id: a.id, version: moved.version, stage })
  await command('prospect.save', { ...request, id: a.id, version: a.version, stage: 'ask' }, { status: 409 })
  const close = { id: a.id, version: moved.version, stage: 'closed_won', closedOn: '2026-10-15' }
  await h.command('prospect.close', close, {as:'',headers:{...headers,authorization:'Bearer '+agent.token},status:403})
  await command('prospect.close', close, { status: 400 })
  const beforePledges = (await get('/api/coffer/donors/' + ada.id)).pledges.length
  await command('prospect.close', { ...close, linkKind: 'new_pledge', amount: '900.01', installments: [{ dueOn: '2026-12-15', amount: '900' }] }, { status: 400 })
  assert.equal((await get('/api/coffer/donors/' + ada.id)).pledges.length, beforePledges)
  const won = await command('prospect.close', { ...close, linkKind: 'new_pledge', amount: '900.01', installments: [{ dueOn: '2026-12-15', amount: '400' }, { dueOn: '2027-01-15', amount: '500.01' }] }, { as: member.cookie })
  await command('prospect.close', { ...close, linkKind: 'new_pledge', amount: '900.01', installments: [{ dueOn: '2026-12-15', amount: '900.01' }] }, { status: 409 })
  state = await get('/api/coffer/pipeline')
  assert.deepEqual([state.totals.open, state.totals.askCents, state.totals.expectedCents, state.totals.forecastCents], [2, 500000, 400000, 182500])
  assert.equal((await get('/api/coffer/portfolios?from=2026-01-01&through=2026-10-15')).pipelineCents,500000)
  assert.equal(state.opportunities.find(p => p.id === a.id).pledge_id, won.pledgeId)
  const promise = (await get('/api/coffer/donors/' + ada.id)).pledges.find(p => p.id === won.pledgeId)
  assert.equal(promise.amount_cents, 90001); assert.equal(promise.fund, 'Library')
  await command('prospect.save', { ...request, id: a.id, version: won.version }, { status: 409 })
  await command('prospect.close', { id: b.id, version: committee.version, stage: 'closed_won', closedOn: '2026-10-15', linkKind: 'pledge', pledgeId: won.pledgeId }, { status: 409 })
  const gift = await command('gift.record', { donorId: chen.id, amount: '2400.01', receivedOn: '2026-10-15', fund: 'Library', method: 'check', goods: 'none' })
  const giftClosed = await command('prospect.close', { id: third.id, version: third.version, stage: 'closed_won', closedOn: '2026-10-15', linkKind: 'gift', giftId: gift.id })
  assert.equal(giftClosed.giftId, gift.id)
  await command('prospect.close', { id: b.id, version: committee.version, stage: 'closed_lost', closedOn: '2026-10-15', linkKind: 'none' })
  assert.equal((await get('/api/coffer/pipeline')).totals.forecastCents, 0)
  assert.equal((await get('/api/coffer/portfolios?from=2026-01-01&through=2026-10-15')).pipelineCents,0)
  // Original public callers retain useful defaults when optional fields are omitted.
  const legacyInput = { donorId: ada.id, ownerId: owner.id, stage: 'ask', askAmount: '25.01', expectedCloseOn: '2026-12-01', nextStep: 'Discuss a further book purchase.' }
  const legacy = await command('prospect.save', legacyInput)
  const legacyRow = (await get('/api/coffer/prospects')).find(p => p.id === legacy.id)
  assert.deepEqual([legacyRow.expected_amount_cents, legacyRow.probability_percent, legacyRow.forecast_cents], [2501, 100, 2501])
  await command('prospect.close', { id: legacy.id, version: legacy.version, stage: 'closed_won', closedOn: '2026-10-15', linkKind: 'pledge', pledgeId: won.pledgeId }, { status: 409 })
  // A second opportunity may link a different existing promise.
  const existing = await command('pledge.create', { donorId: ada.id, amount: '25.01', pledgedOn: '2026-10-15', installments: [{ dueOn: '2026-12-01', amount: '25.01' }] })
  await command('prospect.close', { id: legacy.id, version: legacy.version, stage: 'closed_won', closedOn: '2026-10-15', linkKind: 'pledge', pledgeId: existing.id })
  const saved = await archive(h), original = await get('/api/coffer/pipeline')
  await run(async fresh => {
   await restore(fresh, saved)
   const copy = await fresh.get('/api/coffer/pipeline', { headers })
   assert.deepEqual(copy.totals, original.totals)
   assert.deepEqual(copy.opportunities.map(p => [p.id, p.pledge_id, p.gift_id, p.expected_amount_cents, p.probability_percent, p.fund, p.campaign_id]), original.opportunities.map(p => [p.id, p.pledge_id, p.gift_id, p.expected_amount_cents, p.probability_percent, p.fund, p.campaign_id]))
   assert.deepEqual(copy.stages, original.stages)
  }, { entry: 'tests/advancing-clock-worker.ts' })
  const source = (await get('/api/coffer/donors/' + ada.id)).donor, target = (await get('/api/coffer/donors/' + ben.id)).donor
  const merged = await command('donor.merge', { sourceDonorId: ada.id, sourceVersion: source.version, donorId: ben.id, version: target.version, reason: 'duplicate_record' })
  assert.equal((await get('/api/coffer/prospects')).find(p => p.id === a.id).donor_id, ben.id)
  assert.equal((await get('/api/coffer/donors/' + ben.id)).pledges.find(p => p.id === won.pledgeId).donor_id, ben.id)
  await command('donor.unmerge', { mergeId: merged.mergeId, reason: 'incorrect_match' })
  assert.equal((await get('/api/coffer/prospects')).find(p => p.id === a.id).donor_id, ada.id)
  const secondMerge = await command('donor.merge', { sourceDonorId: ada.id, sourceVersion: (await get('/api/coffer/donors/' + ada.id)).donor.version, donorId: ben.id, version: (await get('/api/coffer/donors/' + ben.id)).donor.version, reason: 'duplicate_record' })
  const afterMerge = await command('prospect.save', { ...legacyInput, donorId: ben.id })
  await command('donor.unmerge', { mergeId: secondMerge.mergeId, reason: 'incorrect_match' }, { status: 409 })
  assert.ok((await get('/api/coffer/prospects')).some(p => p.id === afterMerge.id))
  await command('donor.erase', { donorId: ben.id, confirm: 'ERASE' })
  assert.ok(!(await get('/api/coffer/prospects')).some(p => [a.id, b.id, legacy.id, afterMerge.id].includes(p.id)))
  assert.doesNotMatch(JSON.stringify(await archive(h)), /Reading room leadership|Family literacy partnership|Committee decision.*Reading room leadership/)
  // Native opportunities fence undo of a donor brought in through Stripe.
  const importedJob = await imported(h)
  const importedDonor = (await get('/api/coffer/donors')).donors.find(d => d.source === 'stripe')
  assert.ok(importedDonor)
  await command('prospect.save', { ...legacyInput, donorId: importedDonor.id })
  await h.api('/api/coffer/imports/undo', { id: importedJob.job.id }, { status: 409 })
 }, { entry: 'tests/advancing-clock-worker.ts' })
 if (process.env.COFFER_OPPORTUNITY_BROWSER) await opportunityBrowser(process.env.COFFER_OPPORTUNITY_BROWSER)
}

export async function opportunityBrowser(directory) {
 await mkdir(directory, { recursive: true })
 await run(async h => {
  const fixtures = await pipelineFixture(h)
  await withBrowserWorker(h, async (context, origin) => {
   await context.setExtraHTTPHeaders({ cookie: h.owner, ...headers })
   const page = await context.newPage()
   const screenshot = async (name, width) => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${directory}/MAJOR-001-${name}-${width}.png`, fullPage: true })
   }
   for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(origin+'/app/pipeline')
    await page.getByText('Configure stages',{exact:true}).click()
    const definitions=page.locator('textarea[name=stageDefinitions]'),currentDefinitions=await definitions.inputValue()
    await definitions.fill(width===1440 ? currentDefinitions+'\ncommittee | Committee review | open' : currentDefinitions.replace('Committee review','Committee decision'))
    await page.getByRole('button',{name:'Save pipeline stages',exact:true}).click()
    await page.getByText('Configure stages',{exact:true}).click()
    assert.ok((await definitions.inputValue()).includes(width===1440?'Committee review':'Committee decision'))
    await screenshot('stage-settings',width)
    const created = []
    const { donors, owner, member, campaigns } = fixtures
    const season = width === 1440 ? 'Autumn' : 'Winter'
    for (const [i, donor] of donors.entries()) {
     await page.goto(origin + '/app/pipeline')
     const create = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add opportunity', exact: true }) })
     await create.locator('select[name=donorId]').selectOption(donor.id)
     await create.getByLabel('Opportunity name', { exact: true }).fill(`${season} ${['reading room leadership', 'family literacy partnership', 'bookmobile renewal'][i]}`)
     await create.locator('select[name=stage]').selectOption(i === 1 ? 'cultivate' : 'identify')
     await create.locator('select[name=ownerId]').selectOption(i === 0 ? owner.id : member.id)
     await create.getByLabel('Ask amount (USD)', { exact: true }).fill(['1000', '2000', '3000'][i])
     await create.getByLabel('Expected amount (USD)', { exact: true }).fill(['900', '1500', '2500'][i])
     await create.getByLabel('Probability (%)', { exact: true }).fill(['50', '80', '25'][i])
     await create.getByLabel('Expected close date (required)', { exact: true }).fill('2026-12-15')
     await create.getByLabel('Fund', { exact: true }).fill('Library')
     await create.locator('select[name=campaignId]').selectOption(campaigns[i === 1 ? 1 : 0].id)
     await create.getByLabel('Next step', { exact: true }).fill('Invite the donor to the reading room and discuss a proposal.')
     const before = ids(await h.get('/api/coffer/prospects', { headers }))
     await create.getByRole('button', { name: 'Add opportunity', exact: true }).click()
     await page.getByRole('heading', { name: 'Major-gift pipeline', exact: true }).waitFor()
     const added = (await h.get('/api/coffer/prospects', { headers })).filter(p => !before.includes(p.id))
     assert.equal(added.length, 1); created.push(added[0])
    }
    const filter = page.getByRole('form', { name: 'Pipeline filters' })
    for (const view of ['board', 'list']) {
     await filter.locator('select[name=view]').selectOption(view)
     for (const [name, value, predicate] of [['Owner', member.id, p => p.owner_id === member.id], ['Stage', 'cultivate', p => p.stage === 'cultivate'], ['Campaign', campaigns[0].id, p => p.campaign_id === campaigns[0].id]]) {
      for (const clear of ['Owner', 'Stage', 'Campaign']) await filter.locator(`select[name=${({Owner:'ownerId',Stage:'stage',Campaign:'campaignId'})[clear]}]`).selectOption('')
      await filter.locator(`select[name=${({Owner:'ownerId',Stage:'stage',Campaign:'campaignId'})[name]}]`).selectOption(value)
      await filter.getByRole('button', { name: 'Filter pipeline', exact: true }).click()
      const expected = (await h.get('/api/coffer/prospects', { headers })).filter(predicate)
      assert.deepEqual((await page.locator('[data-opportunity]').evaluateAll(rows => rows.map(row => row.dataset.opportunity))).sort(), ids(expected))
      await screenshot(`${view}-${name.toLowerCase()}`, width)
     }
    }
    await page.goto(origin + '/app/pipeline?view=board')
    for (const stage of ['qualify', 'cultivate', 'ask']) {
     const row = page.locator('#opportunity-' + created[0].id)
     await row.getByText('Update opportunity', { exact: true }).click()
     await row.locator('form').filter({has:page.getByRole('button',{name:'Save opportunity',exact:true})}).locator('select[name=stage]').selectOption(stage)
     await row.getByRole('button', { name: 'Save opportunity', exact: true }).click()
     await page.getByRole('heading', { name: 'Major-gift pipeline', exact: true }).waitFor()
    }
    await screenshot('solicitation', width)
    const beforeTotal = (await h.get('/api/coffer/pipeline', { headers })).totals.forecastCents
    const row = page.locator('#opportunity-' + created[0].id)
    await row.locator('summary').filter({hasText:/^Close opportunity$/}).click()
    await row.locator('form').filter({has:page.getByRole('button',{name:'Close opportunity',exact:true})}).locator('select[name=stage]').selectOption('closed_won')
    await row.getByLabel('Closed on', { exact: true }).fill('2026-10-15')
    await row.locator('select[name=linkKind]').selectOption('new_pledge')
    await row.getByLabel('Pledge amount (USD)', { exact: true }).fill('900')
    await row.locator('textarea[name=schedule]').fill('2026-12-15|900')
    await row.screenshot({path:`${directory}/MAJOR-001-close-form-${width}.png`})
    await row.getByRole('button', { name: 'Close opportunity', exact: true }).click()
    await row.getByRole('link', { name: /Linked pledge/ }).waitFor()
    const result = await h.get('/api/coffer/pipeline', { headers })
    assert.equal(result.totals.forecastCents, beforeTotal - created[0].forecast_cents)
    assert.equal(await page.locator('#pipeline-forecast').textContent(), new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(result.totals.forecastCents / 100))
    await screenshot('closed-won-forecast', width)
    await row.getByRole('link', { name: /Linked pledge/ }).click()
    assert.ok((await h.get('/api/coffer/donors/' + donors[0].id, { headers })).pledges.some(p => p.id === result.opportunities.find(p => p.id === created[0].id).pledge_id))
    await screenshot('linked-pledge', width)
    await page.goto(origin+'/app/portfolios')
    await screenshot('portfolios',width)
   }
  })
 }, { entry: 'tests/advancing-clock-worker.ts' })
}
