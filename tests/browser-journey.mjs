import assert from 'node:assert/strict'
import {chromium} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

// A development lead's first week, through the real pages: review the letter
// wording, move a year of Stripe gifts in, record consent, send letters and an
// appeal, hand an agent a key and erase a donor on request.
export async function browserJourney(openUrl,{directory='.cache/browser',fixtures='tests/fixtures/stripe'}={}) {
 await mkdir(directory,{recursive:true})
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 let stage='open app'
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true})
  const page=await context.newPage()
  await page.goto(openUrl)
  await page.waitForURL(url=>['/setup','/app'].includes(url.pathname))
  if(new URL(page.url()).pathname==='/setup') {await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Finish setup'}).click()}
  await page.waitForURL('**/app')
  const shot=async name=>{
   stage=name
   for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${name} fits ${width}px`)
    await page.screenshot({path:join(directory,`${name}-${width}.png`),fullPage:true,...(name==='13-agent-key'?{mask:[page.locator('pre')]}:{})})
   }
   await page.setViewportSize({width:1440,height:1000})
  }
  const click=async name=>{await page.getByRole('button',{name,exact:true}).click();await page.waitForLoadState('domcontentloaded')}
  const go=async label=>{await page.getByRole('navigation',{name:'Main'}).getByRole('link',{name:label}).click();await page.waitForLoadState('domcontentloaded')}
  await shot('01-today')

  stage='settings'
  await go('More');await page.getByRole('link',{name:/Letter settings/}).click()
  await page.getByLabel('Organization name',{exact:true}).fill('Riverbend Literacy Project')
  await page.getByLabel('EIN',{exact:true}).fill('12-3456789')
  await click('Save settings');await page.getByText('Settings saved.').waitFor();await shot('02-settings')

  stage='move in'
  await go('More');await page.getByRole('link',{name:/Move in from Stripe/}).click()
  await page.getByText('Advanced: upload saved Stripe JSON',{exact:true}).click()
  await page.getByLabel('Customer pages (.json)',{exact:true}).setInputFiles(join(fixtures,'customers.json'))
  await page.getByLabel('Charge pages (.json)',{exact:true}).setInputFiles([join(fixtures,'charges-2025-q4.json'),join(fixtures,'charges-2026.json')])
  await page.locator('form[action="/app/move-in/preview"]').getByLabel(/These payments were donations/).check()
  await click('Preview saved files');await page.getByText('7 new donors and 15 gifts').waitFor();await shot('03-move-in-preview')
  await page.getByLabel('I approve adding exactly these donors, gifts and monthly plans.',{exact:true}).check()
  await click('Apply the move-in');await page.getByText('Applied').first().waitFor();await shot('04-move-in-journal')

  stage='consent'
  await go('Donors');await page.getByText('7 donors').waitFor()
  for(const name of ['Maya Okafor','Daniel Reyes','Priya Shah'])await page.getByLabel(`Select ${name}`,{exact:true}).check()
  await page.getByLabel('Evidence',{exact:true}).fill('Ticked “Keep me posted by email” on the 2026 gala RSVP card (office file)')
  await click('Record consent');await page.getByText('Consent recorded for 3 donors.').waitFor();await shot('05-donors')

  stage='donor history'
  await page.getByRole('link',{name:'Priya Shah'}).click();await page.waitForLoadState('domcontentloaded')
  await page.getByLabel('Amount (USD)',{exact:true}).first().fill('500')
  await page.getByLabel('Check number or reference',{exact:true}).fill('Check 1042')
  await page.getByLabel('No goods or services',{exact:true}).first().check()
  await click('Record gift');await page.getByRole('cell',{name:'$500.00'}).first().waitFor();await shot('06-donor-history')

  stage='letters'
  await go('Letters');await shot('07-letters-due')
  await page.getByRole('button',{name:/^Prepare \d+ letters$/}).click();await page.waitForLoadState('domcontentloaded')
  await page.getByText('Waiting for approval').first().waitFor();await shot('08-letters-prepared')
  await click('Approve these letters');await click('Export letters (CSV)')
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download letters (CSV)'}).click()
  assert.match((await download).suggestedFilename(),/^coffer-letters-.*\.csv$/)
  await click('Record all letters as printed');await page.getByText(/Printed /).first().waitFor();await shot('09-letters-printed')

  stage='appeal'
  await go('Appeals');await page.getByLabel('Appeal name',{exact:true}).fill('Fall 2026 reading appeal')
  await click('Prepare audience');await page.getByText('3 recipients').first().waitFor();await shot('10-appeal-prepared')
  await click('Approve this audience');await click('Export audience');await click('Record as sent')
  await page.getByText(/^Sent on/).waitFor();await shot('11-appeal-sent')

  stage='data and access'
  await go('More');await page.getByRole('link',{name:/Data & access/}).click();await shot('12-data-access')
  await page.getByLabel('What the agent is for',{exact:true}).fill('Weekly letters assistant');await click('Create key')
  await page.getByText('It will not be shown again').waitFor();await shot('13-agent-key')

  stage='erase'
  await go('Donors');await page.getByRole('link',{name:'Samuel Ortiz'}).click();await page.waitForLoadState('domcontentloaded')
  await page.getByLabel('Type ERASE to confirm',{exact:true}).fill('ERASE');await click('Erase donor')
  await page.getByText(/This donor was erased on/).waitFor();await shot('14-donor-erased')
  return {origin:new URL(page.url()).origin}
 } catch(error) {error.message=`Browser journey failed at ${stage}: ${error.message}`;throw error}
 finally{await browser.close()}
}
