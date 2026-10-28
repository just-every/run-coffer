// Manual live sandbox browser journey. Stripe's UI and payment fields are real.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {withBrowserWorker} from './browser-worker.mjs'

const axe = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const token = 'synthetic-coffer-security-token'

async function configure(page, origin, campaign) {
 await page.goto(origin + '/app/settings')
 await page.getByRole('link', {name: 'Donation forms', exact: true}).click()
 await page.getByRole('link', {name: campaign.name, exact: true}).click()
 const settings = page.locator('[data-giving-form-settings]')
 const save = async action => {
  const response = page.waitForResponse(r => r.url().endsWith('/app/settings/giving-forms/' + campaign.id) && r.request().method() === 'POST')
  await action()
  assert.equal((await response).status(), 200, 'The native form settings save succeeds')
  await page.waitForFunction(() => document.querySelector('[data-form-status]')?.textContent === 'Saved')
 }
 const change = (name, value, kind = 'fill') => save(async () => {
  const control = settings.getByLabel(name, {exact: true})
  if (kind === 'select') await control.selectOption(value)
  else if (kind === 'check') await control.setChecked(value)
  else {await control.fill(value); await control.press('Tab')}
 })
 for (const [name, value] of [
  ['Form heading', 'Give local readers a new chapter'],
  ['Form copy', 'Your gift keeps our reading room open and supports neighborhood tutors.'],
  ['Button color', '#254f3f'], ['Page background', '#f3f6ee'], ['Page text', '#182d26'],
  ['Suggested amounts (USD, comma separated)', '25, 50, 100'],
  ['Designations (one fund per line)', 'Reading\nTutoring'],
 ]) await change(name, value)
 await change('Form logo', '/give/' + campaign.slug + '/media/image', 'select')
 await change('Ask for an employer', true, 'check')
 await change('Allow a comment', true, 'check')
 await settings.getByText('Custom questions', {exact: true}).click()
 for (const key of ['reading_interests', 'books', 'visit_date', 'match_ok', 'class_year', 'budget']) {
  const group = settings.locator('fieldset').filter({has: page.locator('[name="question.' + key + '"]')})
  await save(() => group.getByRole('checkbox', {name: 'Publish this question on the giving form'}).check())
 }
 const required = settings.locator('fieldset').filter({has: page.locator('[name="question.reading_interests"]')})
 await save(() => required.getByRole('checkbox', {name: 'Require an answer'}).check())
}

// Search provider-owned frames as well as Checkout's document. No injected
// payment fields, provider responses, account cookies or saved browser profile.
async function visibleField(page, selector, timeout = 30000) {
 const deadline = Date.now() + timeout
 while (Date.now() < deadline) {
  for (const frame of page.frames()) {
   const controls = frame.locator(selector)
   for (let index = 0; index < await controls.count(); index++) {
    if (await controls.nth(index).isVisible()) return controls.nth(index)
   }
  }
  await page.waitForTimeout(200)
 }
 throw new Error('Stripe payment field did not become ready')
}

async function fillOptional(page, selector, value, select = false) {
 for (const frame of page.frames()) {
  const controls = frame.locator(selector)
  for (let index = 0; index < await controls.count(); index++) {
   const control = controls.nth(index)
   if (await control.isVisible() && await control.isEditable()) {
    if (select) await control.selectOption(value)
    else await control.fill(value)
   }
  }
 }
}

async function pay(page, name, email) {
 const usd = page.getByText('$50.00', {exact:true})
 if(await usd.count() && await usd.first().isVisible())await usd.first().click()
 // https://docs.stripe.com/testing#cards — successful Visa test card.
 await (await visibleField(page, 'input[name="cardNumber"], input[autocomplete="cc-number"]')).fill('4242'.repeat(4))
 await (await visibleField(page, 'input[name="cardExpiry"], input[autocomplete="cc-exp"]')).fill('12' + String(new Date().getUTCFullYear() + 3).slice(-2))
 await (await visibleField(page, 'input[name="cardCvc"], input[autocomplete="cc-csc"]')).fill('123')
 await fillOptional(page, 'select[name="billingCountry"], select[autocomplete="billing country"], select[autocomplete="country"]', 'US', true)
 for (const [selector, value] of [
  ['input[name="email"], input[autocomplete="email"]', email],
  ['input[name="billingName"], input[autocomplete="cc-name"], input[autocomplete="billing name"]', name],
  ['input[name="billingAddressLine1"], input[autocomplete="billing address-line1"], input[autocomplete="address-line1"]', '1 Main Street'],
  ['input[name="billingLocality"], input[autocomplete="billing address-level2"], input[autocomplete="address-level2"]', 'Springfield'],
  ['input[name="billingAdministrativeArea"], input[autocomplete="billing address-level1"]', 'IL'],
  ['input[name="billingPostalCode"], input[autocomplete="billing postal-code"], input[autocomplete="postal-code"]', '62701'],
 ]) await fillOptional(page, selector, value)
 await fillOptional(page, 'select[name="billingAdministrativeArea"], select[autocomplete="billing address-level1"]', 'IL', true)
 const saveWithLink=page.getByRole('checkbox',{name:/Save my information with Link/})
 if(await saveWithLink.count())await saveWithLink.uncheck()
 await (await visibleField(page, 'button[type="submit"]')).click()
}

async function completeForm(page, frame, label) {
 await frame.getByRole('button', {name: '$50.00', exact: true}).focus()
 await page.keyboard.press('Enter')
 assert.equal(await frame.getByLabel('Gift amount (USD)', {exact: true}).inputValue(), '50.00')
 await frame.getByLabel('Gift frequency', {exact: true}).selectOption('once')
 await frame.getByLabel('Designation', {exact: true}).selectOption('Tutoring')
 await frame.getByLabel('Employer (optional)', {exact: true}).fill('Riverbend Library')
 await frame.getByLabel('Comment (optional)', {exact: true}).fill(label)
 for (const name of ['Books', 'Tutoring']) await frame.getByRole('checkbox', {name, exact: true}).check()
 const date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
 for (const [name, value] of [['Books to sponsor (optional)', '3'], ['Visit date (optional)', date], ['Class year (optional)', '2024'], ['Budget (optional)', '125.75']]) {
  await frame.getByLabel(name, {exact: true}).fill(value)
 }
 await frame.getByLabel('Employer match available (optional)', {exact: true}).selectOption('false')
 const email = [label, 'example.test'].join('@')
 await frame.getByLabel('Full name', {exact: true}).fill(label)
 await frame.getByLabel('Email address', {exact: true}).fill(email)
 await frame.locator('[name=emailConsent]').check()
 // Each payment is literally $50; the optional fee agreement stays unchecked.
 await frame.locator('[name=feeCover]').uncheck()
 await frame.getByText('Give in honor or memory', {exact: true}).click()
 await frame.getByLabel('Tribute type', {exact: true}).selectOption('honor')
 await frame.getByLabel('Honoree name', {exact: true}).fill('Our community tutors')
 return {email, date}
}

export async function givingFormLiveBrowser(h, campaign, {sessions, waitPaid, verify, stage, providerRefusal}) {
 const results = []
 await withBrowserWorker(h, async (provided, origin) => {
  // The helper context lacks ignoreHTTPSErrors. Its browser and server stay owned
  // by the helper; this fresh context accepts only the local TLS test setup.
  const context = await provided.browser().newContext({ignoreHTTPSErrors: true, viewport: {width: 1440, height: 1000}})
  let host, page
  try {
   await context.route('https://challenges.cloudflare.com/turnstile/**', route => route.fulfill({contentType: 'application/javascript', body: `for(const widget of document.querySelectorAll('.cf-turnstile')){const input=document.createElement('input');input.type='hidden';input.name='cf-turnstile-response';input.value='${token}';widget.append(input)}`}))
   await context.addCookies(await provided.cookies())
   context.on('response', async response => {
    if (new URL(response.url()).origin !== 'https://api.stripe.com' || response.status() < 400) return
    try {providerRefusal(response.status(), (await response.json())?.error)} catch {}
   })
   page = await context.newPage()
   page.setDefaultTimeout(30000)
   stage('configure-native-form')
   await configure(page, origin, campaign)
   host = createServer((_request, response) => {
    response.writeHead(200, {'content-type': 'text/html'})
    response.end(`<!doctype html><html lang="en"><head><title>Riverbend community website</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><h1 style="font:24px Arial;padding:16px">Riverbend community appeal</h1><script src="${origin}/give/${campaign.slug}/embed.js" async></script></body></html>`)
   })
   await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
   const hostOrigin = `http://127.0.0.1:${host.address().port}`
   for (const width of [1440, 390]) for (const surface of ['hosted', 'embedded']) {
    const label = 'synthetic-coffer-' + width + '-' + surface
    stage('form-' + width + '-' + surface)
    await page.setViewportSize({width, height: 1000})
    await page.goto(surface === 'hosted' ? origin + '/give/' + campaign.slug : hostOrigin)
    const form = surface === 'hosted' ? page : page.frameLocator('iframe')
    await form.getByRole('heading', {name: 'Give local readers a new chapter', exact: true}).waitFor()
    const child = surface === 'hosted' ? page.mainFrame() : page.frames().find(frame => new URL(frame.url()).searchParams.get('embed') === '1')
    assert.ok(child, 'The real hosted or script-embedded form loaded')
    assert.equal(await child.locator('header img').getAttribute('src'), '/give/' + campaign.slug + '/media/image')
    assert.equal(await child.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(243, 246, 238)')
    const details = await completeForm(page, form, label)
    await child.evaluate(axe)
    const violations = await child.evaluate(async () => (await window.axe.run(document.querySelector('.donation'), {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']}})).violations.map(v => v.id))
    assert.deepEqual(violations, [], 'The real form passes axe WCAG AA')
    assert.ok(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const before = new Set(sessions.keys())
    stage('create-checkout-' + width + '-' + surface)
    await form.getByRole('button', {name: 'Continue to secure checkout'}).click()
    await page.waitForURL(url => url.hostname === 'checkout.stripe.com')
    const created = [...sessions.values()].filter(session => !before.has(session.id))
    assert.equal(created.length, 1, 'Exactly one real Stripe Checkout Session was created')
    assert.equal(created[0].amount_total, 5000)
    stage('stripe-payment-fields-' + width + '-' + surface)
    await pay(page, label, details.email)
    stage('stripe-paid-' + width + '-' + surface)
    const session = await waitPaid(created[0].id)
    // Stripe's success URL uses the Miniflare HTTPS listener. Open the same
    // actual thanks door on the helper HTTP server once Stripe confirms paid.
    await page.goto(origin + '/giving/thanks?session_id=' + encodeURIComponent(session.id))
    await page.getByRole('heading', {name: 'Thank you for your gift', exact: true}).waitFor()
    stage('coffer-verification-' + width + '-' + surface)
    const outcome = await verify({width, surface, label, ...details, session})
    results.push(outcome)
   }
  } catch(error) {
   if(page&&!page.isClosed())await page.screenshot({path:process.env.COFFER_LIVE_SCREENSHOT_PATH??'.cache/giving-form-live-failure.png',fullPage:true})
   throw error
  } finally {
   await context.close()
   if (host?.listening) await new Promise(resolve => host.close(resolve))
  }
 })
 return results
}
