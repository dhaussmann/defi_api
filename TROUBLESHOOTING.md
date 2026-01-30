# 2-DB Architecture Troubleshooting

## Current Issue: Trackers Not Persisting Data

**Deployed:** Version 3d350eaa-aa59-45b9-bf5c-87827de24a54  
**Time:** 2026-01-30 19:54 UTC

### Problem

1. ✅ All 13 trackers fixed to use `DB_WRITE.batch`
2. ✅ Code deployed successfully
3. ✅ Trackers start successfully
4. ❌ **Durable Objects lose state** - `/status` and `/debug` return `null`
5. ❌ **No data in DB_WRITE** - trackers appear to run but don't write

### Symptoms

```bash
# Tracker starts OK
curl https://api.fundingrate.de/tracker/variational/start
# → {"success":true,"status":"running"}

# But status returns null
curl https://api.fundingrate.de/tracker/variational/status
# → {"success":true,"data":{"running":null,"pollCount":null}}

# Debug endpoint sometimes works, sometimes returns null
curl https://api.fundingrate.de/tracker/variational/debug
# → Intermittent: sometimes shows data, sometimes null
```

### Root Cause Analysis

**Possible causes:**

1. **Durable Object State Loss**
   - Durable Objects may be evicted due to inactivity
   - State not persisting between requests
   - Possible Cloudflare platform issue

2. **DB_WRITE Connection Issue**
   - Batch writes may be failing silently
   - No error logging visible in tracker code
   - Need to add more logging around DB writes

3. **Migration Side Effects**
   - Old DB (env.DB) still exists and may cause conflicts
   - Trackers may have cached old DB reference

### Immediate Actions Needed

1. **Add Error Logging**
   ```typescript
   try {
     await this.env.DB_WRITE.batch(batch);
     console.log(`[Tracker] ✅ Saved ${records.length} records`);
   } catch (error) {
     console.error(`[Tracker] ❌ DB_WRITE.batch failed:`, error);
     throw error; // Re-throw to see in logs
   }
   ```

2. **Check Cloudflare Logs**
   ```bash
   wrangler tail --format pretty
   ```

3. **Verify DB_WRITE Binding**
   - Ensure DB_WRITE is correctly bound in wrangler.toml
   - Check if DB_WRITE database exists and is accessible

4. **Test Direct DB Write**
   - Create a test endpoint that writes directly to DB_WRITE
   - Verify the database accepts writes

### Workaround Options

**Option A: Revert to Single DB**
```bash
# Restore old configuration
cp wrangler.toml.backup wrangler.toml
wrangler deploy
./restart-trackers.sh
```

**Option B: Keep Old DB Active**
- Keep using `env.DB` for now
- Investigate 2-DB architecture issue separately
- The old DB still works and has no overload currently

**Option C: Debug Further**
- Add comprehensive logging to all tracker batch writes
- Monitor Cloudflare logs in real-time
- Test with a single tracker first (e.g., Variational)

### Next Steps

1. Check if old DB is still receiving data
2. Add error logging to tracker batch writes
3. Monitor wrangler tail for errors
4. Consider reverting if issue persists

### Files Modified

- All 13 `*Tracker.ts` files: Changed `env.DB.batch` → `env.DB_WRITE.batch`
- Deployed but trackers not writing data

### Questions

- Are Durable Objects supposed to maintain state between requests?
- Is there a Cloudflare platform issue with D1 bindings?
- Should we add persistent storage for tracker state?
