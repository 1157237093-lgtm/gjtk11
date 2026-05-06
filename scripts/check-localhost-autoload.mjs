import { chromium } from 'playwright-core';
const browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage();
await page.goto('http://localhost:8080/index.html', {waitUntil:'load'});
await page.waitForTimeout(2000);
const result = await page.evaluate(() => ({
  status: document.querySelector('#import-folder-status')?.textContent || '',
  cards: document.querySelectorAll('.paper-card').length,
  titles: [...document.querySelectorAll('.paper-card h3')].map((el) => el.textContent),
  hasWrongBook: !!document.querySelector('#open-wrong-book'),
}));
console.log(JSON.stringify(result, null, 2));
await browser.close();
