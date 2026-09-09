# Routine: hourly email → task sync

**Fires**: every hour, 8:00–20:00 local, weekdays.
**Purpose**: scan Mark's Zoho inbox for new action items, add them to the dashboard as tasks.

## What to do

1. **Fetch email**. Use `mcp__Zoho__ZohoMail_listEmails` to pull messages received in the **last 7 days** from the primary inbox (any status — read or unread). Cap at 100 most recent.

2. **Deduplicate against already-imported emails**. Read `email_seen/` collection from the dashboard DB (URL below) — each doc's ID is a Zoho message ID we've already processed. Skip those.

3. **For each new message**, decide whether it requires action from Mark:
   - **Yes** → extract a single crisp task title (imperative, ≤ 90 chars) and a one-line `why` (sender + what the ask is). Then classify:
     - **`category`**: `project` (client delivery, integration work, campaign delivery — anything that has a client name or deliverable attached), `admin` (billing, subscriptions, access requests, HR), `security` (auth alerts, unusual sign-ins, breach notifications), `personal` (everything else).
     - **`project`** (only when `category = "project"`): the client or product name — e.g. `"DFK ANZ"`, `"TGE × Resova integration"`, `"Perfect Travel Group"`. Keep it short (≤ 40 chars) and consistent across tasks that belong to the same effort.
     - **`priority`**: `top` (explicit deadline in ≤ 48h, or high-value inbound — wholesale, partner, customer complaint from paying account), `mid` (reply expected within a few days, invoice due, decision needed), `later` (FYI-with-followup, newsletters worth reading, low-stakes review).
     - **`deadline`** (ISO date `YYYY-MM-DD`): extract from the email body when explicit ("by Friday", "before EOD Tuesday", "due 15 Sep"). If implicit (a colleague blocked, waiting on your reply), infer a reasonable one — same day for urgent unblocks, ≤3 days for warm inbounds, end of week for lower stakes. Leave omitted only when there truly is no time signal.
     - **`deadlineText`** (optional): the raw phrase from the email if `deadline` was inferred — helps Mark trust or override the guess.
   - **No** (newsletter with no action, automated report Mark reads passively, marketing, spam) → skip.
4. **Write results**. Use `Artifact` tool with `action: "write_db"`, `db_op: "batch"`, `url` below.
   For each new task: `set` at `tasks/msg_<zoho-message-id>` with:
   ```json
   {
     "title": "...",
     "why": "From: <sender>. <one-line ask>",
     "source": "email",
     "category": "project|admin|security|personal",
     "project": "<client/product name, if category=project>",
     "priority": "top|mid|later",
     "deadline": "YYYY-MM-DD",
     "deadlineText": "<raw phrase, if inferred>",
     "status": "open",
     "createdAt": "<ISO timestamp>",
     "emailId": "<zoho-message-id>",
     "emailSubject": "<subject>",
     "emailFrom": "<sender>"
   }
   ```
   And a companion `set` at `email_seen/<zoho-message-id>` with `{ "seenAt": "<ISO>" }` so we skip it next run.
5. **Update sync meta**. `set` at `meta/sync` with:
   ```json
   { "lastRunAt": "<ISO>", "kind": "email", "processed": <N>, "created": <N> }
   ```
6. **Report**. One-line summary: `Scanned N emails, added M tasks, skipped K.` Do not narrate the individual decisions unless asked.

## Rules

- **Never** create a task from an email already in `email_seen/`.
- If Zoho MCP is unavailable, write `meta/sync` with `error: "zoho unavailable"` and stop.
- If you're unsure whether an email is actionable, err toward skip. It's better to miss one task than flood the dashboard.
- Zoho message IDs can contain characters that aren't valid in doc IDs (`.`, `/`). Sanitize by replacing them with `_`.

## Dashboard artifact URL

`https://claude.ai/code/artifact/526731de-3797-4ccc-857e-b4e7e3107c6e`
