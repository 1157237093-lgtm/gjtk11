import { chromium } from 'playwright-core';
const browser = await chromium.launch({headless:true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page = await browser.newPage();
await page.goto('file:///Users/a66/Documents/Codex/2026-04-20-1-2-3-4-5-6/index.html', {waitUntil:'load'});
await page.waitForTimeout(2000);
const result = await page.evaluate(() => ({
  status: document.querySelector('#import-folder-status')?.textContent || '',
  cards: document.querySelectorAll('.paper-card').length,
  titles: [...document.querySelectorAll('.paper-card h3')].map((el) => el.textContent),
  summary: [...document.querySelectorAll('#global-summary .summary-card')].map((el) => el.textContent.trim()),
}));
console.log(JSON.stringify(result,null,2));
await browser.close();
