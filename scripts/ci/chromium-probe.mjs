import { chromium } from '@playwright/test';

let browser;
try {
 browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
} catch (error) {
 console.error(error);
 process.exit(/EACCES|permission denied/i.test(String(error)) ? 77 : 1);
}
try {
 const page = await browser.newPage();
 await page.goto('data:text/html,<title>Chromium launch probe</title>');
 if (await page.title() !== 'Chromium launch probe') throw Error('Chromium probe failed');
} finally {
 await browser.close();
}
