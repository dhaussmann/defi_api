#!/usr/bin/env node

/**
 * Fetch EdgeX funding rates directly from API for Jan 9-29, 2026
 */

const https = require('https');
const { execSync } = require('child_process');

const TARGET_DB = 'defiapi-db-write';
const START_MS = 1736380800000;
const END_MS = 1738195199000;

const MARKETS = [
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'AVAXUSD', 'DOGEUSD',
  'XRPUSD', 'MATICUSD', 'ARBUSD', 'OPUSD', 'SUIUSD',
  'APTUSD', 'ATOMUSD', 'DOTUSD', 'LINKUSD', 'ADAUSD'
];

function generateHourlyTimestamps(startMs, endMs) {
  const timestamps = [];
  for (let ts = startMs; ts <= endMs; ts += 3600000) {
    timestamps.push(ts);
  }
  return timestamps;
}

async function fetchFundingRate(market, timestamp) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.edgex.exchange',
      port: 443,
      path: `/api/v1/funding-rate?symbol=${market}&time=${timestamp}`,
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
  console.log('=== EdgeX Funding Rate Fetcher ===\n');
  console.log('Period: Jan 9-29, 2026');
  console.log('Target: ' + TARGET_DB);
  console.log(`\nMarkets: ${MARKETS.length} pairs\n`);

  const timestamps = generateHourlyTimestamps(START_MS, END_MS);
  console.log(`✓ Generated ${timestamps.length} hourly timestamps\n`);

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
    const symbol = market.replace('USD', '');
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

          const sql = `INSERT INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES ('edgex', '${symbol}', '${market}', ${fundingRate}, ${fundingRatePercent}, ${annualizedRate}, ${timestamp});`;
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
  console.log(`Success: ${successCount} records\n`);

  if (sqlStatements.length === 0) {
    console.log('❌ No data to import');
    process.exit(1);
  }

  const fs = require('fs');
  const sqlFile = `/tmp/edgex_import_${Date.now()}.sql`;
  fs.writeFileSync(sqlFile, sqlStatements.join('\n'));
  console.log(`✓ Wrote ${sqlStatements.length} SQL statements\n`);

  console.log(`Importing to ${TARGET_DB}...`);
  try {
    execSync(`npx wrangler d1 execute ${TARGET_DB} --file ${sqlFile} --remote`, {
      stdio: 'inherit'
    });
    console.log('✓ Import complete');
  } catch (error) {
    console.error('❌ Import failed');
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
