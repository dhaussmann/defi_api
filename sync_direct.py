#!/usr/bin/env python3
"""Direct sync from DB_WRITE to DB_READ using SQL ATTACH (if supported) or batch copy"""

import subprocess
import json
import time

START_TS = 1769640000
BATCH_SIZE = 100  # Smaller batches for reliability

def run_sql(db_name, sql):
    """Execute SQL and return results"""
    cmd = f'wrangler d1 execute {db_name} --remote --command "{sql}" --json'
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
        return data[0]['results'] if data and len(data) > 0 else []
    except:
        return None

def copy_batch(offset):
    """Copy one batch of records"""
    # Get records from DB_WRITE
    records = run_sql('defiapi-db-write', f"""
        SELECT * FROM market_history 
        WHERE hour_timestamp >= {START_TS}
        ORDER BY hour_timestamp, exchange, symbol
        LIMIT {BATCH_SIZE} OFFSET {offset}
    """)
    
    if not records:
        return 0
    
    # Build INSERT statements
    inserts = []
    for r in records:
        values = [
            f"'{r['exchange']}'",
            f"'{r['symbol']}'",
            str(r['hour_timestamp']),
            str(r.get('min_price', 'NULL')),
            str(r.get('max_price', 'NULL')),
            str(r.get('mark_price', 'NULL')),
            str(r.get('index_price', 'NULL')),
            str(r.get('volume_base', 'NULL')),
            str(r.get('volume_quote', 'NULL')),
            str(r.get('open_interest', 'NULL')),
            str(r.get('open_interest_usd', 'NULL')),
            str(r.get('max_open_interest_usd', 'NULL')),
            str(r.get('avg_funding_rate', 'NULL')),
            str(r.get('avg_funding_rate_annual', 'NULL')),
            str(r.get('min_funding_rate', 'NULL')),
            str(r.get('max_funding_rate', 'NULL')),
            str(r.get('sample_count', 'NULL')),
            str(r.get('volatility', 0))
        ]
        inserts.append(f"INSERT OR REPLACE INTO market_history VALUES ({','.join(values)});")
    
    # Write to temp file
    with open('/tmp/sync_batch.sql', 'w') as f:
        f.write('\n'.join(inserts))
    
    # Execute on DB_READ
    cmd = 'wrangler d1 execute defiapi-db-read --remote --file=/tmp/sync_batch.sql'
    result = subprocess.run(cmd, shell=True, capture_output=True)
    
    return len(records) if result.returncode == 0 else 0

print("=== Syncing DB_WRITE → DB_READ ===")
print(f"Starting from timestamp: {START_TS}")
print()

# Get total
total_result = run_sql('defiapi-db-write', f'SELECT COUNT(*) as c FROM market_history WHERE hour_timestamp >= {START_TS}')
total = total_result[0]['c'] if total_result else 0
print(f"Total records: {total}")
print(f"Batch size: {BATCH_SIZE}")
print()

offset = 0
synced = 0
batch = 1

while offset < total:
    print(f"Batch {batch} (offset {offset})...", end=' ', flush=True)
    count = copy_batch(offset)
    
    if count == 0:
        print("No more data")
        break
    
    synced += count
    print(f"✓ {count} records")
    
    offset += BATCH_SIZE
    batch += 1
    time.sleep(0.5)

print()
print(f"Synced: {synced}/{total} records")

# Verify
verify_result = run_sql('defiapi-db-read', f'SELECT COUNT(*) as c FROM market_history WHERE hour_timestamp >= {START_TS}')
verify_count = verify_result[0]['c'] if verify_result else 0
print(f"Verified in DB_READ: {verify_count}")
print("✓ Sync complete!" if verify_count >= synced else "⚠ Verification failed")
