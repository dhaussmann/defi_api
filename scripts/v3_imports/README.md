# V3 Import Scripts - Historical Data Import

This directory contains import scripts for loading historical funding rate data (last 30 days) for all V3 collectors.

## Overview

| Exchange | Script | Import Function | Status | Notes |
|----------|--------|----------------|--------|-------|
| Extended | `import-extended-v3.sh` | ✅ Available | Ready | Uses collector import function |
| Hyperliquid | `import-hyperliquid-v3.sh` | ✅ Available | Ready | Uses collector import function |
| Lighter | `import-lighter-v3.sh` | ✅ Available | Ready | Uses collector import function |
| Aster | `import-aster-v3.sh` | ✅ Available | Ready | Uses collector import function |
| Nado | `import-nado-v3.sh` | ⚠️ Manual | **Needs Info** | API structure unknown |
| HyENA | `import-hyena-v3.sh` | ⚠️ Manual | **Needs Info** | Uses Hyperliquid API - needs historical endpoint |
| Felix | `import-felix-v3.sh` | ⚠️ Manual | **Needs Info** | Uses Hyperliquid API - needs historical endpoint |
| Ventuals | `import-ventuals-v3.sh` | ⚠️ Manual | **Needs Info** | Uses Hyperliquid API - needs historical endpoint |
| XYZ | `import-xyz-v3.sh` | ⚠️ Manual | **Needs Info** | Uses Hyperliquid API - needs historical endpoint |
| Variational | `import-variational-v3.sh` | ⚠️ Manual | **Needs Info** | API structure unknown |
| Paradex | `import-paradex-v3.sh` | ✅ Available | Ready | Uses time window approach |
| EdgeX | `import-edgex-v3.sh` | ✅ Available | Ready | Adapted from V2 script |

## Usage

Each script can be run independently:

```bash
# Example: Import Extended historical data
./scripts/v3_imports/import-extended-v3.sh

# With custom days back
./scripts/v3_imports/import-extended-v3.sh 60
```

## ⚠️ Collectors Needing Additional Information

### 1. **Nado** - Missing API Information
- Current: Only current data collection works
- Needed: Historical data API endpoint/method

### 2. **HyENA, Felix, Ventuals, XYZ** - Hyperliquid-based
- Current: Use Hyperliquid API with `dex` parameter
- Needed: Historical funding rate endpoint for these DEXes
- Note: May need to check if Hyperliquid API supports historical queries with `dex` parameter

### 3. **Variational** - Missing Historical Endpoint
- Current: Uses `/metadata/stats` for current data
- Needed: Historical data endpoint or method

### 4. **EdgeX** - Adapted from V2 ✅
- Current: Fully adapted for V3 schema
- Note: Uses hourly aggregation of all funding rates
- Status: Ready to use

### 5. **Paradex** - Time Window Approach ✅
- Current: Uses `/v1/funding/data` with `start_time`/`end_time` parameters
- Strategy: 2-day time windows to avoid pagination limits
- Status: Ready to use

## Notes

- All scripts are set to **NOT auto-run** - they require user approval
- Default import period: **30 days**
- Data is inserted with `source = 'import'` to distinguish from live collection
- Scripts use `INSERT OR REPLACE` to handle duplicates
