const path = require('node:path');
const assert = require('node:assert/strict');
const { DuckDBInstance } = require('@duckdb/node-api');

const DB_PATH = path.join(__dirname, 'cortex.duckdb');
const query = async (conn, sql) => (await conn.runAndReadAll(sql)).getRowObjectsJS();

(async () => {
  const instance = await DuckDBInstance.create(DB_PATH, { access_mode: 'READ_ONLY' });
  const conn = await instance.connect();
  try {
    const rawCounts = (await query(conn, `
      SELECT
        (SELECT COUNT(*) FROM core.dim_week) AS weeks,
        (SELECT COUNT(*) FROM core.dim_customer) AS customers,
        (SELECT COUNT(*) FROM core.dim_brand) AS brands,
        (SELECT COUNT(*) FROM core.dim_product) AS products,
        (SELECT COUNT(*) FROM core.dim_geography) AS geographies,
        (SELECT COUNT(*) FROM core.dim_segment) AS segments,
        (SELECT COUNT(*) FROM core.fact_weekly_sales) AS facts
    `))[0];
    const counts = Object.fromEntries(Object.entries(rawCounts).map(([key,value]) => [key,Number(value)]));
    assert.deepEqual(counts, { weeks:16, customers:15, brands:11, products:11, geographies:4, segments:3, facts:25152 });

    const kpi = (await query(conn, 'SELECT * FROM mart.v_overview_kpis'))[0];
    assert.deepEqual(kpi, {
      cumulative_impact_m:-32.4, current_gap_m:-3.4, peak_gap_m:-5.1,
      gap_closed_pct:32, status:'Narrowing', breakpoint_week:22, since_breakpoint_pct:-26,
    });

    const weekly = await query(conn, 'SELECT fiscal_week, actual_sales_m, expected_sales_m, weekly_gap_m FROM mart.v_weekly_business ORDER BY fiscal_week');
    assert.equal(weekly.length, 16);
    assert.deepEqual(weekly.find(row => row.fiscal_week === 24), { fiscal_week:24, actual_sales_m:59.9, expected_sales_m:65, weekly_gap_m:-5.1 });
    assert.deepEqual(weekly.at(-1), { fiscal_week:29, actual_sales_m:53.6, expected_sales_m:57, weekly_gap_m:-3.4 });

    const customers = await query(conn, `SELECT customer_name, cumulative_impact_m, current_gap_m FROM mart.v_customer_contribution WHERE customer_name IN ('Walmart','Target','Amazon','Kroger','Dollar General','Publix') ORDER BY customer_name`);
    const expectedCustomers = {
      Amazon:[-1.5,-0.1], 'Dollar General':[0.4,0.2], Kroger:[-0.6,0.1], Publix:[0.5,0.2], Target:[-3.1,-0.7], Walmart:[-27.2,-2.8],
    };
    for (const row of customers) assert.deepEqual([row.cumulative_impact_m,row.current_gap_m], expectedCustomers[row.customer_name]);

    const brands = await query(conn, 'SELECT brand_name, cumulative_impact_m, current_gap_m FROM mart.v_walmart_brand_decomposition ORDER BY brand_name');
    const expectedBrands = { Equate:[-1.9,-0.1], Gain:[-8.4,-0.9], 'Great Value':[-3.1,-0.4], 'Other Brands':[-1.2,0.2], Tide:[-12.6,-1.3] };
    for (const row of brands) assert.deepEqual([row.cumulative_impact_m,row.current_gap_m], expectedBrands[row.brand_name]);

    const rawQuality = (await query(conn, `
      SELECT
        COUNT(*) FILTER (WHERE actual_sales_usd < 0 OR expected_sales_usd < 0) AS negative_sales,
        COUNT(*) FILTER (WHERE distribution_pct NOT BETWEEN 0 AND 100) AS invalid_distribution,
        COUNT(*) FILTER (WHERE in_stock_pct NOT BETWEEN 0 AND 100) AS invalid_in_stock,
        COUNT(*) FILTER (WHERE units_sold < 0 OR expected_units < 0) AS negative_units
      FROM core.fact_weekly_sales
    `))[0];
    const quality = Object.fromEntries(Object.entries(rawQuality).map(([key,value]) => [key,Number(value)]));
    assert.deepEqual(quality, { negative_sales:0, invalid_distribution:0, invalid_in_stock:0, negative_units:0 });

    const rawMartCounts = (await query(conn, `
      SELECT
        (SELECT COUNT(*) FROM mart.v_weekly_business) AS weekly_business,
        (SELECT COUNT(*) FROM mart.v_customer_contribution) AS customer_contribution,
        (SELECT COUNT(*) FROM mart.v_customer_weekly_heatmap) AS customer_heatmap,
        (SELECT COUNT(*) FROM mart.v_walmart_brand_decomposition) AS brand_decomposition,
        (SELECT COUNT(*) FROM mart.v_dimension_concentration) AS dimension_concentration
    `))[0];
    const martCounts = Object.fromEntries(Object.entries(rawMartCounts).map(([key,value]) => [key,Number(value)]));
    assert.deepEqual(martCounts, { weekly_business:16, customer_contribution:15, customer_heatmap:120, brand_decomposition:5, dimension_concentration:4 });

    console.log(JSON.stringify({ status:'PASS', database:DB_PATH, counts, martCounts, kpi, quality }, null, 2));
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
})().catch(error => { console.error(error); process.exit(1); });
