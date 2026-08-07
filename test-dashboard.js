const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1152, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const response = await page.goto('http://127.0.0.1:4173/?test=1', { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  assert.equal(await page.title(), 'Total Business Dashboard');
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(await page.locator('.metric').nth(3).locator('.big').innerText(), '32%');
  assert.equal(await page.locator('.callout strong').innerText(), '–26%');
  assert.match(await page.locator('.customer tbody tr').nth(1).innerText(), /10%/);

  const geometry = await page.evaluate(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top:r.top, bottom:r.bottom, height:r.height }; };
    return { overview:rect('.overview'), section2:rect('.section2'), bottom:rect('.bottom'), customer:rect('.customer'), heat:rect('.heat') };
  });
  assert.equal(geometry.overview.bottom, geometry.section2.top);
  assert.equal(geometry.section2.bottom, geometry.bottom.top);
  assert.ok(geometry.customer.bottom <= geometry.section2.bottom);
  assert.ok(geometry.heat.bottom <= geometry.section2.bottom);

  const images = await page.locator('img').evaluateAll(items => items.map(img => img.complete && img.naturalWidth > 0));
  assert.ok(images.every(Boolean), 'Every logo must load');

  const chart = page.locator('#salesChart');
  const box = await chart.boundingBox();
  const w24X = box.x + (34 + 10 * ((553 - 34) / 15)) / 660 * box.width;
  await page.mouse.move(w24X, box.y + 48);
  const tooltip = page.locator('#tooltip');
  await tooltip.waitFor({ state: 'visible' });
  const tooltipText = await tooltip.innerText();
  assert.match(tooltipText, /Week 24/);
  assert.match(tooltipText, /Actual sales: \$59\.9M/);
  assert.match(tooltipText, /Expected sales: \$65\.0M/);
  assert.match(tooltipText, /Gap: –\$5\.1M/);
  const axes = await page.evaluate(() => ({
    sales: { min:Number(document.querySelector('#salesChart').dataset.yMin), max:Number(document.querySelector('#salesChart').dataset.yMax) },
    gap: { min:Number(document.querySelector('#gapChart').dataset.yMin), max:Number(document.querySelector('#gapChart').dataset.yMax) },
  }));
  assert.deepEqual(axes.sales, { min:45, max:70 });
  assert.deepEqual(axes.gap, { min:-40, max:0 });

  await page.locator('#gapChart rect[data-week="W29"]').click();
  assert.ok(await page.locator('#gapChart rect[data-week="W29"]').evaluate(el => el.classList.contains('selected')));
  await page.locator('.heatgrid .cell[data-value="-3.0"]').first().click();
  assert.ok(await page.locator('.heatgrid .cell[data-value="-3.0"]').first().evaluate(el => el.classList.contains('selected')));
  await page.locator('.edit').click();
  assert.ok(await page.locator('#timeModal').evaluate(el => el.classList.contains('show')));
  await page.keyboard.press('Escape');
  assert.ok(!(await page.locator('#timeModal').evaluate(el => el.classList.contains('show'))));

  console.log(JSON.stringify({ status:'PASS', tooltip:tooltipText.replace(/\n/g,' | '), axes, geometry, logos:images.length, errors }, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
