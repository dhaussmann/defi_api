#!/usr/bin/env node

/**
 * Fetch Extended funding rates for Jan 9-29, 2026
 * Uses correct 2026 timestamps in milliseconds
 */

const https = require('https');
const { execSync } = require('child_process');

const TARGET_DB = 'defiapi-db-write';
const START_MS = 1767916800000; // Jan 9, 2026 00:00:00 UTC
const END_MS = 1769731199000;   // Jan 29, 2026 23:59:59 UTC

const MARKETS = [
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD', 'XRP-USD', 'BNB-USD', 'ADA-USD',
  'AVAX-USD', 'LTC-USD', 'LINK-USD', 'UNI-USD', 'ARB-USD', 'OP-USD', 'APT-USD',
  'SUI-USD', 'TIA-USD', 'SEI-USD', 'NEAR-USD', 'AAVE-USD', 'CRV-USD', 'SNX-USD',
  'LDO-USD', 'PENDLE-USD', 'JUP-USD', 'WLD-USD', 'STRK-USD', 'ZRO-USD', 'ONDO-USD',
  'ENA-USD', 'EIGEN-USD', 'WIF-USD', 'POPCAT-USD', 'GOAT-USD', 'HYPE-USD', 'VIRTUAL-USD',
  'TRUMP-USD', 'FARTCOIN-USD', 'BERA-USD', 'PUMP-USD', 'TAO-USD', '1000PEPE-USD',
  '1000BONK-USD', '1000SHIB-USD', 'TON-USD', 'TRX-USD', 'XMR-USD', 'ZEC-USD', 'MNT-USD'
];

async function fetchFundingRates(market, startTime, endTime) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.starknet.extended.exchange',
      port: 443,
      path: `/api/v1/info/${market}/funding?startTime=${startTime}&endTime=${endTime}`,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result && result.status === 'OK' && result.data) {
            resolve(result.data);
          } else {
            resolve([]);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Extended Funding Rate Fetcher ===');
  console.log('');
  console.log('Period: Jan 9-29, 2026');
  console.log('Target: ' + TARGET_DB);
  console.log('');
  console.log(`Markets: ${MARKETS.length} pairs`);
  console.log(`Sample: ${MARKETS.slice(0, 5).join(', ')}...`);
  console.log('');

  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise(resolve => {
    readline.question('Continue? (y/N) ', resolve);
  });
  readline.close();

  if (answer.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    process.exit(0);
  }

  console.log('');
  console.log('Starting data fetch...');
  console.log('');

  let totalRecords = 0;
  let errorCount = 0;
  const sqlStatements = [];

  for (let i = 0; i < MARKETS.length; i++) {
    const market = MARKETS[i];
    const symbol = market.replace('-USD', '');
    process.stdout.write(`[${i + 1}/${MARKETS.length}] ${market.padEnd(15)} `);

    try {
      const fundingRates = await fetchFundingRates(market, START_MS, END_MS);
      
      if (fundingRates.length > 0) {
        for (const rate of fundingRates) {
          const fundingRate = parseFloat(rate.f);
          const fundingRatePercent = fundingRate * 100;
          const annualizedRate = fundingRate * 365 * 24;
          const timestamp = rate.T; // Already in milliseconds

          const sql = `INSERT INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES ('extended', '${symbol}', '${market}', ${fundingRate}, ${fundingRatePercent}, ${annualizedRate}, ${timestamp});`;
          sqlStatements.push(sql);
        }
        
        console.log(`✓ ${fundingRates.length} records`);
        totalRecords += fundingRates.length;
      } else {
        console.log(`⚠ No data`);
      }

      await sleep(200);
    } catch (error) {
      console.log(`✗ Error: ${error.message}`);
      errorCount++;
    }
  }

  console.log('');
  console.log(`=== Fetch Complete ===`);
  console.log(`Total records: ${totalRecords}`);
  console.log(`Errors: ${errorCount}`);
  console.log('');

  if (sqlStatements.length === 0) {
    console.log('❌ No data to import');
    process.exit(1);
  }

  const fs = require('fs');
  const sqlFile = `/tmp/extended_import_${Date.now()}.sql`;
  fs.writeFileSync(sqlFile, sqlStatements.join('\n'));
  console.log(`✓ Wrote ${sqlStatements.length} SQL statements to ${sqlFile}`);
  console.log('');

  // Convert to market_history format
  console.log('Converting to market_history format...');
  try {
    execSync(`node scripts/convert-funding-to-market-history.js ${sqlFile}`, {
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('❌ Conversion failed');
    process.exit(1);
  }

  const marketHistoryFile = sqlFile.replace('.sql', '_market_history.sql');
  console.log('');
  console.log(`Importing to ${TARGET_DB}...`);
  try {
    execSync(`npx wrangler d1 execute ${TARGET_DB} --file ${marketHistoryFile} --remote`, {
      stdio: 'inherit'
    });
    console.log('✓ Import complete');
  } catch (error) {
    console.error('❌ Import failed');
    console.log('SQL file saved at:', marketHistoryFile);
    process.exit(1);
  }

  fs.unlinkSync(sqlFile);
  fs.unlinkSync(marketHistoryFile);
  console.log('');
  console.log('=== Done ===');
  console.log('');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
