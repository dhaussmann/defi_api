#!/usr/bin/env python3
"""
Sync market_history data from DB_WRITE to DB_READ
Copies all data from Jan 30 onwards that's missing in DB_READ
"""

import subprocess
import json
import time
import sys

# Copy data from Jan 30, 2026 onwards (timestamp 1769640000)
START_TS = 1769640000  # Jan 30, 2026
BATCH_SIZE = 500

def run_command(cmd):
    """Run shell command and return output"""
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        return None
    return result.stdout

def export_batch(offset):
    """Export a batch from DB_WRITE"""
    cmd = f"""wrangler d1 execute defiapi-db-write --remote --command "
        SELECT 
            exchange, symbol, hour_timestamp, 
            min_price, max_price, mark_price, index_price,
            volume_base, volume_quote, open_interest, open_interest_usd, max_open_interest_usd,
            avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
            sample_count, COALESCE(volatility, 0) as volatility
        FROM market_history 
        WHERE hour_timestamp >= {START_TS}
        ORDER BY hour_timestamp, exchange, symbol
        LIMIT {BATCH_SIZE} OFFSET {offset}
    " --json"""
    
    output = run_command(cmd)
    if not output:
        return []
    
    try:
        data = json.loads(output)
        if data and len(data) > 0 and 'results' in data[0]:
            return data[0]['results']
    except json.JSONDecodeError as e:
        print(f"JSON decode error: {e}")
    
    return []

def create_insert_sql(records):
    """Create INSERT SQL statements from records"""
    if not records:
        return ""
    
    values = []
    for r in records:
        exchange = r['exchange'].replace("'", "''")
        symbol = r['symbol'].replace("'", "''")
        
        def fmt(val):
            if val is None or val == 'null':
                return 'NULL'
            if isinstance(val, str):
                return f"'{val}'"
            return str(val)
        
        value = f"""(
            '{exchange}', '{symbol}', {r['hour_timestamp']},
            {fmt(r.get('min_price'))}, {fmt(r.get('max_price'))}, {fmt(r.get('mark_price'))}, {fmt(r.get('index_price'))},
            {fmt(r.get('volume_base'))}, {fmt(r.get('volume_quote'))}, {fmt(r.get('open_interest'))}, 
            {fmt(r.get('open_interest_usd'))}, {fmt(r.get('max_open_interest_usd'))},
            {fmt(r.get('avg_funding_rate'))}, {fmt(r.get('avg_funding_rate_annual'))}, 
            {fmt(r.get('min_funding_rate'))}, {fmt(r.get('max_funding_rate'))},
            {fmt(r.get('sample_count'))}, {fmt(r.get('volatility', 0))}
        )"""
        values.append(value)
    
    sql = f"""INSERT OR REPLACE INTO market_history (
        exchange, symbol, hour_timestamp,
        min_price, max_price, mark_price, index_price,
        volume_base, volume_quote, open_interest, open_interest_usd, max_open_interest_usd,
        avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
        sample_count, volatility
    ) VALUES {','.join(values)};"""
    
    return sql

def import_batch(sql, batch_num):
    """Import batch into DB_READ"""
    filename = f'/tmp/sync_batch_{batch_num}.sql'
    with open(filename, 'w') as f:
        f.write(sql)
    
    cmd = f"wrangler d1 execute defiapi-db-read --remote --file={filename}"
    result = run_command(cmd)
    return result is not None

def main():
    print("Syncing market_history from DB_WRITE to DB_READ...")
    print(f"Starting from timestamp: {START_TS} (Jan 30, 2026)")
    print(f"Batch size: {BATCH_SIZE}")
    print()
    
    # Get total count from DB_WRITE
    total_cmd = f"""wrangler d1 execute defiapi-db-write --remote --command "
        SELECT COUNT(*) as count FROM market_history 
        WHERE hour_timestamp >= {START_TS}
    " --json"""
    
    total_output = run_command(total_cmd)
    if total_output:
        try:
            data = json.loads(total_output)
            total = data[0]['results'][0]['count']
            print(f"Total records to sync: {total}")
            print(f"Estimated batches: {(total // BATCH_SIZE) + 1}")
            print()
        except:
            print("Could not determine total count, proceeding anyway...")
            total = 999999
    else:
        print("Could not determine total count, proceeding anyway...")
        total = 999999
    
    offset = 0
    batch_num = 1
    total_synced = 0
    
    while offset < total:
        print(f"Processing batch {batch_num} (offset: {offset})...", end=' ')
        
        records = export_batch(offset)
        if not records:
            print("No more records, stopping.")
            break
        
        sql = create_insert_sql(records)
        if import_batch(sql, batch_num):
            total_synced += len(records)
            print(f"✓ {len(records)} records")
        else:
            print(f"✗ Failed")
            sys.exit(1)
        
        offset += BATCH_SIZE
        batch_num += 1
        time.sleep(1)
    
    print()
    print(f"Sync completed! Total synced: {total_synced}")
    print()
    print("Verifying...")
    
    verify_cmd = f"""wrangler d1 execute defiapi-db-read --remote --command "
        SELECT COUNT(*) as count FROM market_history 
        WHERE hour_timestamp >= {START_TS}
    " --json"""
    
    verify_output = run_command(verify_cmd)
    if verify_output:
        try:
            data = json.loads(verify_output)
            new_count = data[0]['results'][0]['count']
            print(f"Records in DB_READ: {new_count}")
            print(f"Expected: {total_synced}")
            
            if new_count >= total_synced:
                print("✓ Sync successful!")
            else:
                print("⚠ Warning: Record count mismatch")
        except:
            print("Could not verify sync")

if __name__ == '__main__':
    main()
