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
  assert.equal(await page.locator('.metric').nth(3).locator('.big').innerText(), '33%');
  assert.equal(await page.locator('.callout strong').innerText(), '–6.6%');
  assert.match(await page.locator('.customer tbody tr').nth(1).innerText(), /9%/);

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
  assert.deepEqual(axes.gap, { min:-40, max:10 });
  assert.equal(await page.locator('#salesChart path[fill]:not([fill="none"])').count(),0,'Main chart must not contain a filled area');
  assert.equal(await page.locator('#salesChart .week-selection').count(),0,'Selected weeks must not use shaded bands');
  assert.equal(await page.locator('.mainchart .legend .gap').count(),0,'Removed area shading must not remain in the legend');
  assert.equal(await page.locator('#salesChart text').filter({hasText:'Downward breakpoint'}).count(),1);
  assert.equal(await page.locator('#salesChart .breakpoint-arrow').textContent(),'↓');

  await page.locator('#salesChart .chart-hit[data-week="15"]').click();
  await page.locator('#salesChart .chart-hit[data-week="23"]').click();
  assert.ok((await page.locator('#selectionSummary').innerText()).includes('W15'));
  assert.equal(await page.locator('#salesChart [data-selected-week="15"]').count(),1);
  assert.equal(await page.locator('#salesChart [data-selected-week="23"]').count(),0);
  assert.equal(await page.locator('#gapChart rect[data-week="W15"]').count(),1);
  assert.equal(await page.locator('#gapChart rect[data-week="W23"]').count(),0);
  assert.ok(await page.locator('#heatgrid .cell[data-week="15"]').count()>0);
  assert.equal(await page.locator('#heatgrid .cell[data-week="23"]').count(),0);

  const selectionBox=await chart.boundingBox(),plotX=index=>selectionBox.x+(34+index*((553-34)/15))/660*selectionBox.width;
  await page.mouse.move(plotX(2)-2,selectionBox.y+45);
  await page.mouse.down();
  await page.mouse.move(plotX(4)+2,selectionBox.y+70,{steps:8});
  await page.mouse.up();
  assert.equal(await page.locator('#selectionSummary').innerText(),'W16–W18 · 3 weeks');
  assert.equal(await page.locator('#salesChart [data-selected-week]').count(),3);
  assert.equal(await page.locator('#gapChart rect[data-week]').count(),3);
  assert.equal(await page.locator('#heatgrid .cell').count(),18);
  assert.equal(await page.locator('.metric').first().locator('.big').innerText(),'–$2.0M');
  assert.ok(await page.locator('.card').evaluateAll(cards=>cards.every(card=>card.dataset.weeks==='16,17,18'&&card.dataset.gaps.split(',').length===3)));

  await page.evaluate(()=>setSelectedWeeks([14,15],'Positive-period test'));
  assert.equal(await page.locator('#selectionSummary').innerText(),'W14–W15 · 2 weeks');
  assert.equal(await page.locator('.metric').first().locator('.big').innerText(),'+$3.0M');
  assert.ok(await page.locator('.metric').first().locator('.big').evaluate(el=>el.classList.contains('green')&&!el.classList.contains('red')));
  assert.ok(await page.locator('.callout strong').evaluate(el=>el.classList.contains('green')&&!el.classList.contains('red')));

  await page.locator('.since').click();
  assert.equal(await page.locator('#selectionSummary').innerText(),'W22–W29 · 8 weeks');

  await page.locator('#gapChart rect[data-week="W29"]').click();
  assert.ok(await page.locator('#gapChart rect[data-week="W29"]').evaluate(el => el.classList.contains('selected')));
  await page.locator('.heatgrid .cell').first().click();
  assert.ok(await page.locator('.heatgrid .cell').first().evaluate(el => el.classList.contains('selected')));

  const attributionExpectations = { Customer:'Walmart', Brand:'Febreze', Category:'Laundry', Geography:'South' };
  for (const [dimension,firstMember] of Object.entries(attributionExpectations)) {
    await page.locator('.choice', { hasText:dimension }).click();
    assert.equal(await page.locator('#contributionTitle').innerText(), `${dimension} Contribution`);
    assert.match(await page.locator('#contributionBody tr').first().innerText(), new RegExp(firstMember));
    assert.equal(await page.locator('#heatgrid .rlabel').first().innerText(), firstMember);
    assert.equal(await page.locator('#selectedDimension').innerText(), dimension);
    assert.equal(await page.locator('.customername').innerText(), firstMember);
    const sharesMatchWarehouse=await page.locator('#contributionBody tr').evaluateAll((rows,dimension)=>rows.every(row=>{const source=window.CORTEX_DATA.attribution[dimension].rows.find(item=>item.name===row.dataset.name),text=row.children[2].textContent.trim();return source.share==null?!text.includes('%'):Number.parseInt(text)===source.share}),dimension);
    assert.ok(sharesMatchWarehouse,`${dimension} shares must use the complete warehouse negative-drag denominator`);
  }
  await page.locator('.choice', { hasText:'Brand' }).click();
  await page.locator('#contributionBody tr[data-name="Swiffer"]').click();
  assert.equal(await page.locator('.customername').innerText(), 'Swiffer');
  assert.ok(await page.locator('.chips .chip',{hasText:'Brand',exact:true}).isDisabled());
  const signatures=[];
  const expectedCardCounts={Category:5,Geography:4,Segment:3};
  for (const split of ['Category','Geography','Segment']) {
    await page.locator('.chips .chip', { hasText:split, exact:true }).click();
    assert.equal(await page.locator('.card').count(), expectedCardCounts[split]);
    const coherent = await page.locator('.card').evaluateAll(cards => cards.every(card => {
      const gaps=card.dataset.gaps.split(',').map(Number),actual=card.dataset.actual.split(',').map(Number),expected=card.dataset.expected.split(',').map(Number),impact=Number(card.dataset.impact),current=Number(card.dataset.current);
      return Math.abs(gaps.reduce((a,b)=>a+b,0)-impact)<0.011 && gaps.length===8 && Math.abs(gaps.at(-1)-current)<0.001 && gaps.every((gap,index)=>Math.abs((actual[index]-expected[index])-gap)<0.011);
    }));
    assert.ok(coherent, `${split} cards must reconcile Actual, Expected, weekly gap, current gap, and cumulative impact`);
    const signature=await page.locator('.card').evaluateAll(cards=>cards.map(card=>`${card.querySelector('.brandrow').textContent.trim()}:${card.dataset.gaps}`).join('|'));
    signatures.push(signature);
    const axesAutoNarrow=await page.locator('.card').evaluateAll(cards=>cards.every(card=>{const values=[...card.dataset.actual.split(','),...card.dataset.expected.split(',')].map(Number),min=Number(card.dataset.yMin),max=Number(card.dataset.yMax),rawMin=Math.min(...values),rawMax=Math.max(...values);return min<=rawMin&&max>=rawMax&&min>0&&(max-min)<Math.max(1,(rawMax-rawMin)*2.5)}));
    assert.ok(axesAutoNarrow,`${split} card axes must auto-narrow around their own visible values without forcing zero`);
    const uniqueDomains=await page.locator('.card').evaluateAll(cards=>new Set(cards.map(card=>`${card.dataset.yMin}:${card.dataset.yMax}`)).size);
    assert.ok(uniqueDomains>1,`${split} cards must calculate local Y-axis domains independently`);
    const normalizedShapes=await page.locator('.card').evaluateAll(cards=>new Set(cards.map(card=>{const gaps=card.dataset.gaps.split(',').map(Number),scale=Math.max(...gaps.map(Math.abs),.01);return gaps.map(value=>(value/scale).toFixed(2)).join(',')})).size);
    assert.ok(normalizedShapes>1,`${split} cards must contain distinct dimensional trend shapes, not proportional templates`);
  }
  assert.equal(new Set(signatures).size,signatures.length,'Each split must render different members and weekly data');
  await page.locator('.choice',{hasText:'Customer'}).click();
  await page.locator('.chips .chip',{hasText:'Brand',exact:true}).click();
  assert.equal(await page.locator('.card').first().locator('.brandrow').innerText(),'Tide');
  await page.locator('.edit').click();
  assert.ok(await page.locator('#timeModal').evaluate(el => el.classList.contains('show')));
  await page.keyboard.press('Escape');
  assert.ok(!(await page.locator('#timeModal').evaluate(el => el.classList.contains('show'))));

  console.log(JSON.stringify({ status:'PASS', tooltip:tooltipText.replace(/\n/g,' | '), axes, geometry, logos:images.length, errors }, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
