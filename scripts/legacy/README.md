# Legacy — obsolete twice-daily HTML briefer

These files were the first version: a Python script that pulled Zoho (via IMAP
and CalDAV), asked Claude Haiku to rank, and rendered a static HTML briefing.

**Retired because:**
- IMAP is raw TCP; the Claude Code sandbox only proxies HTTPS, so `imaplib`
  timed out.
- CalDAV to `calendar.zoho.in` was denied by the environment's egress policy.
- The static HTML wasn't checkable — you couldn't mark tasks done and have
  state persist.

**Replaced by:**
- `dashboard/day.html` — interactive Artifact with the `db` runtime capability
  (checkable, live, persistent)
- `routines/*.md` — prompts fired by Claude Code Routines that use the Zoho
  MCP server (HTTPS, works from Claude sessions) to sync mail/calendar into
  the dashboard DB

Kept here for reference in case any piece — the mock data shape, the LLM
prompt structure — is useful to lift.
