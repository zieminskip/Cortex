# Cortex mock data warehouse

A deterministic DuckDB warehouse containing realistic retail performance data for every dashboard section.

## Grain

`core.fact_weekly_sales` contains one row per:

- fiscal week
- customer
- product/brand
- geography
- shopper segment

The generated warehouse covers W14–W29 of FY2024 and contains 25,152 fact rows.

## Schemas

### `core`

| Table | Purpose |
|---|---|
| `dim_week` | Fiscal week calendar and current-period flag |
| `dim_customer` | 15 retail customers, channel, tier, and logo |
| `dim_brand` | P&G and private-label brands |
| `dim_product` | Product, category, subcategory, and package size |
| `dim_geography` | Region and representative market |
| `dim_segment` | Shopper segment definitions |
| `fact_weekly_sales` | Actual/expected sales, units, promotion, distribution, and in-stock measures |
| `fact_breakpoint` | Detected business and customer breakpoints |

### `mart`

| View | Dashboard use |
|---|---|
| `v_overview_kpis` | Cumulative impact, current/peak gap, recovery, status, breakpoint |
| `v_weekly_business` | Actual vs Expected chart and weekly gap |
| `v_customer_contribution` | Ranked customer contribution table |
| `v_customer_weekly_heatmap` | Customer-by-week impact heatmap |
| `v_walmart_brand_decomposition` | Walmart brand cards |
| `v_dimension_concentration` | Customer/brand/category/geography concentration selector |

## Commands

- `npm run warehouse:build` — recreate the database deterministically.
- `npm run warehouse:validate` — validate dimensions, facts, KPIs, dashboard values, and quality constraints.

Database file: `warehouse/cortex.duckdb`

Schema source: `warehouse/schema.sql`

## Example queries

```sql
SELECT * FROM mart.v_overview_kpis;
SELECT * FROM mart.v_weekly_business ORDER BY fiscal_week;
SELECT * FROM mart.v_customer_contribution ORDER BY cumulative_impact_m;
SELECT * FROM mart.v_customer_weekly_heatmap WHERE customer_name = 'Walmart';
SELECT * FROM mart.v_walmart_brand_decomposition;
```

The dataset is synthetic and intended for UI development, demos, analytics prototyping, and automated tests. It contains no real commercial data.
