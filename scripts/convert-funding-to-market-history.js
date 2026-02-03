#!/usr/bin/env node

/**
 * Convert funding_rate_history SQL to market_history SQL
 * Groups funding rates by hour and creates aggregated records
 */

const fs = require('fs');

if (process.argv.length < 3) {
  console.log('Usage: node convert-funding-to-market-history.js <input.sql>');
  process.exit(1);
}

const inputFile = process.argv[2];
const sql = fs.readFileSync(inputFile, 'utf8');

// Parse INSERT statements
const insertRegex = /INSERT INTO funding_rate_history \(exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at\) VALUES \('([^']+)', '([^']+)', '([^']+)', ([^,]+), ([^,]+), ([^,]+), (\d+)\);/g;

const records = [];
let match;

while ((match = insertRegex.exec(sql)) !== null) {
  records.push({
    exchange: match[1],
    symbol: match[2],
    trading_pair: match[3],
    funding_rate: parseFloat(match[4]),
    funding_rate_percent: parseFloat(match[5]),
    annualized_rate: parseFloat(match[6]),
    collected_at: parseInt(match[7])
  });
}

console.log(`Parsed ${records.length} funding rate records`);

// Group by exchange, symbol, and hour
const hourlyGroups = {};

for (const record of records) {
  const hourTimestamp = Math.floor(record.collected_at / 3600000) * 3600; // Convert to seconds, round to hour
  const key = `${record.exchange}:${record.symbol}:${hourTimestamp}`;
  
  if (!hourlyGroups[key]) {
    hourlyGroups[key] = {
      exchange: record.exchange,
      symbol: record.symbol,
      trading_pair: record.trading_pair,
      hour_timestamp: hourTimestamp,
      funding_rates: []
    };
  }
  
  hourlyGroups[key].funding_rates.push(record.funding_rate);
}

console.log(`Grouped into ${Object.keys(hourlyGroups).length} hourly records`);

// Generate market_history INSERT statements
const outputStatements = [];

for (const key in hourlyGroups) {
  const group = hourlyGroups[key];
  const rates = group.funding_rates;
  
  const avg_funding_rate = rates.reduce((a, b) => a + b, 0) / rates.length;
  const avg_funding_rate_annual = avg_funding_rate * 365 * 24;
  const min_funding_rate = Math.min(...rates);
  const max_funding_rate = Math.max(...rates);
  const sample_count = rates.length;
  const aggregated_at = Math.floor(Date.now() / 1000);
  
  const sql = `INSERT INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES ('${group.exchange}', '${group.trading_pair}', '${group.symbol}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ${avg_funding_rate}, ${avg_funding_rate_annual}, ${min_funding_rate}, ${max_funding_rate}, ${group.hour_timestamp}, ${sample_count}, ${aggregated_at});`;
  
  outputStatements.push(sql);
}

const outputFile = inputFile.replace('.sql', '_market_history.sql');
fs.writeFileSync(outputFile, outputStatements.join('\n'));

console.log(`✓ Wrote ${outputStatements.length} market_history statements to ${outputFile}`);
