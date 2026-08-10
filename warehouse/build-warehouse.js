const fs = require('node:fs');
const path = require('node:path');
const { DuckDBInstance } = require('@duckdb/node-api');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(__dirname, 'cortex.duckdb');
const q = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : typeof value === 'boolean' ? String(value).toUpperCase() : `'${String(value).replaceAll("'", "''")}'`;
const insertRows = async (conn, table, columns, rows, chunkSize = 500) => {
  for (let start = 0; start < rows.length; start += chunkSize) {
    const values = rows.slice(start, start + chunkSize).map(row => `(${row.map(q).join(',')})`).join(',\n');
    await conn.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values}`);
  }
};

const weeks = [
  [14,'2024-04-01',49.0,48.0],[15,'2024-04-08',53.0,51.0],[16,'2024-04-15',47.0,49.0],[17,'2024-04-22',52.0,53.0],
  [18,'2024-04-29',55.0,54.0],[19,'2024-05-06',58.0,57.0],[20,'2024-05-13',63.0,61.0],[21,'2024-05-20',62.0,63.0],
  [22,'2024-05-27',57.5,61.0],[23,'2024-06-03',58.8,63.0],[24,'2024-06-10',59.9,65.0],[25,'2024-06-17',59.4,64.0],
  [26,'2024-06-24',57.8,62.0],[27,'2024-07-01',56.2,60.0],[28,'2024-07-08',57.4,61.0],[29,'2024-07-15',53.6,57.0],
];
const customers = [
  ['Walmart','Mass Merchant','Strategic','assets/logos/walmart.svg',.42],['Target','Mass Merchant','Strategic','assets/logos/target.svg',.13],
  ['Amazon','E-commerce','Strategic','assets/logos/amazon.svg',.10],['Kroger','Grocery','Strategic','assets/logos/kroger.png',.07],
  ['Dollar General','Dollar','Growth','assets/logos/dollargeneral.png',.05],['Publix','Grocery','Growth','assets/logos/publix.png',.04],
  ['Costco','Club','Strategic',null,.035],['Walgreens','Drug','Core',null,.025],['CVS','Drug','Core',null,.02],
  ['Albertsons','Grocery','Core',null,.025],['Sam’s Club','Club','Core',null,.025],['Meijer','Mass Merchant','Core',null,.015],
  ['H-E-B','Grocery','Growth',null,.015],['Instacart','E-commerce','Growth',null,.01],['Other Retailers','Mixed','Long tail',null,.02],
];
const brands = [
  ['Tide','P&G','assets/logos/tide.png','Laundry','Liquid Detergent','92 fl oz'],
  ['Gain','P&G','assets/logos/gain.png','Laundry','Liquid Detergent','88 fl oz'],
  ['Great Value','Walmart','assets/logos/great-value.svg','Laundry','Private Label Detergent','100 fl oz'],
  ['Equate','Walmart','assets/logos/equate.svg','Personal Care','Private Label Care','32 fl oz'],
  ['Other Brands','P&G','assets/logos/pg.png','Other Portfolio','Portfolio','Assorted'],
  ['Ariel','P&G',null,'Laundry','Powder Detergent','70 oz'],['Downy','P&G',null,'Laundry','Fabric Enhancer','64 fl oz'],
  ['Bounty','P&G',null,'Paper','Paper Towels','6 rolls'],['Charmin','P&G',null,'Paper','Bath Tissue','12 rolls'],
  ['Febreze','P&G',null,'Home Care','Air Care','8.8 oz'],['Swiffer','P&G',null,'Home Care','Floor Care','WetJet starter kit'],
  ['Dawn','P&G',null,'Home Care','Dish Care','24 fl oz'],['Mr. Clean','P&G',null,'Home Care','Surface Care','45 fl oz'],
  ['Cascade','P&G',null,'Home Care','Automatic Dish','62 count'],['Microban','P&G',null,'Home Care','Sanitizing','24 fl oz'],
];
const productLines = {
  Febreze:[['Air Care',.34],['Fabric Refresher',.25],['Small Spaces',.18],['Car',.13],['Other Febreze',.10]],
  Swiffer:[['Wet Floor',.31],['Dry Floor',.24],['Dusters',.19],['WetJet',.16],['Refills',.10]],
  Dawn:[['Hand Dish',.36],['Powerwash',.25],['Dish Spray',.17],['Professional',.13],['Other Dawn',.09]],
};
const products = brands.flatMap((brand, brandIndex) => {
  const [brandName,,,category,subcategory,packageSize] = brand;
  const lines = productLines[brandName] || [[subcategory,1]];
  return lines.map(([line,weight], lineIndex) => ({
    brandIndex, brandName, category, subcategory:line, packageSize,
    productName:`${brandName} ${line}${lineIndex ? ` ${lineIndex + 1}` : ''}`,
    weight,
  }));
});
const geographies = [['Northeast','New York Metro','United States',.22],['South','Atlanta Metro','United States',.34],['Midwest','Chicago Metro','United States',.25],['West','Los Angeles Metro','United States',.19]];
const segments = [['Value Seekers','Price-sensitive households',.38],['Mainstream Families','High-frequency family households',.44],['Premium Shoppers','Feature and performance-led households',.18]];
const customerPostGaps = {
  Walmart:[-2.7,-3.1,-4.6,-4.4,-3.8,-3.2,-2.6,-2.8], Target:[-.2,-.3,-.3,-.4,-.3,-.4,-.5,-.7], Amazon:[-.3,-.3,-.2,-.2,-.2,-.1,-.1,-.1],
  Kroger:[-.2,-.2,-.1,-.1,-.1,0,0,.1], 'Dollar General':[-.1,-.1,0,0,.1,.1,.2,.2], Publix:[-.1,0,0,.1,.1,.1,.1,.2],
};
const walmartBrandGaps = {
  Tide:[-1.2,-1.5,-2.2,-2,-1.8,-1.5,-1.1,-1.3], Gain:[-.8,-1,-1.4,-1.4,-1.2,-.9,-.8,-.9],
  'Great Value':[-.3,-.4,-.5,-.5,-.4,-.3,-.3,-.4], Equate:[-.2,-.2,-.3,-.3,-.3,-.3,-.2,-.1],
  'Other Brands':[-.2,0,-.2,-.2,-.1,-.2,-.2,-.1],
};
const customerBrandWeights = {
  Walmart:{Tide:.40,Gain:.27,'Great Value':.14,Equate:.09,'Other Brands':.10},
  default:{Tide:.22,Gain:.14,Ariel:.05,Downy:.08,Bounty:.07,Charmin:.08,Febreze:.09,Swiffer:.07,Dawn:.08,'Mr. Clean':.04,Cascade:.035,Microban:.015,'Other Brands':.03},
};

function allocationRows(totalExpectedCents, totalGapCents, customerIndex, weekIndex) {
  const customer = customers[customerIndex];
  const [customerName,,,,customerWeight] = customer;
  const brandWeights = customerBrandWeights[customerName] || customerBrandWeights.default;
  const rows = [];
  const combinations = [];
  for (const [brandName, brandWeight] of Object.entries(brandWeights)) {
    const brandIndex = brands.findIndex(b => b[0] === brandName);
    for (const product of products.filter(p => p.brandIndex === brandIndex)) for (let g = 0; g < geographies.length; g++) for (let s = 0; s < segments.length; s++) {
      combinations.push({ brandIndex, brandName, productIndex:products.indexOf(product), weight:brandWeight * product.weight * geographies[g][3] * segments[s][2], geographyIndex:g, segmentIndex:s });
    }
  }
  combinations.forEach(combo => {
    const productWave = Math.sin((weekIndex + 2) * (combo.productIndex + 1) * .37) * .09;
    const geographyWave = Math.cos((weekIndex + 1) * (combo.geographyIndex + 1) * .43) * .08;
    const segmentWave = Math.sin((weekIndex + 3) * (combo.segmentIndex + 2) * .29) * .07;
    combo.dynamicWeight = combo.weight * Math.max(.65, 1 + productWave + geographyWave + segmentWave);
  });
  const dynamicTotal = combinations.reduce((sum, combo) => sum + combo.dynamicWeight, 0);
  const brandDynamicTotals = Object.fromEntries(Object.keys(brandWeights).map(brandName => [brandName, combinations.filter(combo => combo.brandName === brandName).reduce((sum, combo) => sum + combo.dynamicWeight, 0)]));
  const customerExpected = Math.round(totalExpectedCents * customerWeight);
  let customerGap;
  if (weekIndex >= 8) {
    const postIndex = weekIndex - 8;
    if (customerPostGaps[customerName]) customerGap = Math.round(customerPostGaps[customerName][postIndex] * 100000000);
    else {
      const specified = Object.values(customerPostGaps).reduce((sum, values) => sum + values[postIndex], 0);
      const residual = Math.round((weeks[weekIndex][2] - weeks[weekIndex][3] - specified) * 100000000);
      const otherWeight = customers.slice(6).reduce((sum, c) => sum + c[4], 0);
      customerGap = Math.round(residual * customerWeight / otherWeight);
    }
  } else customerGap = Math.round(totalGapCents * customerWeight);
  let expectedAssigned = 0, gapAssigned = 0;
  combinations.forEach((combo, index) => {
    const last = index === combinations.length - 1;
    const expected = last ? customerExpected - expectedAssigned : Math.round(customerExpected * combo.dynamicWeight / dynamicTotal);
    let gap;
    if (weekIndex >= 8 && customerName === 'Walmart') {
      const brandGap = Math.round(walmartBrandGaps[combo.brandName][weekIndex - 8] * 100000000);
      const geoSegmentWeight = combo.dynamicWeight / brandDynamicTotals[combo.brandName];
      const sameBrand = combinations.filter(c => c.brandName === combo.brandName);
      const lastOfBrand = combo === sameBrand[sameBrand.length - 1];
      const priorBrandGap = rows.filter(r => r.brandName === combo.brandName).reduce((sum, r) => sum + r.gap, 0);
      gap = lastOfBrand ? brandGap - priorBrandGap : Math.round(brandGap * geoSegmentWeight);
    } else gap = last ? customerGap - gapAssigned : Math.round(customerGap * combo.weight);
    expectedAssigned += expected; gapAssigned += gap;
    rows.push({ ...combo, expected, gap, brandName:combo.brandName });
  });
  return rows;
}

(async () => {
  if (fs.existsSync(DB_PATH)) fs.rmSync(DB_PATH);
  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();
  try {
    await conn.run(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    await conn.run('BEGIN TRANSACTION');
    await insertRows(conn, 'core.dim_week', ['week_key','fiscal_year','fiscal_week','week_start','week_end','week_label','is_current'], weeks.map(([week,start]) => { const end=new Date(`${start}T00:00:00Z`);end.setUTCDate(end.getUTCDate()+6);return [202400+week,2024,week,start,end.toISOString().slice(0,10),`W${week}`,week===29] }));
    await insertRows(conn, 'core.dim_customer', ['customer_key','customer_name','channel','tier','logo_path'], customers.map((c,i)=>[i+1,...c.slice(0,4)]));
    await insertRows(conn, 'core.dim_brand', ['brand_key','brand_name','manufacturer','logo_path'], brands.map((b,i)=>[i+1,b[0],b[1],b[2]]));
    await insertRows(conn, 'core.dim_product', ['product_key','product_name','brand_key','category','subcategory','package_size'], products.map((p,i)=>[i+1,p.productName,p.brandIndex+1,p.category,p.subcategory,p.packageSize]));
    await insertRows(conn, 'core.dim_geography', ['geography_key','region','market','country'], geographies.map((g,i)=>[i+1,...g.slice(0,3)]));
    await insertRows(conn, 'core.dim_segment', ['segment_key','segment_name','description'], segments.map((s,i)=>[i+1,s[0],s[1]]));

    const facts=[];
    weeks.forEach((week, weekIndex) => {
      const expectedTotal=Math.round(week[3]*100000000), actualTotal=Math.round(week[2]*100000000), gapTotal=actualTotal-expectedTotal;
      customers.forEach((customer, customerIndex) => allocationRows(expectedTotal,gapTotal,customerIndex,weekIndex).forEach(row => {
        const actual=Math.max(0,row.expected+row.gap), price=650+row.brandIndex*35, units=Math.round(actual/price), expectedUnits=Math.round(row.expected/price);
        const promoRate=.045+((weekIndex+row.brandIndex+customerIndex)%5)*.006;
        facts.push([202400+week[0],customerIndex+1,row.productIndex+1,row.geographyIndex+1,row.segmentIndex+1,actual/100,row.expected/100,units,expectedUnits,Math.round(actual*promoRate)/100,91+((weekIndex+row.brandIndex)%8),94+((customerIndex+weekIndex)%6)]);
      }));
    });
    await insertRows(conn,'core.fact_weekly_sales',['week_key','customer_key','product_key','geography_key','segment_key','actual_sales_usd','expected_sales_usd','units_sold','expected_units','promo_spend_usd','distribution_pct','in_stock_pct'],facts,250);
    await insertRows(conn,'core.fact_breakpoint',['breakpoint_key','detected_week_key','dimension_name','member_name','confidence','method','detected_at','is_active'],[[1,202422,'Total Business','All',.982,'Bayesian change point','2024-06-03 08:00:00',true],[2,202422,'Customer','Walmart',.971,'Bayesian change point','2024-06-03 08:05:00',true]]);
    await conn.run('COMMIT');
    const reader=await conn.runAndReadAll(`SELECT * FROM mart.v_overview_kpis`);
    console.log('Built',DB_PATH);console.table(reader.getRowObjectsJS());console.log(`Fact rows: ${facts.length.toLocaleString()}`);
  } catch (error) { try { await conn.run('ROLLBACK'); } catch {} throw error; }
  finally { conn.closeSync(); instance.closeSync(); }
})().catch(error=>{console.error(error);process.exit(1)});
