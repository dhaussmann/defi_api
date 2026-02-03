#!/usr/bin/env node

/**
 * Fetch Aster funding rates directly from API for Jan 9-29, 2026
 * Fetches hourly data (24 values per day per token)
 */

const https = require('https');
const { execSync } = require('child_process');

const TARGET_DB = 'defiapi-db-write';
const START_MS = 1736380800000; // Jan 9, 2026 00:00:00 UTC
const END_MS = 1738195199000;   // Jan 29, 2026 23:59:59 UTC

// Aster supported markets
const MARKETS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'MATICUSDT', 'DOTUSDT', 'AVAXUSDT',
  'LINKUSDT', 'ATOMUSDT', 'UNIUSDT', 'LTCUSDT', 'ETCUSDT',
  'FILUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT'
];

function generateHourlyTimestamps(startMs, endMs) {
  const timestamps = [];
  const hourMs = 60 * 60 * 1000;
  for (let ts = startMs; ts <= endMs; ts += hourMs) {
    timestamps.push(ts);
  }
  return timestamps;
}

async function fetchFundingRate(market, timestamp) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.aster.exchange',
      port: 443,
      path: `/v1/funding-rate?symbol=${market}&timestamp=${timestamp}`,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result && result.fundingRate !== undefined ? result : null);
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
  console.log('=== Aster Funding Rate Fetcher ===\n');
  console.log('Period: Jan 9-29, 2026 (hourly data)');
  console.log('Target: ' + TARGET_DB);
  console.log(`\nMarkets: ${MARKETS.length} pairs\n`);

  const timestamps = generateHourlyTimestamps(START_MS, END_MS);
  console.log(`✓ Generated ${timestamps.length} hourly timestamps\n`);
  console.log(`Total API requests: ${MARKETS.length * timestamps.length}\n`);

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

  console.log('\nStarting data fetch...\n');

  let successCount = 0;
  let errorCount = 0;
  const sqlStatements = [];

  for (let i = 0; i < MARKETS.length; i++) {
    const market = MARKETS[i];
    const symbol = market.replace('USDT', '');
    process.stdout.write(`[${i + 1}/${MARKETS.length}] ${market.padEnd(15)} `);

    let marketSuccess = 0;
    let marketErrors = 0;

    for (const timestamp of timestamps) {
      try {
        const data = await fetchFundingRate(market, timestamp);
        
        if (data && data.fundingRate !== undefined) {
          const fundingRate = parseFloat(data.fundingRate);
          const fundingRatePercent = fundingRate * 100;
          const annualizedRate = fundingRate * 365 * 24;

          const sql = `INSERT INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES ('aster', '${symbol}', '${market}', ${fundingRate}, ${fundingRatePercent}, ${annualizedRate}, ${timestamp});`;
          sqlStatements.push(sql);
          
          marketSuccess++;
          successCount++;
        } else {
          marketErrors++;
          errorCount++;
        }

        await sleep(100);
      } catch (error) {
        marketErrors++;
        errorCount++;
      }
    }

    console.log(`✓ ${marketSuccess} records (${marketErrors} errors)`);
  }

  console.log(`\n=== Fetch Complete ===`);
  console.log(`Success: ${successCount} records`);
  console.log(`Errors: ${errorCount}\n`);

  if (sqlStatements.length === 0) {
    console.log('❌ No data to import');
    process.exit(1);
  }

  const fs = require('fs');
  const sqlFile = `/tmp/aster_import_${Date.now()}.sql`;
  fs.writeFileSync(sqlFile, sqlStatements.join('\n'));
  console.log(`✓ Wrote ${sqlStatements.length} SQL statements to ${sqlFile}\n`);

  console.log(`Importing to ${TARGET_DB}...`);
  try {
    execSync(`npx wrangler d1 execute ${TARGET_DB} --file ${sqlFile} --remote`, {
      stdio: 'inherit'
    });
    console.log('✓ Import complete');
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.log('SQL file saved at:', sqlFile);
    process.exit(1);
  }

  fs.unlinkSync(sqlFile);
  console.log('\n=== Done ===\n');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
