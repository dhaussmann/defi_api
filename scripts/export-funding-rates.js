/**
 * Export funding rate data from funding-rate-collector database
 * to format compatible with defiapi-db
 *
 * Usage:
 *   node scripts/export-funding-rates.js <path-to-funding-rate-collector.db> <output.sql>
 *
 * Example:
 *   node scripts/export-funding-rates.js ../funding-rate-collector/funding_rates.db funding-import.sql
 */

const Database = require('better-sqlite3');
const fs = require('fs');

// Get command line arguments
const [,, sourceDbPath, outputSqlPath] = process.argv;

if (!sourceDbPath || !outputSqlPath) {
  console.error('Usage: node export-funding-rates.js <source-db-path> <output-sql-path>');
  console.error('Example: node export-funding-rates.js ../funding-rate-collector/funding_rates.db funding-import.sql');
  process.exit(1);
}

console.log(`Reading from: ${sourceDbPath}`);
console.log(`Writing to: ${outputSqlPath}`);

// Open source database
const db = new Database(sourceDbPath, { readonly: true });

// Query to get all funding rates from unified table
const query = `
  SELECT
    exchange,
    symbol,
    trading_pair,
    funding_rate,
    funding_rate_percent,
    annualized_rate,
    collected_at
  FROM unified_funding_rates
  WHERE exchange IN ('hyperliquid', 'lighter', 'aster', 'paradex')
    AND collected_at >= ?
  ORDER BY collected_at ASC
`;

// Start from 2025-01-01 00:00:00 UTC (in milliseconds)
const startDate = new Date('2025-01-01T00:00:00Z').getTime();

console.log(`Fetching records from ${new Date(startDate).toISOString()}...`);

const stmt = db.prepare(query);
const rows = stmt.all(startDate);

console.log(`Found ${rows.length} records`);

if (rows.length === 0) {
  console.log('No records found. Exiting.');
  process.exit(0);
}

// Generate SQL INSERT statements
// Using batch inserts for efficiency (100 rows per INSERT)
const batchSize = 100;
const batches = [];

for (let i = 0; i < rows.length; i += batchSize) {
  const batch = rows.slice(i, i + batchSize);

  const values = batch.map(row => {
    // Escape single quotes in strings
    const exchange = row.exchange.replace(/'/g, "''");
    const symbol = row.symbol.replace(/'/g, "''");
    const tradingPair = row.trading_pair.replace(/'/g, "''");

    return `('${exchange}', '${symbol}', '${tradingPair}', ${row.funding_rate}, ${row.funding_rate_percent}, ${row.annualized_rate}, ${row.collected_at})`;
  }).join(',\n  ');

  const insertSql = `INSERT OR IGNORE INTO funding_rate_history (
  exchange, symbol, trading_pair, funding_rate,
  funding_rate_percent, annualized_rate, collected_at
) VALUES
  ${values};`;

  batches.push(insertSql);
}

// Write to output file
const header = `-- Funding Rate History Import
-- Generated: ${new Date().toISOString()}
-- Source: ${sourceDbPath}
-- Records: ${rows.length}
-- Date Range: ${new Date(rows[0].collected_at).toISOString()} to ${new Date(rows[rows.length - 1].collected_at).toISOString()}
-- Exchanges: hyperliquid, lighter, aster, paradex

`;

const sqlContent = header + batches.join('\n\n');

fs.writeFileSync(outputSqlPath, sqlContent, 'utf8');

console.log(`\n✅ Export complete!`);
console.log(`   Output: ${outputSqlPath}`);
console.log(`   Total records: ${rows.length}`);
console.log(`   Batch inserts: ${batches.length}`);
console.log(`   File size: ${(fs.statSync(outputSqlPath).size / 1024 / 1024).toFixed(2)} MB`);

// Statistics by exchange
console.log('\nRecords per exchange:');
const stats = {};
rows.forEach(row => {
  stats[row.exchange] = (stats[row.exchange] || 0) + 1;
});
Object.entries(stats).sort((a, b) => b[1] - a[1]).forEach(([exchange, count]) => {
  console.log(`  ${exchange}: ${count.toLocaleString()}`);
});

// Close database
db.close();

console.log('\nNext steps:');
console.log(`  1. Review the generated SQL file: ${outputSqlPath}`);
console.log(`  2. Import to D1: npx wrangler d1 execute defiapi-db --remote --file=${outputSqlPath}`);
console.log('\nNote: Import may take several minutes depending on data size.');
