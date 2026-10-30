import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
 const page = await browser.newPage();
 await page.goto('data:text/html,<title>Chromium launch probe</title>');
 if (await page.title() !== 'Chromium launch probe') throw Error('Chromium probe failed');
} finally {
 await browser.close();
}
