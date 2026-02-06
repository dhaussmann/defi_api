# V2 Data Validation Report
**Date:** 2026-02-04  
**Period:** Last 30 days (2026-01-05 to 2026-02-04)

## Executive Summary

Validation of all 5 V2 exchanges revealed **critical data quality issues** that must be addressed before deployment:

### ✅ Exchanges with Good Data Quality
- **Extended:** 55,478 records, 78 markets - Clean data
- **Hyperliquid:** 94,644 records, 190 markets - Clean data  
- **Binance:** 91,496 records, 581 markets - Clean data

### ⚠️ Exchanges with Critical Issues
- **Lighter:** 89,434 records, 129 markets - **CRITICAL: Wrong timestamp format**
- **Aster:** 18,006 records, 84 markets - Good timestamps, some extreme outliers

---

## Detailed Findings

### 1. **Lighter - CRITICAL TIMESTAMP ISSUE** ❌

**Problem:** Timestamps are stored in **seconds** instead of **milliseconds**

**Evidence:**
```sql
-- Lighter timestamps show year 1970 instead of 2026
SELECT timestamp, datetime(timestamp/1000, 'unixepoch') FROM lighter_raw_data LIMIT 1;
-- Result: 1767618000 → 1970-01-21 11:00:18 (WRONG!)

-- Should be: 1767618000000 → 2026-01-05 13:00:00 (CORRECT)
```

**Impact:**
- All 89,434 Lighter records have incorrect timestamps
- Date range shows "1970-01-21" instead of "2026-01-05 to 2026-02-04"
- This breaks all time-based queries and comparisons

**Root Cause:**
- Lighter API returns timestamps in **seconds**
- Import script and collector incorrectly store them without multiplying by 1000

**Fix Required:**
1. Update import script to multiply timestamps by 1000
2. Update TypeScript collector to multiply timestamps by 1000
3. Re-import all Lighter data with correct timestamps

---

### 2. **Aster - Good Timestamps, Some Outliers** ⚠️

**Status:** Timestamps are correct (milliseconds format)

**Data Quality:**
- ✅ Correct date range: 2026-01-05 13:00:00 to 2026-02-04 12:00:00
- ✅ 18,006 records from 84 symbols
- ⚠️ Some extreme APR outliers detected

**Outliers:**
- Min APR: -13,254.01% (extreme negative)
- Max APR: 412.3% (reasonable for volatile markets)
- Average APR: -37.35% (reasonable)

**Assessment:** Data is usable but contains some extreme values that may need investigation

---

### 3. **Extended - Clean Data** ✅

**Status:** All data looks correct

**Data Quality:**
- ✅ Correct date range: 2026-01-05 13:00:01 to 2026-02-04 12:00:00
- ✅ 55,478 records from 78 markets
- ✅ Reasonable APR range: -8,760% to 1,531.25%
- ✅ Average APR: -12.19%

**Top Outliers (Expected for volatile markets):**
- MEGA: -2,624% to 1,531%
- APEX: -640% to 1,527%
- ZORA: -8,760% to 168% (extreme negative spike)

**Assessment:** Data quality is good, outliers are within expected range for DeFi markets

---

### 4. **Hyperliquid - Clean Data** ✅

**Status:** All data looks correct

**Data Quality:**
- ✅ Correct date range: 2026-01-05 14:00:00 to 2026-02-04 13:00:00
- ✅ 94,644 records from 190 coins
- ✅ Reasonable APR range: -5,445% to 1,329%
- ✅ Average APR: -19.40%

**Assessment:** Data quality is excellent

---

### 5. **Binance - Clean Data with Expected Outliers** ✅

**Status:** All data looks correct

**Data Quality:**
- ✅ Correct date range: 2026-01-05 16:00:00 to 2026-02-04 15:00:00
- ✅ 91,496 records from 581 symbols
- ✅ Interval detection working: 1h (15 symbols), 4h (424 symbols), 8h (154 symbols)
- ⚠️ Some extreme outliers in new/volatile tokens

**Interval Distribution:**
- 1h interval: 3,545 records (15 symbols) - e.g., RIVER, CLO
- 4h interval: 74,121 records (424 symbols) - Majority of new tokens
- 8h interval: 13,830 records (154 symbols) - Traditional tokens (BTC, ETH, etc.)

**Extreme Outliers (New/Volatile Tokens):**
- BULLAUSDT: -17,520% to 3,298% APR (255 records)
- RIVERUSDT: -17,520% to 782% APR (518 records)
- CLOUSDT: -17,520% to 809% APR (285 records)

**Assessment:** 
- Data quality is good
- Extreme outliers are expected for newly listed tokens with low liquidity
- -17,520% represents the maximum possible negative rate (200% per hour * 24 * 365)

---

## APR Plausibility Analysis

### Normal APR Ranges (Established Markets)
- **Typical range:** -100% to +100% APR
- **Volatile range:** -500% to +500% APR
- **Extreme range:** -2,000% to +2,000% APR (rare, but possible)

### Outliers by Exchange

| Exchange | Records with APR > 1000% | Records with APR < -1000% | Assessment |
|----------|--------------------------|---------------------------|------------|
| Lighter | ~50 | ~100 | Plausible for volatile markets |
| Aster | ~10 | ~50 | Some extreme outliers |
| Extended | ~20 | ~30 | Within expected range |
| Hyperliquid | ~30 | ~80 | Within expected range |
| Binance | ~100 | ~200 | Expected for new tokens |

**Conclusion:** Outliers are generally plausible for DeFi markets, especially for:
- Newly listed tokens
- Low liquidity markets
- Volatile periods
- Market manipulation attempts

---

## Critical Actions Required

### 🚨 **PRIORITY 1: Fix Lighter Timestamps**

**Files to modify:**
1. `scripts/v2_import_lighter_working.sh` - Line ~70-80
2. `src/v2_LighterCollector.ts` - Line ~140-150

**Changes needed:**
```bash
# Import script - multiply timestamp by 1000
timestamp_ms=$((timestamp * 1000))
```

```typescript
// TypeScript collector - multiply timestamp by 1000
const timestampMs = item.value * 1000;
```

**Steps:**
1. Fix import script
2. Fix TypeScript collector
3. Delete all Lighter data: `DELETE FROM lighter_raw_data`
4. Re-run import: `bash scripts/v2_import_lighter_working.sh 30`
5. Verify timestamps are correct

---

## Summary Statistics (After Lighter Fix)

| Exchange | Records | Markets | Date Range | Avg APR | Status |
|----------|---------|---------|------------|---------|--------|
| Binance | 91,496 | 581 | 2026-01-05 to 2026-02-04 | -55.36% | ✅ Ready |
| Hyperliquid | 94,644 | 190 | 2026-01-05 to 2026-02-04 | -19.40% | ✅ Ready |
| Lighter | 89,434 | 129 | **WRONG DATES** | -15.95% | ❌ **FIX REQUIRED** |
| Extended | 55,478 | 78 | 2026-01-05 to 2026-02-04 | -12.19% | ✅ Ready |
| Aster | 18,006 | 84 | 2026-01-05 to 2026-02-04 | -37.35% | ✅ Ready |
| **TOTAL** | **349,058** | **1,062** | - | **-27.97%** | **⚠️ Lighter needs fix** |

---

## Recommendations

### Before Deployment:
1. ✅ **Fix Lighter timestamp issue** (CRITICAL)
2. ✅ Verify all timestamps are in milliseconds
3. ✅ Re-import Lighter data
4. ✅ Run validation queries again
5. ✅ Test TypeScript collectors with correct timestamps

### Optional Improvements:
- Add data validation in collectors to detect timestamp format issues
- Add APR range validation (e.g., flag values > 10,000% or < -10,000%)
- Add monitoring for data gaps (missing hours)
- Add alerts for extreme outliers

---

## Validation Queries

Use these queries to verify data quality after fixes:

```sql
-- Check timestamp format (should all be > 1000000000000)
SELECT 'lighter' as exchange, 
  MIN(timestamp) as min_ts, 
  MAX(timestamp) as max_ts,
  CASE WHEN MIN(timestamp) < 1000000000000 THEN 'WRONG FORMAT' ELSE 'OK' END as status
FROM lighter_raw_data;

-- Check date ranges
SELECT 'lighter' as exchange,
  MIN(datetime(timestamp/1000, 'unixepoch')) as earliest,
  MAX(datetime(timestamp/1000, 'unixepoch')) as latest
FROM lighter_raw_data;

-- Check for data gaps (should be ~720 records per symbol for 30 days)
SELECT symbol, COUNT(*) as records
FROM lighter_raw_data
GROUP BY symbol
HAVING records < 600 OR records > 800
ORDER BY records;

-- Check APR outliers
SELECT symbol, 
  COUNT(*) as records,
  ROUND(MIN(rate_annual), 2) as min_apr,
  ROUND(MAX(rate_annual), 2) as max_apr,
  ROUND(AVG(rate_annual), 2) as avg_apr
FROM lighter_raw_data
GROUP BY symbol
HAVING min_apr < -5000 OR max_apr > 5000
ORDER BY max_apr DESC;
```

---

## Conclusion

**Current Status:** 4 out of 5 exchanges have clean, deployment-ready data. Lighter requires a critical timestamp fix before deployment.

**Estimated Fix Time:** 30-45 minutes (fix scripts + re-import)

**Deployment Readiness:** **NOT READY** - Lighter timestamp issue must be fixed first.
