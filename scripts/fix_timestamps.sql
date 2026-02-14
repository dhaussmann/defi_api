-- Fix Extended timestamps (convert milliseconds to seconds)
INSERT INTO unified_v3 (
  normalized_symbol, exchange, funding_time, original_symbol, base_asset,
  rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr,
  collected_at, source, synced_at
)
SELECT 
  UPPER(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      symbol,
      'extended:', ''),
      '-USD-PERP', ''),
      '-PERP', ''),
      '-USD', ''),
      'USDT', ''),
      'USD', ''),
      '1000', ''),
      'k', ''),
      '/', ''),
      '_', ''),
      'hyna:', ''),
      'hyena:', ''),
      'xyz:', ''),
      'flx:', ''),
      'felix:', ''),
      'vntl:', ''),
      'ventuals:', '')
  ) as normalized_symbol,
  'extended' as exchange,
  CASE 
    WHEN funding_time > 10000000000 THEN funding_time / 1000
    ELSE funding_time
  END as funding_time,
  symbol as original_symbol,
  base_asset,
  rate_raw,
  rate_raw_percent,
  interval_hours,
  rate_1h_percent,
  rate_apr,
  CASE 
    WHEN collected_at > 10000000000 THEN collected_at / 1000
    ELSE collected_at
  END as collected_at,
  source,
  strftime('%s', 'now') as synced_at
FROM extended_funding_v3
WHERE rate_raw IS NOT NULL
  AND ABS(rate_raw_percent) <= 10
LIMIT 50000;

-- Fix Paradex timestamps (convert milliseconds to seconds)
INSERT INTO unified_v3 (
  normalized_symbol, exchange, funding_time, original_symbol, base_asset,
  rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr,
  collected_at, source, synced_at
)
SELECT 
  UPPER(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      symbol,
      'paradex:', ''),
      '-USD-PERP', ''),
      '-PERP', ''),
      '-USD', ''),
      'USDT', ''),
      'USD', ''),
      '1000', ''),
      'k', ''),
      '/', ''),
      '_', ''),
      'hyna:', ''),
      'hyena:', ''),
      'xyz:', ''),
      'flx:', ''),
      'felix:', ''),
      'vntl:', ''),
      'ventuals:', '')
  ) as normalized_symbol,
  'paradex' as exchange,
  CASE 
    WHEN funding_time > 10000000000 THEN funding_time / 1000
    ELSE funding_time
  END as funding_time,
  symbol as original_symbol,
  base_asset,
  rate_raw,
  rate_raw_percent,
  interval_hours,
  rate_1h_percent,
  rate_apr,
  CASE 
    WHEN collected_at > 10000000000 THEN collected_at / 1000
    ELSE collected_at
  END as collected_at,
  source,
  strftime('%s', 'now') as synced_at
FROM paradex_funding_v3
WHERE rate_raw IS NOT NULL
  AND ABS(rate_raw_percent) <= 10
LIMIT 50000;
