# Routine: start-of-day brief (weekdays 08:00)

**Fires**: 08:00 local, Mon–Fri.
**Purpose**: prime the dashboard for the day — today's calendar, ranked focus set, cleanup of stale done tasks.

## What to do

1. **Fetch calendar**. Pull today's events. Preferred: Zoho Calendar via MCP if a calendar tool exists on the connector (search for `mcp__Zoho__*Calendar*`). Fallback: skip and note in `meta/sync` that calendar isn't available.

2. **Load open tasks** from the dashboard DB: `list` at `tasks/` where `status == "open"`.

3. **Rank focus items**. Look across all open tasks (email, pm, manual). Pick the **3 most important** — the ones that, if left undone, would matter most to Mark today. Signals:
   - Explicit deadline today
   - Blocking someone else
   - Time-sensitive external commitment (customer, partner, board)
   - Large financial or strategic weight
   
   For those 3, `update` at `tasks/<id>` with `priority: "top"`. For everything else currently `top`, downgrade to `mid` unless it still meets the criteria.

4. **Write calendar to DB**. Clear `events/<today-YYYY-MM-DD>/items/` then `set` each event as `{title, start: "HH:MM", end: "HH:MM", who, location?}`.

5. **Clear yesterday's done tasks**. `list` at `tasks/` where `status == "done"` and `completedAt` before today 00:00 — `delete` each one. (Keeps the "cleared today" meter accurate.)

6. **Roll over uncompleted focus from yesterday**. Any `top` task from yesterday that's still open stays open with `priority: "top"` — no action needed, just note it.

7. **Update meta**. `set` `meta/sync` with `{ lastRunAt, kind: "sod", focusCount, eventCount }`.

## Dashboard artifact URL

`https://claude.ai/code/artifact/526731de-3797-4ccc-857e-b4e7e3107c6e`
