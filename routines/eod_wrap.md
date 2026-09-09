# Routine: end-of-day wrap-up (weekdays 18:00)

**Fires**: 18:00 local, Mon–Fri.
**Purpose**: reflect on what got done, roll open focus items forward, mirror completed tasks to Zoho.

## What to do

1. **Load today's tasks** from the dashboard DB.

2. **Sync completions back to Zoho**. For every task where `status == "done"` and `source in ["email", "manual", "pm"]` and no `zohoSynced` field: create a Zoho Personal Task via `mcp__Zoho__ZohoMail_addPersonalTask` with the task title marked done (or with a `[done <date>]` prefix if the API can't set completion state directly). Then `update` the doc with `zohoSynced: true`.
   
   Why: Zoho Personal Tasks is the durable, cross-device record. The dashboard is the daily working surface.

3. **Identify rollovers**. Any `top` task still `open` at end of day becomes tomorrow's carryover. Add a `carriedFrom: "<today-date>"` field so Mark can see what's been sitting.

4. **Write a wrap summary** to `wrap_ups/<today-YYYY-MM-DD>` with:
   ```json
   {
     "date": "<YYYY-MM-DD>",
     "cleared": <N done today>,
     "rolledOver": <N open focus>,
     "newFromEmail": <N tasks with source=email created today>,
     "topClearedTitles": ["...", "..."],
     "topOpenTitles": ["...", "..."]
   }
   ```
   This becomes a searchable log Mark can look back on.

5. **Update meta**. `set` `meta/sync` with `{ lastRunAt, kind: "eod", cleared, rolledOver }`.

6. **Report** to the session log: two sentences — what got cleared, what's rolling over. No individual task detail unless something looks stuck (a `top` task that's been rolled over 3+ days deserves a mention).

## Dashboard artifact URL

`https://claude.ai/code/artifact/526731de-3797-4ccc-857e-b4e7e3107c6e`
