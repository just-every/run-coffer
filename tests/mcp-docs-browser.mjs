import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve, extname } from 'node:path'
import { chromium } from '@playwright/test'

/** The emitted site and its real docs navigation, without a page or route fake. */
export async function mcpDocsBrowser(directory = '.cache/mcp-docs') {
 const root = resolve('dist/site')
 const server = createServer(async (request, response) => {
  try {
   const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
   const file = resolve(root, '.' + path + (extname(path) ? '' : path === '/' ? 'index.html' : '.html'))
   if (!file.startsWith(root + '/')) { response.writeHead(404); response.end(); return }
   const bytes = await readFile(file)
   response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream' })
   response.end(bytes)
  } catch { response.writeHead(404); response.end('Not found') }
 })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
 const origin = 'http://127.0.0.1:' + server.address().port
 await mkdir(directory, { recursive: true })
 let browser
 try {
  browser = await chromium.launch({
   headless: true,
   ...(process.env.COFFER_CHROMIUM_PATH ? { executablePath: process.env.COFFER_CHROMIUM_PATH } : {}),
   args: [...(process.env.COFFER_CHROMIUM_PATH ? ['--no-sandbox'] : []), '--use-mock-keychain', '--password-store=basic'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  await page.goto(origin + '/docs')
  await page.getByRole('link', { name: /MCP for assistants/ }).click()
  await page.getByRole('heading', { name: 'MCP for assistants', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/docs/agents')
  const blocks = await page.locator('.docs-prose code.language-json').allTextContents()
  const values = blocks.map(text => JSON.parse(text))
  const profiles = values.filter(value => value.profile)
  assert.deepEqual(profiles.map(value => value.profile), ['preparation-key', 'named-grant'])
  const descriptors = values.filter(value => value.inputSchema)
  for (const profile of profiles) {
   for (const name of profile.tools) {
    const tool = descriptors.find(value => value.name === name)
    assert.ok(tool?.inputSchema && tool.outputSchema && tool._meta.nativeAction, 'The built page contains every documented schema and native binding')
   }
   assert.ok(profile.resourceTemplates.length)
  }
  const resourceNames = profiles[0].resourceTemplates.map(value => value.name)
  assert.deepEqual(profiles[1].resourceTemplates.map(value => value.name), resourceNames)
  // Read a real generated schema and navigate to it entirely with the keyboard.
  const link = page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Tools by native job', exact: true })
  await link.focus()
  await page.keyboard.press('Enter')
  assert.equal(new URL(page.url()).hash, '#tools-by-native-job')
  const firstSchema = page.locator('.docs-prose code.language-json').filter({ hasText: '"inputSchema"' }).first()
  assert.ok((await firstSchema.textContent()).includes('"outputSchema"'))
  await page.addScriptTag({ content: await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8') })
  const violations = await page.evaluate(async () => (await window.axe.run(document, {
   runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  })).violations.map(value => ({ id: value.id, targets: value.nodes.map(node => node.target) })))
  assert.deepEqual(violations, [], 'The populated docs page passes WCAG AA checks')
  const undersized = await page.locator('.docs-prose').evaluate(root => [...root.querySelectorAll('*')].filter(element => {
   const style = getComputedStyle(element)
   return element.textContent.trim() && element.getClientRects().length && style.visibility !== 'hidden' && parseFloat(style.fontSize) < 13
  }).map(element => element.tagName))
  assert.deepEqual(undersized, [], 'Documentation text remains readable')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The page fits the desktop')
  await page.getByRole('heading', { name: 'Catalog profiles', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: directory + '/agents-1440.png' })
  // One narrow proof of the same populated page; behavior assertions run once.
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.goto(origin + '/docs/agents')
  const menu = page.locator('.docs-menu summary')
  await menu.focus()
  await page.keyboard.press('Enter')
  await page.locator('.docs-menu a[aria-current="page"]').waitFor({ state: 'visible' })
  await page.keyboard.press('Enter')
  await page.goto(origin + '/docs/agents#catalog-profiles')
  await page.getByRole('heading', { name: 'Catalog profiles', exact: true }).scrollIntoViewIfNeeded()
  console.log('MCP docs narrow layout: ' + JSON.stringify(await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth }))))
  await page.screenshot({ path: directory + '/agents-390.png' })
  console.log('MCP docs browser passed: emitted route, populated inventories, schemas, keyboard navigation, axe and 1440/390 proof')
  await context.close()
 } finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
 }
}
