import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir, readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {withBrowserWorker} from './browser-worker.mjs'

const require = createRequire(import.meta.url)
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8')
const mailbox = width => ['synthetic-coffer-' + width, 'example.test'].join('@')

export async function givingFormBrowser(h, campaign, edge, directory = '.cache/giving-forms') {
 await mkdir(directory, {recursive: true})
 const results = []
 await withBrowserWorker(h, async (context, origin) => {
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  await page.route('https://checkout.stripe.com/**', route => route.fulfill({contentType: 'text/plain', body: 'Payment network boundary'}))
  const host = createServer((request, response) => {
   response.writeHead(200, {'content-type': 'text/html'})
   response.end(`<!doctype html><html lang="en"><head><title>Riverbend community website</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><h1 style="font:24px Arial;padding:16px">Riverbend community appeal</h1><script src="${origin}/give/${campaign.slug}/embed.js" async></script></body></html>`)
  })
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
  const hostOrigin = `http://127.0.0.1:${host.address().port}`
  try {
   for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 1000})
    await page.goto(origin + '/app/settings/giving-forms/' + campaign.id)
    const settings = page.locator('[data-giving-form-settings]')
    const change = async (name, value, type = 'fill') => {
     const control = settings.getByLabel(name, {exact: true})
     const [saved] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/app/settings/giving-forms/' + campaign.id) && r.request().method() === 'POST'),
      (async () => {
       if (type === 'select') await control.selectOption(value)
       else if (type === 'check') await control.setChecked(value)
       else { await control.fill(value); await control.press('Tab') }
      })(),
     ]).catch(async error => {console.log('FORM_EDIT', name, await settings.evaluate(f=>({status:f.querySelector('[data-form-status]').textContent,invalid:[...f.elements].filter(e=>e.validity&&!e.validity.valid).map(e=>({name:e.name,message:e.validationMessage})),values:[...new FormData(f)]})));throw error})
     assert.equal(saved.status(), 200, await saved.text())
     await page.waitForFunction(() => document.querySelector('[data-form-status]')?.textContent === 'Saved')
    }
    await change('Form heading', 'Give local readers a new chapter ' + width)
    if (width === 1440) {
     await change('Form copy', 'Your gift keeps our reading room open and supports neighborhood tutors.')
     await change('Form logo', '/give/' + campaign.slug + '/media/image', 'select')
     await change('Button color', '#254f3f')
     await change('Page background', '#f3f6ee')
     await change('Page text', '#182d26')
     await change('Suggested amounts (USD, comma separated)', '25, 50, 100')
     await change('Designations (one fund per line)', 'Reading\nTutoring')
     await change('Ask for an employer', true, 'check')
     await change('Allow a comment', true, 'check')
     await settings.getByText('Custom questions', {exact: true}).click()
     // Fieldsets are selected by their legend text, then ordinary labelled controls.
     for (const key of ['reading_interests', 'books', 'visit_date', 'match_ok', 'class_year', 'budget']) {
      const question = settings.locator('fieldset').filter({has: page.locator('[name="question.' + key + '"]')})
      const response = page.waitForResponse(r => r.url().endsWith('/app/settings/giving-forms/' + campaign.id) && r.request().method() === 'POST')
      await question.getByRole('checkbox', {name: 'Publish this question on the giving form'}).check()
      assert.equal((await response).status(), 200)
      await page.waitForFunction(() => document.querySelector('[data-form-status]')?.textContent === 'Saved')
     }
     const required = settings.locator('fieldset').filter({has: page.locator('[name="question.reading_interests"]')})
     const response = page.waitForResponse(r => r.url().endsWith('/app/settings/giving-forms/' + campaign.id) && r.request().method() === 'POST')
     await required.getByRole('checkbox', {name: 'Require an answer'}).check(); assert.equal((await response).status(), 200)
     await page.waitForFunction(() => document.querySelector('[data-form-status]')?.textContent === 'Saved')
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({path: `${directory}/settings-${width}.png`, fullPage: true})
    await page.goto(origin + '/give/' + campaign.slug)
    await page.getByRole('heading', {name: 'Give local readers a new chapter ' + width, exact: true}).waitFor()
    assert.equal(await page.locator('header img').getAttribute('src'), '/give/' + campaign.slug + '/media/image')
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(243, 246, 238)')
    await page.screenshot({path: `${directory}/hosted-${width}.png`, fullPage: true})
    await page.goto(hostOrigin)
    const frame = page.frameLocator('iframe'), iframe = page.locator('iframe')
    await frame.getByRole('heading', {name: 'Give local readers a new chapter ' + width, exact: true}).waitFor()
    assert.ok(await iframe.getAttribute('title'))
    await frame.getByRole('button', {name: '$50.00', exact: true}).focus()
    await page.keyboard.press('Enter')
    assert.equal(await frame.getByLabel('Gift amount (USD)', {exact: true}).inputValue(), '50.00')
    await page.keyboard.press('Tab')
    assert.equal(await frame.locator(':focus').getAttribute('name'), 'feeCover', 'Keyboard moves from amount to the optional fee agreement')
    await frame.getByLabel('Designation', {exact: true}).selectOption('Tutoring')
    await frame.getByLabel('Employer (optional)', {exact: true}).fill('Riverbend Library')
    await frame.getByLabel('Comment (optional)', {exact: true}).fill('For the Saturday reading circle ' + width)
    await frame.getByRole('checkbox', {name: 'Books', exact: true}).check()
    await frame.getByRole('checkbox', {name: 'Tutoring', exact: true}).check()
    await frame.getByLabel('Books to sponsor (optional)', {exact: true}).fill('3')
    await frame.getByLabel('Visit date (optional)', {exact: true}).fill('2026-11-20')
    await frame.getByLabel('Employer match available (optional)', {exact: true}).selectOption('false')
    await frame.getByLabel('Class year (optional)', {exact: true}).fill('2024')
    await frame.getByLabel('Budget (optional)', {exact: true}).fill('125.75')
    await frame.getByLabel('Full name', {exact: true}).fill('Riverbend Reader ' + width)
    await frame.getByLabel('Email address', {exact: true}).fill(mailbox(width))
    await frame.locator('[name=emailConsent]').setChecked(width === 1440)
    await frame.locator('[name=feeCover]').setChecked(width === 390)
    await frame.getByText('Give in honor or memory', {exact: true}).click()
    await frame.getByLabel('Tribute type', {exact: true}).selectOption('honor')
    await frame.getByLabel('Honoree name', {exact: true}).fill('Our community tutors')
    const child = page.frames().find(f => f.url().includes('?embed=1'))
    await child.evaluate(axe)
    const accessibility = await child.evaluate(async () => (await window.axe.run(document.querySelector('.donation'), {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']}})).violations.map(v => ({id: v.id, nodes: v.nodes.map(n => n.target)})))
    assert.deepEqual(accessibility, [], 'Donation form passes axe WCAG AA checks')
    assert.ok(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const tooSmall = await child.evaluate(() => [...document.querySelectorAll('.donation *')].filter(el => el.textContent.trim() && getComputedStyle(el).display !== 'none' && parseFloat(getComputedStyle(el).fontSize) < 13).map(el => el.tagName))
    assert.deepEqual(tooSmall, [])
    await page.screenshot({path: `${directory}/embedded-${width}.png`, fullPage: true})
    const form = frame.locator('.donation form')
    const values = await form.evaluate(el => [...new FormData(el).entries()])
    await frame.getByRole('button', {name: 'Continue to secure checkout'}).click()
    await page.waitForURL('https://checkout.stripe.com/**')
    const session = [...edge.sessions.values()].at(-1)
    assert.equal(session.amount_total, width === 1440 ? 5000 : 5181)
    await page.goto(origin + '/giving/thanks?session_id=' + session.id)
    await page.getByRole('heading', {name: 'Thank you for your gift', exact: true}).waitFor()
    await page.screenshot({path: `${directory}/paid-${width}.png`, fullPage: true})
    results.push({width, session, values, mailbox: mailbox(width)})
   }
   await page.goto(origin + '/app/settings/giving-forms/' + campaign.id)
   for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 1000})
    await page.getByRole('heading', {name: 'Recent form responses', exact: true}).waitFor()
    assert.ok(await page.getByText('For the Saturday reading circle 390', {exact: false}).count())
    await page.screenshot({path: `${directory}/responses-${width}.png`, fullPage: true})
   }
  } finally {await new Promise(resolve => host.close(resolve))}
 })
 return results
}
