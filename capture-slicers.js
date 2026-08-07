const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless:true });
  const page = await browser.newPage({ viewport:{ width:1152, height:768 } });
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
  await page.goto('http://127.0.0.1:4173/?slicer-capture=1',{waitUntil:'networkidle'});
  for(const dimension of ['Customer','Brand','Category','Geography']){
    await page.locator('.choice',{hasText:dimension}).click();
    await page.screenshot({path:`dashboard-${dimension.toLowerCase()}.png`});
  }
  await page.locator('.choice',{hasText:'Customer'}).click();
  await page.locator('#contributionBody tr[data-name="Walmart"]').click();
  await page.locator('.chips .chip',{hasText:'Brand',exact:true}).click();
  await page.screenshot({path:'small-multiples-brand.png'});

  await page.locator('.choice',{hasText:'Brand'}).click();
  await page.locator('#contributionBody tr[data-name="Febreze"]').click();
  for(const split of ['Category','Geography','Segment']){
    await page.locator('.chips .chip',{hasText:split,exact:true}).click();
    await page.screenshot({path:`small-multiples-${split.toLowerCase()}.png`});
  }
  console.log(JSON.stringify({status:errors.length?'FAIL':'PASS',screenshots:8,errors},null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
