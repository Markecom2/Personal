# Mark's Day — daily operating dashboard

A live, checkable dashboard for planning **start of day**, working through it, and
**wrapping up at end of day**. It reads Mark's Zoho inbox continuously and
converts action-worthy emails into tasks automatically. Task state syncs back to
Zoho Personal Tasks so nothing lives only in one place.

**Live dashboard**: https://claude.ai/code/artifact/526731de-3797-4ccc-857e-b4e7e3107c6e

## How it works

Three moving parts:

1. **The dashboard** (`dashboard/day.html`) — a Claude Artifact with a live task
   database. Check a box → the task is marked done, the meter updates, and every
   open view reloads. Add a task in the composer → it appears everywhere.
   Persists via the Artifact `db` capability.

2. **Sync routines** (`routines/*.md`) — prompts fired by Claude Code Routines
   on a schedule. Each routine wakes a Claude session that uses the Zoho MCP
   server to fetch mail/calendar, decides what needs Mark's attention, and
   writes into the dashboard's DB via the `Artifact write_db` action.

3. **Zoho** — source of truth for email, calendar, and durable task history
   (Zoho Personal Tasks). The dashboard is the working surface; Zoho is the
   long-lived record.

## The three routines

| Routine | Fires | What it does |
|---|---|---|
| [`sod_brief.md`](routines/sod_brief.md) | Weekdays 08:00 | Loads today's calendar, ranks focus set (3 items), clears yesterday's done tasks. |
| [`sync_email.md`](routines/sync_email.md) | Every hour, 08–20, weekdays | Scans inbox (last 7 days), extracts action items, adds them as tasks. Dedupes against already-seen messages. |
| [`eod_wrap.md`](routines/eod_wrap.md) | Weekdays 18:00 | Mirrors completed tasks to Zoho Personal Tasks, writes a wrap-up summary, rolls unfinished focus items to tomorrow. |

## Setup

**Prerequisites**: the Zoho MCP server must be authorized in Claude Code
(claude.ai → connectors → Zoho → connect). Once connected,
`mcp__Zoho__ZohoMail_listEmails` and friends become callable from Claude Code
sessions.

**Wire up the routines** (once):

```
In a Claude Code session, ask:

"Create a Claude Code Routine that fires the prompt in
routines/sync_email.md every hour, Monday–Friday, 08:00–20:00 America/New_York."

Repeat for sod_brief.md (weekdays 08:00) and eod_wrap.md (weekdays 18:00).
```

Each routine reads its own prompt file and follows it — no other setup needed.

## Dashboard sections

- **Today** — calendar events, with time-based highlight for "happening now"
- **Focus** — the 3 things that matter most today (SOD ranks these)
- **From email** — auto-extracted from the inbox scan
- **Project queue** — open items from the PM tool (populated by an optional PM sync routine you can add)
- **Later** — parked / non-urgent
- **End of day** — done today, rolling-over counts, wrap summary

Keyboard: `A` focuses the add-task input; click any checkbox to clear a task.

## Data shape (dashboard DB)

- `tasks/<id>` — one doc per task: `{title, why?, source, priority, status, createdAt, completedAt?, emailId?, zohoSynced?}`
- `events/<YYYY-MM-DD>/items/<id>` — today's calendar
- `email_seen/<sanitized-message-id>` — dedupe log for email→task conversion
- `wrap_ups/<YYYY-MM-DD>` — one EOD summary per day
- `meta/sync` — last-run info, shown as "Last sync: …" in the dashboard footer

## What's not here

- No custom database. Zoho + Artifact DB is all the persistence there is.
- No IMAP or CalDAV. The old plan used them; both were blocked by the sandbox
  network policy. The Zoho MCP path is HTTPS and works from Claude Code sessions.
- No standalone Python script. The old `scripts/` code is kept in
  `scripts/legacy/` for reference, but nothing runs it any more.
