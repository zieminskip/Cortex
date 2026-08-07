const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1152, height: 768 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', error => errors.push(`page: ${error.message}`));
  page.on('response', response => { if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`); });
  page.on('requestfailed', request => errors.push(`request failed: ${request.url()} (${request.failure()?.errorText})`));
  await page.goto('http://127.0.0.1:4173/?capture=1', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'dashboard-current.png' });
  const chart = page.locator('#salesChart');
  await chart.screenshot({ path: 'chart-current.png' });
  const box = await chart.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.45);
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'dashboard-hover.png' });
  }
  const geometry = await page.evaluate(() => Object.fromEntries(['.overview','.section2','.bottom','.customer','.heat'].map(selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return [selector, { top: r.top, bottom: r.bottom, height: r.height }];
  })));
  const images = await page.locator('img').evaluateAll(items => items.map(img => ({ alt: img.alt, loaded: img.complete && img.naturalWidth > 0, width: img.naturalWidth })));
  console.log(JSON.stringify({ title: await page.title(), url: page.url(), chartBox: box, geometry, images, errors }, null, 2));
  await browser.close();
})();
