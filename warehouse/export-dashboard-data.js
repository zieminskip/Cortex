const fs = require('node:fs');
const path = require('node:path');
const { DuckDBInstance } = require('@duckdb/node-api');

const DB_PATH = path.join(__dirname, 'cortex.duckdb');
const OUTPUT_PATH = path.join(__dirname, '..', 'assets', 'dashboard-data.js');
const WEEKS = Array.from({ length: 16 }, (_, index) => 14 + index);
const DIMENSIONS = {
  Customer: { expression: 'c.customer_name', context: 'All business' },
  Brand: { expression: 'b.brand_name', context: 'Home Care category', filter: "p.category = 'Home Care'" },
  Category: { expression: 'p.category', context: 'Total portfolio' },
  Geography: { expression: 'g.region', context: 'United States' },
};
const SPLITS = {
  Brand: 'b.brand_name',
  Category: 'p.category',
  Geography: 'g.region',
  Segment: 's.segment_name',
};
const esc = value => `'${String(value).replaceAll("'", "''")}'`;
const round = value => Math.round(Number(value) * 100) / 100;
const query = async (connection, sql) => (await connection.runAndReadAll(sql)).getRowObjectsJS();
const joins = `
  FROM core.fact_weekly_sales f
  JOIN core.dim_week w USING (week_key)
  JOIN core.dim_customer c USING (customer_key)
  JOIN core.dim_product p USING (product_key)
  JOIN core.dim_brand b USING (brand_key)
  JOIN core.dim_geography g USING (geography_key)
  JOIN core.dim_segment s USING (segment_key)`;

function statusFor(gaps) {
  const current = gaps.at(-1);
  const recent = gaps.slice(-5, -1).reduce((sum, value) => sum + value, 0) / 4;
  if (current > 0.05) return 'Above expected';
  if (Math.abs(current) <= 0.05) return 'Stable';
  return Math.abs(current) < Math.abs(recent) ? 'Narrowing' : 'Widening';
}

function collapse(items, label, limit) {
  const ranked = [...items].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  if (ranked.length <= limit) return ranked;
  const kept = ranked.slice(0, limit - 1);
  const rest = ranked.slice(limit - 1);
  const expected = WEEKS.map((_, index) => round(rest.reduce((sum, item) => sum + item.expected[index], 0)));
  const actual = WEEKS.map((_, index) => round(rest.reduce((sum, item) => sum + item.actual[index], 0)));
  const gaps = actual.map((value, index) => round(value - expected[index]));
  kept.push({ name: label, expected, actual, gaps, impact:round(gaps.reduce((sum, value) => sum + value, 0)), current:gaps.at(-1) });
  return kept;
}

async function groupedSeries(connection, memberExpression, where = 'TRUE') {
  const rows = await query(connection, `
    SELECT ${memberExpression} AS member, w.fiscal_week,
      ROUND(SUM(f.actual_sales_usd) / 1000000, 4) AS actual_m,
      ROUND(SUM(f.expected_sales_usd) / 1000000, 4) AS expected_m
    ${joins}
    WHERE w.fiscal_week BETWEEN 14 AND 29 AND (${where})
    GROUP BY member, w.fiscal_week
    ORDER BY member, w.fiscal_week`);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.member)) grouped.set(row.member, { name:row.member, actual:[], expected:[] });
    grouped.get(row.member).actual.push(round(row.actual_m));
    grouped.get(row.member).expected.push(round(row.expected_m));
  }
  return [...grouped.values()].map(item => {
    const gaps = item.actual.map((value, index) => round(value - item.expected[index]));
    const impact = round(gaps.slice(8).reduce((sum, value) => sum + value, 0));
    return { ...item, gaps, impact, current:gaps.at(-1) };
  });
}

(async () => {
  const instance = await DuckDBInstance.create(DB_PATH, { access_mode:'READ_ONLY' });
  const connection = await instance.connect();
  try {
    const output = { generatedAt:new Date().toISOString(), source:'core.fact_weekly_sales', weeks:WEEKS, attribution:{}, decompositions:{} };
    for (const [dimension, config] of Object.entries(DIMENSIONS)) {
      const all = await groupedSeries(connection, config.expression, config.filter || 'TRUE');
      const negativeTotal = all.filter(item => item.impact < 0).reduce((sum, item) => sum + Math.abs(item.impact), 0);
      const rows = [...all].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
        .map(item => ({ name:item.name, weekly:item.gaps, impact:item.impact, current:item.current, share:item.impact < 0 ? Math.round(Math.abs(item.impact) / negativeTotal * 100) : null, status:statusFor(item.gaps) }));
      output.attribution[dimension] = { context:config.context, total:all.length, negativeTotal:round(negativeTotal), rows };

      for (const parent of all) {
        for (const [split, splitExpression] of Object.entries(SPLITS)) {
          if (split === dimension) continue;
          const effectiveSplit = dimension === 'Brand' && split === 'Category' ? 'p.subcategory' : splitExpression;
          const where = [config.filter, `${config.expression} = ${esc(parent.name)}`].filter(Boolean).join(' AND ');
          const children = (await groupedSeries(connection, effectiveSplit, where)).map(item => {
            const peak = Math.max(...item.gaps.map(value => Math.abs(value)), 0);
            const recovery = peak ? Math.max(0, Math.min(100, Math.round((1 - Math.abs(item.current) / peak) * 100))) : 100;
            return { ...item, recovery };
          });
          output.decompositions[`${dimension}|${parent.name}|${split}`] = children;
        }
      }
    }
    fs.writeFileSync(OUTPUT_PATH, `/* Generated from warehouse/cortex.duckdb. Do not hand-edit. */\nwindow.CORTEX_DATA=${JSON.stringify(output)};\n`);
    console.log(JSON.stringify({ status:'PASS', output:OUTPUT_PATH, attribution:Object.fromEntries(Object.entries(output.attribution).map(([key,value]) => [key,value.rows.length])), decompositions:Object.keys(output.decompositions).length }, null, 2));
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
})().catch(error => { console.error(error); process.exit(1); });
