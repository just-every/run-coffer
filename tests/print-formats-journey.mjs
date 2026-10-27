import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { unzipSync, strFromU8 } from 'fflate'
import { run, donor, reviewed, settings } from './harness.mjs'
import { withBrowserWorker } from './browser-worker.mjs'

// Read the downloaded document, independently of the application's layout code.
export async function readPrintPdf(bytes) {
 const pdf = await PDFDocument.load(bytes)
 const pages = pdf.getPages().map(page => {
  const resources = page.node.Resources()
  const fonts = resources.lookup(PDFName.of('Font'), PDFDict)
  const firstFont = pdf.context.lookup(fonts.entries()[0][1], PDFDict)
  const cmap = strFromU8(decodePDFRawStream(firstFont.lookup(PDFName.of('ToUnicode'), PDFRawStream)).decode())
  const characters = new Map([...cmap.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)].map(match => [match[1].toUpperCase(), Buffer.from(match[2], 'hex').swap16().toString('utf16le')]))
  const contents = page.node.Contents()
  const refs = typeof contents.asArray === 'function' ? contents.asArray() : [contents]
  const operators = refs.map(ref => strFromU8(decodePDFRawStream(pdf.context.lookup(ref, PDFRawStream)).decode())).join('\n')
  const text = [...operators.matchAll(/([-\d.]+) ([-\d.]+) Tm\s*<([0-9a-f]*)> Tj/gi)].map(match => ({ x: Number(match[1]), y: Number(match[2]), text: (match[3].match(/.{4}/g) ?? []).map(code => characters.get(code.toUpperCase()) ?? '').join('') }))
  return { width: page.getWidth(), height: page.getHeight(), text }
 })
 return { pdf, pages }
}

async function downloadedPdf(h, path) {
 const response = await h.request(path)
 assert.equal(response.status, 200, response.status === 200 ? '' : await response.text())
 assert.match(response.headers.get('content-type'), /^application\/pdf/)
 assert.match(response.headers.get('content-disposition'), /attachment/)
 const bytes = new Uint8Array(await response.arrayBuffer())
 assert.equal(strFromU8(bytes.slice(0, 5)), '%PDF-')
 return readPrintPdf(bytes)
}

export async function printFormatsJourney() {
 await run(async h => {
  await reviewed(h)
  const recipients = Array.from({ length: 31 }, (_, index) => `María Avery ${String(index + 1).padStart(2, '0')}`)
  const donors = []
  for (const name of recipients) {
   const d = await donor(h, name, { email: null, addressLine1: '31 Main Street', addressLine2: 'Suite 4', city: 'Springfield', region: 'IL', postalCode: '62701' })
   donors.push(d)
   await h.command('gift.record', { donorId: d.id, amount: '250', receivedOn: `2025-08-${String(donors.length).padStart(2,'0')}`, method: 'check', goods: 'none' })
  }
  const batch = await h.command('ack.prepare', { onePiecePer: 'gift' })
  const base = `/app/letters/${batch.id}`
  for (const suffix of ['letters.pdf', 'merge.zip', 'merge.docx', 'print?labels=1', 'print?envelopes=1']) assert.equal((await h.request(`${base}/${suffix}`)).status, 409)
  await h.command('ack.approve', { batchId: batch.id, version: 1 })
  const pdf = await downloadedPdf(h, `${base}/letters.pdf`)
  assert.equal(pdf.pages.length, 31)
  assert.deepEqual(pdf.pages.map(page => page.text.find(item => /^María Avery /.test(item.text))?.text), recipients)
  for (const page of pdf.pages) {
   assert.equal(page.width, 612); assert.equal(page.height, 792)
   assert.ok(page.text.some(item=>item.text===settings.organisation),'Every first page carries the letterhead')
   assert.ok(page.text.some(item=>item.text.includes('$250.00')),'The exported letter retains its actual gift amount')
   assert.ok(page.text.some(item=>item.text.includes(settings.ein)),'The exported receipt retains the organization EIN')
   const name = page.text.find(item => /^María Avery /.test(item.text))
   assert.equal(name.x, 57.6); assert.equal(name.y, 648)
   assert.ok(page.text.some(item => item.text === '31 Main Street'))
   assert.ok(page.text.some(item => item.text === 'Suite 4'))
   assert.ok(page.text.some(item => item.text === 'Springfield IL 62701'))
   assert.ok(page.text.some(item => /No goods or services/.test(item.text)))
  }
  const labels = await downloadedPdf(h, `${base}/letters.pdf?labels=1`)
  assert.equal(labels.pages.length, 2)
  assert.equal(labels.pages[0].text.filter(item => /^María Avery /.test(item.text)).length, 30)
  assert.equal(labels.pages[1].text.filter(item => /^María Avery /.test(item.text)).length, 1)
  assert.deepEqual(labels.pages.flatMap(page => page.text.filter(item => /^María Avery /.test(item.text)).map(item => item.text)), recipients)
  assert.equal(labels.pages[0].text.find(item => item.text === recipients[1]).x - labels.pages[0].text.find(item => item.text === recipients[0]).x, 198)
  assert.equal(labels.pages[0].text.find(item => item.text === recipients[0]).y - labels.pages[0].text.find(item => item.text === recipients[3]).y, 72)
  const envelopes = await downloadedPdf(h, `${base}/letters.pdf?envelopes=1`)
  assert.equal(envelopes.pages.length, 31)
  for (const page of envelopes.pages) {
   assert.equal(page.width, 684); assert.equal(page.height, 297)
   const address = page.text.find(item => /^María Avery /.test(item.text))
   assert.equal(address.x, 270); assert.equal(address.y, 171)
  }
  const word = await h.request(`${base}/merge.zip`)
  assert.equal(word.status, 200)
  assert.match(word.headers.get('content-type'), /^application\/zip/)
  const files = unzipSync(new Uint8Array(await word.arrayBuffer()))
  const template = unzipSync(files['letter-template.docx'])
  const main = strFromU8(template['word/document.xml'])
  for (const field of ['Organisation', 'RecipientName', 'PostalAddress', 'Subject', 'ReceiptText']) assert.ok(main.includes(`MERGEFIELD ${field}`))
  assert.match(strFromU8(template['word/settings.xml']), /<w:mailMerge>/)
  assert.match(strFromU8(template['word/_rels/settings.xml.rels']), /Target="recipients.docx"/)
  const source = strFromU8(unzipSync(files['recipients.docx'])['word/document.xml'])
  assert.equal((source.match(/<w:tr>/g) ?? []).length, 32)
  for (const name of recipients) assert.ok(source.includes(name))
  const frozen = strFromU8(unzipSync(files['frozen-letters.docx'])['word/document.xml'])
  assert.equal((frozen.match(/w:type="page"/g) ?? []).length, 30)
  for (const name of recipients) assert.ok(frozen.includes(name))
  assert.ok(frozen.includes('No goods or services'));assert.equal((frozen.match(/\$250\.00/g)??[]).length,31,'Each merged Word letter retains its gift amount')
  const single = await h.request(`${base}/merge.docx`)
  assert.equal(single.status, 200)
  assert.ok(unzipSync(new Uint8Array(await single.arrayBuffer()))['word/document.xml'])
  const member = await h.person('print-entry@example.test')
  for (const suffix of ['letters.pdf', 'merge.zip', 'merge.docx', 'print?labels=1', 'print?envelopes=1']) {
   assert.equal((await h.request(`${base}/${suffix}`, { as: member.cookie })).status, 403)
   assert.ok([302, 303, 401].includes((await h.request(`${base}/${suffix}`, { as: '' })).status))
  }
  // One long frozen letter must continue and retain its final sentence.
  await h.command('settings.update', { ...settings, version: (await h.get('/api/coffer/settings')).version, letterTemplate: settings.letterTemplate+'\n' + 'Continuation proof: a complete sentence survives pagination.\n'.repeat(110) + 'Final frozen paragraph.' })
  const gift = await h.command('gift.record', { donorId: donors[0].id, amount: '250', receivedOn: '2025-08-11', method: 'check', goods: 'none' })
  const long = await h.command('ack.prepare', { giftIds: [gift.id], onePiecePer: 'gift' })
  await h.command('ack.approve', { batchId: long.id, version: 1 })
  const continuation = await downloadedPdf(h, `/app/letters/${long.id}/letters.pdf`)
  assert.ok(continuation.pages.length > 1)
  assert.equal(continuation.pages.flatMap(page => page.text).filter(item => item.text === 'Continuation proof: a complete sentence survives pagination.').length, 110)
  assert.ok(continuation.pages.at(-1).text.some(item => item.text === 'Final frozen paragraph.'))
  assert.ok(continuation.pages.every(page => page.text.every(item => item.y >= 54)))
  await printFormatsBrowser(h, { batchId: batch.id, directory: process.env.COFFER_PRINT_BROWSER??'.cache/print-formats' })
 })
}

export async function printFormatsBrowser(h, { batchId, directory }) {
 await mkdir(directory, { recursive: true })
 await withBrowserWorker(h, async (context, origin) => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto(`${origin}/app/letters/${batchId}/print?labels=1`)
  await page.emulateMedia({ media: 'print' })
  const labels = await page.locator('.label').evaluateAll(items => items.map(item => { const box = item.getBoundingClientRect(); return { width: box.width, height: box.height } }))
  assert.equal(labels.length, 31)
  assert.ok(labels.every(box => Math.abs(box.width - 252) < .1 && Math.abs(box.height - 96) < .1))
  assert.deepEqual(await page.locator('.label-sheet').evaluateAll(sheets => sheets.map(sheet => sheet.children.length)), [30, 1])
  assert.equal((await PDFDocument.load(await page.pdf({ preferCSSPageSize: true }))).getPageCount(), 2)
  await page.goto(`${origin}/app/letters/${batchId}/print?envelopes=1`)
  const envelope = await page.locator('.envelope').first().boundingBox()
  const address = await page.locator('.envelope .recipient').first().boundingBox()
  assert.ok(Math.abs(envelope.width - 912) < .1 && Math.abs(envelope.height - 396) < .1)
  assert.ok(Math.abs(address.x - envelope.x - 360) < .1)
  const printedEnvelopes = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true }))
  assert.equal(printedEnvelopes.getPageCount(), 31)
  assert.ok(Math.abs(printedEnvelopes.getPage(0).getWidth() - 684) < .2)
  assert.ok(Math.abs(printedEnvelopes.getPage(0).getHeight() - 297) < .2)
  await page.emulateMedia({ media: 'screen' })
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 1000 })
   for (const format of ['labels', 'envelopes']) {
    await page.goto(`${origin}/app/letters/${batchId}/print?${format}=1`)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${directory}/RCPT-003-${format}-${width}.png` })
   }
  }
 })
}
