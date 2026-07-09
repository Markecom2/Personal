# Daily EOD Planner

Twice-daily briefing (morning + evening) that pulls **Zoho Calendar**, **Zoho Mail**,
and a **custom MySQL PM tool**, has **Claude Haiku** rank what needs your attention,
and renders a dashboard-style HTML page you can view as a Claude Artifact.

## Quick start

```sh
pip install -r requirements.txt

# Preview with mock data (no external calls, no API key)
python scripts/eod_planner.py --mode morning --mock --skip-llm

# Preview with Claude Haiku on mock data (needs ANTHROPIC_API_KEY)
python scripts/eod_planner.py --mode morning --mock

# Run against real sources
cp .env.example .env    # fill in real values
python scripts/eod_planner.py --mode morning
python scripts/eod_planner.py --mode evening
```

Output lands in `daily/YYYY-MM-DD-{morning,evening}.html`.

## What to fill in (`.env`)

- **Zoho Mail (IMAP)** — email + app-specific password
  (Zoho account → Security → App Passwords)
- **Zoho Calendar (CalDAV)** — URL depends on your region:
  - `.com` → `https://calendar.zoho.com/caldav`
  - `.eu`  → `https://calendar.zoho.eu/caldav`
  - `.in`  → `https://calendar.zoho.in/caldav`
- **MySQL** — read-only credentials for the PM database.
  Then edit the query in `scripts/lib/pm_db.py` (`DEFAULT_QUERY`) to match your
  schema. The pipeline consumes `PMTask` objects; the SQL is the only place
  schema knowledge lives.
- **Anthropic** — `ANTHROPIC_API_KEY` for Haiku ranking. If missing, the
  planner falls back to rules-based ranking (still readable, just less nuanced).

## Morning vs evening

- **Morning** — today's calendar, priority tasks, emails from the last 36h.
- **Evening** — tomorrow's calendar, still-open tasks, remaining emails.

The LLM is told which mode it's in and adjusts framing.

## How the priority ranking works

Claude Haiku receives your calendar + emails + tasks and returns JSON that
buckets each item:

- **Emails**: `respond_now` / `respond_today` / `fyi` / `skip`
- **Tasks**: `top_focus` (max 3) / `important` / `later`

The template renders each bucket in a distinct section. `skip` emails are
dropped entirely; `later` tasks live in a collapsed `<details>`.

## Scheduling twice-daily runs

The intended runtime is **Claude Code Routines** — each firing wakes a Claude
session that runs this script and publishes the HTML as an Artifact.

Setup (once, in a Claude Code session):

```
create a Routine that runs `python scripts/eod_planner.py --mode morning`
every weekday at 8:00 AM ET, and another for `--mode evening` at 6:00 PM ET
```

## Layout

```
scripts/
├── eod_planner.py        # CLI entry
├── lib/
│   ├── config.py         # .env loader
│   ├── zoho_mail.py      # IMAP client
│   ├── zoho_calendar.py  # CalDAV client
│   ├── pm_db.py          # MySQL — edit DEFAULT_QUERY for your schema
│   ├── summarizer.py     # Claude Haiku ranking + rules fallback
│   └── render.py         # HTML assembly
└── templates/
    └── eod.html.j2       # Jinja template (light + dark mode)
mocks/                    # calendar.json, emails.json, tasks.json for --mock
daily/                    # generated HTML (git-ignored)
```

## CLI flags

- `--mode {morning,evening}` — required
- `--mock` — read from `mocks/` instead of live sources
- `--skip-llm` — deterministic rules-based ranking, no Claude API call
- `--out PATH` — override the output path
