#!/usr/bin/env python3
"""
Simple migration script to copy market_history from old DB to new DB
Uses wrangler CLI to export/import data in batches
"""

import subprocess
import json
import time
import sys

START_TS = 1767348000  # Jan 2, 2026
END_TS = 1767891600    # Jan 8, 2026
BATCH_SIZE = 500

def run_command(cmd):
    """Run shell command and return output"""
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        return None
    return result.stdout

def export_batch(offset):
    """Export a batch from old DB"""
    cmd = f"""wrangler d1 execute defiapi-db --remote --command "
        SELECT 
            exchange, symbol, hour_timestamp, 
            min_price, max_price, mark_price, index_price,
            volume_base, volume_quote, open_interest, open_interest_usd, max_open_interest_usd,
            avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
            sample_count, COALESCE(volatility, 0) as volatility
        FROM market_history 
        WHERE hour_timestamp >= {START_TS} AND hour_timestamp <= {END_TS}
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
        # Escape single quotes in strings
        exchange = r['exchange'].replace("'", "''")
        symbol = r['symbol'].replace("'", "''")
        
        # Handle NULL values
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
    
    sql = f"""INSERT OR IGNORE INTO market_history (
        exchange, symbol, hour_timestamp,
        min_price, max_price, mark_price, index_price,
        volume_base, volume_quote, open_interest, open_interest_usd, max_open_interest_usd,
        avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
        sample_count, volatility
    ) VALUES {','.join(values)};"""
    
    return sql

def import_batch(sql, batch_num):
    """Import batch into new DB"""
    # Write SQL to temp file
    filename = f'/tmp/migration_batch_{batch_num}.sql'
    with open(filename, 'w') as f:
        f.write(sql)
    
    cmd = f"wrangler d1 execute defiapi-db-write --remote --file={filename}"
    result = run_command(cmd)
    return result is not None

def main():
    print("Starting migration of market_history data...")
    print(f"Period: Jan 2-8, 2026 (timestamps {START_TS} to {END_TS})")
    print(f"Batch size: {BATCH_SIZE}")
    print()
    
    # Get total count
    total_cmd = f"""wrangler d1 execute defiapi-db --remote --command "
        SELECT COUNT(*) as count FROM market_history 
        WHERE hour_timestamp >= {START_TS} AND hour_timestamp <= {END_TS}
    " --json"""
    
    total_output = run_command(total_cmd)
    if total_output:
        try:
            data = json.loads(total_output)
            total = data[0]['results'][0]['count']
            print(f"Total records to migrate: {total}")
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
    total_migrated = 0
    
    while offset < total:
        print(f"Processing batch {batch_num} (offset: {offset})...", end=' ')
        
        # Export batch
        records = export_batch(offset)
        if not records:
            print("No more records, stopping.")
            break
        
        # Create and import SQL
        sql = create_insert_sql(records)
        if import_batch(sql, batch_num):
            total_migrated += len(records)
            print(f"✓ {len(records)} records")
        else:
            print(f"✗ Failed")
            sys.exit(1)
        
        offset += BATCH_SIZE
        batch_num += 1
        
        # Small delay to avoid rate limiting
        time.sleep(1)
    
    print()
    print(f"Migration completed! Total migrated: {total_migrated}")
    print()
    print("Verifying...")
    
    # Verify
    verify_cmd = f"""wrangler d1 execute defiapi-db-write --remote --command "
        SELECT COUNT(*) as count FROM market_history 
        WHERE hour_timestamp >= {START_TS} AND hour_timestamp <= {END_TS}
    " --json"""
    
    verify_output = run_command(verify_cmd)
    if verify_output:
        try:
            data = json.loads(verify_output)
            new_count = data[0]['results'][0]['count']
            print(f"Records in new DB: {new_count}")
            print(f"Expected: {total_migrated}")
            
            if new_count >= total_migrated:
                print("✓ Migration successful!")
            else:
                print("⚠ Warning: Record count mismatch")
        except:
            print("Could not verify migration")

if __name__ == '__main__':
    main()
