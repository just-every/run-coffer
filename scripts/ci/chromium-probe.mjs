import { chromium } from '@playwright/test';

let browser;
try {
 browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
 const page = await browser.newPage();
 await page.goto('data:text/html,<title>Chromium launch probe</title>');
 if (await page.title() !== 'Chromium launch probe') throw Error('Chromium probe failed');
} catch (error) {
 console.error(error);
 process.exitCode = /EACCES|permission denied/i.test(String(error)) ? 77 : 1;
} finally {
 await browser?.close();
}
