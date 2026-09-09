# Routine: Slack → task sync

**Fires**: every hour (same cadence as email sync).
**Purpose**: scan Slack mentions of Mark for action items, add them to the dashboard as tasks.

## Identity note (important)

The Slack MCP is authenticated as **Jatin** (`U0A0XHWMXL2`), not Mark. So:

- `to:me` and `in:@me` return **Jatin's** DMs, not Mark's. Do **not** use those filters.
- Mark's real Slack user ID is **`U09FETA9648`** — filter for messages that mention him.
- Slack DMs sent to `U09FETA9648` still land in Mark's DMs (via Jatin's account) — the Slack notification path in `sync_email.md` step 6 works correctly.

## What to do

1. **Search for Mark's mentions**. Use `mcp__Slack__slack_search_public_and_private` with:
   ```
   query: <@U09FETA9648> after:<7-days-ago-YYYY-MM-DD> -from:<@U09FETA9648>
   sort: timestamp
   limit: 30
   ```
   The `-from:` filter excludes Mark's own messages. The `after:` cutoff should be exactly 7 days before today.

2. **Deduplicate**. Read the `slack_seen/` collection from the dashboard DB (URL below). Each doc's ID is a sanitized `message_ts` (dots replaced with underscores). Skip any message already there.

3. **For each new mention**, decide if Mark needs to act:
   - **Yes** → same schema as email tasks:
     - `title` (imperative, ≤ 90 chars)
     - `why`: `"From <sender> in <#channel>. <one-line ask>"`
     - `source`: `"slack"`
     - `category`: `project` | `admin` | `security` | `personal`
     - `project`: client/product name when category=project (e.g. "TGE (The Great Escape)", "VenueScale", "DFK ANZ")
     - `priority`: `top` (blocking someone / deadline ≤48h), `mid` (reply needed within a few days), `later` (FYI)
     - `deadline`: `YYYY-MM-DD` if extractable
     - `slackChannel`, `slackChannelId`, `slackFrom`, `slackThreadTs`, `slackPermalink` — for the "open in Slack" link (permalink comes from the search result)
   - **No** (someone confirming a decision Mark's not part of, a bot notification, a passing @-mention with no ask) → skip.

4. **Write results**. `Artifact` tool, `action: "write_db"`, `db_op: "batch"`:
   - For each new task: `set` at `tasks/slack_<sanitized-ts>` with the fields above plus `status: "open"`, `createdAt: <ISO of the Slack message>`
   - For every processed message (task or skip): `set` at `slack_seen/<sanitized-ts>` with `{ seenAt, action, channel, note? }`
   - `update` `meta/sync` with `{ lastRunAt, kind: "slack", processed, created, skipped }`

5. **(Optional) Ping Slack**. Same as `sync_email.md` step 6: if `meta/config.slackDmChannel` is set, post one message per new task. Use the `slackPermalink` field so Mark can jump straight to the thread from the DM.

6. **Report**. One line: `Slack scan: N mentions checked, M tasks added, K skipped.`

## Dashboard artifact URL

`https://claude.ai/code/artifact/526731de-3797-4ccc-857e-b4e7e3107c6e`

## Follow-up: broaden coverage

The current scan only catches @-mentions. To also catch things Mark should
know about but isn't tagged in (project-channel activity, DMs to Mark
directly), the Slack MCP would need to be re-authenticated as Mark
(`U09FETA9648`). Until then, direct DMs to Mark are invisible to this
routine — colleagues who reach out that way will only surface if they
also @-mention him in a channel.
