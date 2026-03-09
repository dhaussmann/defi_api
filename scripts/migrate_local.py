#!/usr/bin/env python3
"""
Local V4 migration script — reads from D1 via wrangler, writes to AE via Worker.
Bypasses Worker-side D1 reads entirely to avoid D1 overload errors.

No API tokens needed — uses your existing wrangler login for D1 reads,
and posts rows to the Worker's /api/v4/admin/migrate/batch endpoint.

Usage:
  python3 scripts/migrate_local.py
"""

import json
import subprocess
import time
import urllib.request
import urllib.error

TOTAL_ROWS = 7_518_482
BATCH_SIZE = 2000
WORKER_URL = "https://defiapi.cloudflareone-demo-account.workers.dev"


def query_d1(sql: str) -> list[dict]:
    """Run a SQL query against D1 via wrangler CLI."""
    result = subprocess.run(
        ["wrangler", "d1", "execute", "defiapi-unified-funding", "--remote",
         "--command", sql, "--json"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"wrangler d1 failed: {result.stderr}")
    data = json.loads(result.stdout)
    return data[0]["results"]


def write_to_ae_via_worker(rows: list[dict]) -> int:
    """
    Write rows directly to Analytics Engine via CF REST API.
    AE doesn't have a batch write REST API, so we POST to the Worker's
    admin endpoint which calls writeDataPoint() server-side.
    """
    # Build payload for worker admin endpoint
    payload = json.dumps({"rows": rows}).encode()
    req = urllib.request.Request(
        f"{WORKER_URL}/api/v4/admin/migrate/batch",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read())
            return body.get("written", len(rows))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Worker batch failed: {e.code} {e.read().decode()}")


def get_cursor() -> int:
    """Read current cursor from migration_state in DB_V4."""
    result = subprocess.run(
        ["wrangler", "d1", "execute", "defiapi-v4-markets", "--remote",
         "--command", "SELECT offset, total_migrated FROM migration_state WHERE id=1;",
         "--json"],
        capture_output=True, text=True
    )
    if result.returncode != 0 or not result.stdout.strip():
        return 0
    data = json.loads(result.stdout)
    rows = data[0].get("results", [])
    if not rows:
        return 0
    print(f"Resuming from cursor={rows[0]['offset']}, total_migrated={rows[0]['total_migrated']}")
    return int(rows[0]["offset"])


def save_cursor(cursor: int, total: int, state: str = "running") -> None:
    """Save cursor back to D1 migration_state."""
    now = int(time.time())
    subprocess.run(
        ["wrangler", "d1", "execute", "defiapi-v4-markets", "--remote",
         "--command",
         f"INSERT OR REPLACE INTO migration_state (id, state, offset, total_migrated, started_at, updated_at) "
         f"VALUES (1, '{state}', {cursor}, {total}, coalesce((SELECT started_at FROM migration_state WHERE id=1), {now}), {now});",
         "--json"],
        capture_output=True
    )


def main():
    cursor = get_cursor()
    total_migrated_start = 0

    # Get starting total from DB
    result = subprocess.run(
        ["wrangler", "d1", "execute", "defiapi-v4-markets", "--remote",
         "--command", "SELECT total_migrated FROM migration_state WHERE id=1;", "--json"],
        capture_output=True, text=True
    )
    if result.returncode == 0 and result.stdout.strip():
        data = json.loads(result.stdout)
        rows = data[0].get("results", [])
        if rows:
            total_migrated_start = int(rows[0]["total_migrated"])

    total_migrated = total_migrated_start
    batch_num = 0
    start_time = time.time()

    print(f"Starting local migration from cursor={cursor}, already migrated={total_migrated_start}")
    print("Press Ctrl+C to pause — will save cursor on exit.\n")

    try:
        while True:
            batch_num += 1
            t0 = time.time()

            # Fetch batch from D1
            rows = query_d1(
                f"SELECT normalized_symbol, exchange, funding_time, rate_apr, open_interest "
                f"FROM unified_v3 WHERE funding_time > {cursor} "
                f"ORDER BY funding_time ASC LIMIT {BATCH_SIZE};"
            )

            if not rows:
                print("\n✅ Migration complete!")
                save_cursor(cursor, total_migrated, "done")
                break

            # Write to AE via Worker batch endpoint
            written = write_to_ae_via_worker(rows)

            cursor = rows[-1]["funding_time"]
            total_migrated += len(rows)

            elapsed = time.time() - start_time
            rps = total_migrated / elapsed if elapsed > 0 else 0
            remaining = TOTAL_ROWS - total_migrated
            pct = total_migrated * 100 / TOTAL_ROWS
            eta_min = (remaining / rps / 60) if rps > 0 else 0
            batch_ms = (time.time() - t0) * 1000

            print(f"\r[{batch_num:4d}] {pct:5.1f}% | migrated={total_migrated:,} | remaining={remaining:,} | "
                  f"{rps:,.0f} rows/s | ETA {eta_min:.0f}m | batch {batch_ms:.0f}ms    ", end="", flush=True)

            # Save cursor every 10 batches
            if batch_num % 10 == 0:
                save_cursor(cursor, total_migrated)

    except KeyboardInterrupt:
        print(f"\n\nPaused at cursor={cursor}, total_migrated={total_migrated}")
        save_cursor(cursor, total_migrated)
        print("Run script again to resume.")


if __name__ == "__main__":
    main()
