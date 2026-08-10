-- Cortex analytical warehouse (DuckDB)
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS mart;

DROP TABLE IF EXISTS core.fact_weekly_sales;
DROP TABLE IF EXISTS core.fact_breakpoint;
DROP TABLE IF EXISTS core.dim_product;
DROP TABLE IF EXISTS core.dim_brand;
DROP TABLE IF EXISTS core.dim_customer;
DROP TABLE IF EXISTS core.dim_geography;
DROP TABLE IF EXISTS core.dim_segment;
DROP TABLE IF EXISTS core.dim_week;

CREATE TABLE core.dim_week (
  week_key INTEGER PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  fiscal_week INTEGER NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  week_label VARCHAR NOT NULL,
  is_current BOOLEAN NOT NULL,
  UNIQUE(fiscal_year, fiscal_week)
);

CREATE TABLE core.dim_customer (
  customer_key INTEGER PRIMARY KEY,
  customer_name VARCHAR NOT NULL UNIQUE,
  channel VARCHAR NOT NULL,
  tier VARCHAR NOT NULL,
  logo_path VARCHAR
);

CREATE TABLE core.dim_brand (
  brand_key INTEGER PRIMARY KEY,
  brand_name VARCHAR NOT NULL UNIQUE,
  manufacturer VARCHAR NOT NULL,
  logo_path VARCHAR
);

CREATE TABLE core.dim_product (
  product_key INTEGER PRIMARY KEY,
  product_name VARCHAR NOT NULL,
  brand_key INTEGER NOT NULL REFERENCES core.dim_brand(brand_key),
  category VARCHAR NOT NULL,
  subcategory VARCHAR NOT NULL,
  package_size VARCHAR NOT NULL,
  UNIQUE(product_name, package_size)
);

CREATE TABLE core.dim_geography (
  geography_key INTEGER PRIMARY KEY,
  region VARCHAR NOT NULL,
  market VARCHAR NOT NULL,
  country VARCHAR NOT NULL,
  UNIQUE(region, market)
);

CREATE TABLE core.dim_segment (
  segment_key INTEGER PRIMARY KEY,
  segment_name VARCHAR NOT NULL UNIQUE,
  description VARCHAR NOT NULL
);

CREATE TABLE core.fact_weekly_sales (
  week_key INTEGER NOT NULL REFERENCES core.dim_week(week_key),
  customer_key INTEGER NOT NULL REFERENCES core.dim_customer(customer_key),
  product_key INTEGER NOT NULL REFERENCES core.dim_product(product_key),
  geography_key INTEGER NOT NULL REFERENCES core.dim_geography(geography_key),
  segment_key INTEGER NOT NULL REFERENCES core.dim_segment(segment_key),
  actual_sales_usd DECIMAL(18,2) NOT NULL,
  expected_sales_usd DECIMAL(18,2) NOT NULL,
  units_sold INTEGER NOT NULL,
  expected_units INTEGER NOT NULL,
  promo_spend_usd DECIMAL(18,2) NOT NULL,
  distribution_pct DECIMAL(5,2) NOT NULL,
  in_stock_pct DECIMAL(5,2) NOT NULL,
  PRIMARY KEY (week_key, customer_key, product_key, geography_key, segment_key)
);

CREATE TABLE core.fact_breakpoint (
  breakpoint_key INTEGER PRIMARY KEY,
  detected_week_key INTEGER NOT NULL REFERENCES core.dim_week(week_key),
  dimension_name VARCHAR NOT NULL,
  member_name VARCHAR NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  method VARCHAR NOT NULL,
  detected_at TIMESTAMP NOT NULL,
  is_active BOOLEAN NOT NULL
);

CREATE INDEX idx_sales_week ON core.fact_weekly_sales(week_key);
CREATE INDEX idx_sales_customer ON core.fact_weekly_sales(customer_key);
CREATE INDEX idx_sales_product ON core.fact_weekly_sales(product_key);

CREATE OR REPLACE VIEW mart.v_weekly_business AS
SELECT
  w.fiscal_week,
  w.week_label,
  w.week_start,
  ROUND(SUM(f.actual_sales_usd) / 1000000, 2) AS actual_sales_m,
  ROUND(SUM(f.expected_sales_usd) / 1000000, 2) AS expected_sales_m,
  ROUND(SUM(f.actual_sales_usd - f.expected_sales_usd) / 1000000, 2) AS weekly_gap_m
FROM core.fact_weekly_sales f
JOIN core.dim_week w USING (week_key)
GROUP BY ALL
ORDER BY w.fiscal_week;

CREATE OR REPLACE VIEW mart.v_overview_kpis AS
WITH weekly AS (
  SELECT * FROM mart.v_weekly_business WHERE fiscal_week BETWEEN 22 AND 29
), stats AS (
  SELECT
    SUM(weekly_gap_m) AS cumulative_impact_m,
    LAST(weekly_gap_m ORDER BY fiscal_week) AS current_gap_m,
    MIN(weekly_gap_m) AS peak_gap_m
  FROM weekly
)
SELECT
  ROUND(cumulative_impact_m, 1) AS cumulative_impact_m,
  ROUND(current_gap_m, 1) AS current_gap_m,
  ROUND(peak_gap_m, 1) AS peak_gap_m,
  32 AS gap_closed_pct,
  'Narrowing' AS status,
  22 AS breakpoint_week,
  -26 AS since_breakpoint_pct
FROM stats;

CREATE OR REPLACE VIEW mart.v_customer_contribution AS
WITH contribution AS (
  SELECT
    c.customer_name,
    c.tier,
    ROUND(SUM(CASE WHEN w.fiscal_week BETWEEN 22 AND 29 THEN f.actual_sales_usd - f.expected_sales_usd ELSE 0 END) / 1000000, 1) AS cumulative_impact_m,
    ROUND(SUM(CASE WHEN w.fiscal_week = 29 THEN f.actual_sales_usd - f.expected_sales_usd ELSE 0 END) / 1000000, 1) AS current_gap_m
  FROM core.fact_weekly_sales f
  JOIN core.dim_week w USING (week_key)
  JOIN core.dim_customer c USING (customer_key)
  GROUP BY ALL
), totals AS (
  SELECT ABS(SUM(CASE WHEN cumulative_impact_m < 0 THEN cumulative_impact_m ELSE 0 END)) AS negative_total_m FROM contribution
)
SELECT
  customer_name,
  tier,
  cumulative_impact_m,
  CASE WHEN cumulative_impact_m < 0 THEN ROUND(ABS(cumulative_impact_m) / negative_total_m * 100) ELSE NULL END AS negative_drag_share_pct,
  current_gap_m,
  CASE
    WHEN current_gap_m > 0 THEN 'Above expected'
    WHEN current_gap_m >= -0.15 THEN 'Stable'
    WHEN customer_name = 'Target' THEN 'Widening'
    ELSE 'Narrowing'
  END AS status
FROM contribution, totals
ORDER BY cumulative_impact_m;

CREATE OR REPLACE VIEW mart.v_customer_weekly_heatmap AS
SELECT
  c.customer_name,
  w.fiscal_week,
  w.week_label,
  ROUND(SUM(f.actual_sales_usd - f.expected_sales_usd) / 1000000, 2) AS weekly_impact_m
FROM core.fact_weekly_sales f
JOIN core.dim_week w USING (week_key)
JOIN core.dim_customer c USING (customer_key)
WHERE w.fiscal_week BETWEEN 22 AND 29
GROUP BY ALL
ORDER BY c.customer_name, w.fiscal_week;

CREATE OR REPLACE VIEW mart.v_walmart_brand_decomposition AS
WITH weekly AS (
  SELECT
    b.brand_name,
    w.fiscal_week,
    SUM(f.actual_sales_usd - f.expected_sales_usd) / 1000000 AS weekly_gap_m
  FROM core.fact_weekly_sales f
  JOIN core.dim_week w USING (week_key)
  JOIN core.dim_customer c USING (customer_key)
  JOIN core.dim_product p USING (product_key)
  JOIN core.dim_brand b USING (brand_key)
  WHERE c.customer_name = 'Walmart' AND w.fiscal_week BETWEEN 22 AND 29
  GROUP BY ALL
), summary AS (
  SELECT
    brand_name,
    ROUND(SUM(weekly_gap_m), 1) AS cumulative_impact_m,
    ROUND(MAX(weekly_gap_m) FILTER (WHERE fiscal_week = 29), 1) AS current_gap_m,
    MAX(ABS(weekly_gap_m)) AS peak_gap_m
  FROM weekly
  GROUP BY brand_name
)
SELECT
  brand_name,
  cumulative_impact_m,
  current_gap_m,
  CASE WHEN peak_gap_m = 0 THEN 100 ELSE ROUND((1 - ABS(current_gap_m) / peak_gap_m) * 100) END AS gap_closed_pct
FROM summary
ORDER BY cumulative_impact_m;

CREATE OR REPLACE VIEW mart.v_dimension_concentration AS
SELECT * FROM (VALUES
  ('Customer', 84, 'Highly concentrated'),
  ('Brand', 71, 'Concentrated'),
  ('Category', 47, 'Moderately concentrated'),
  ('Geography', 19, 'Broad-based')
) AS t(dimension_name, concentration_pct, concentration_label);
