# One-time setup — register the hourly sync

The routines are prompt files. To make them actually fire on a schedule, you
need to register them as **Claude Code Routines** from a session that already
holds your Zoho and Slack connector grants (my provisioning session didn't
hold them, so I couldn't pass them through to the fired sessions).

## Two ways to do it

### Option A — from a fresh Claude Code session (easiest)

Open a Claude Code session at claude.ai/code with your account
(`mark@ecommerceally.com`). Once Zoho and Slack are green in the connector
list, paste this prompt:

> Create a Claude Code Routine with these exact parameters:
>
> - **name**: `Mark's Day — email sync`
> - **environment_id**: `env_015FoceerfLPGc4djgBv5xnR` (HoleInOne)
> - **cron_expression**: `0 * * * *` (hourly; server anchors to creation minute)
> - **create_new_session_on_fire**: true
> - **connectors**: `["Zoho", "Slack"]`
> - **initiation**: `human_request`
> - **notifications**: `{push: false, email: false}` (Slack ping handles alerts)
> - **prompt**:
>
> ```
> Automated sync for Mark's Day dashboard.
>
> Read routines/sync_email.md in this repository
> (Markecom2/personal, branch claude/daily-eod-planning-gna653) and
> follow it exactly.
>
> Key values:
> - Zoho account ID: 6968733000000002002
> - Dashboard artifact URL: https://claude.ai/code/artifact/526731de-3797-4ccc-857e-b4e7e3107c6e
> - Slack DM channel: U0A0XHWMXL2 (also at meta/config.slackDmChannel)
>
> When done, reply with one line: "Scanned N emails, added M tasks,
> skipped K." Do not narrate individual decisions.
>
> If Zoho MCP is unavailable, write {error: "zoho unavailable",
> lastRunAt} to meta/sync and stop cleanly. If the Slack step fails
> but tasks were written, mention it in the summary but do not fail.
> ```

The critical bit is `connectors: ["Zoho", "Slack"]` — that's the grant
that needs to come from a session that itself holds those connectors.

### Option B — from the claude.ai Routines UI

Go to claude.ai → your profile → Routines → New Routine. Fill in the
same values from above. This uses the UI's own connector picker so
there's no cross-session grant problem to worry about.

## Verify it's live

After creating, ask any Claude Code session:

> List my Claude Code Routines and show the last run for the one named
> "Mark's Day — email sync".

It should fire once per hour. The first firing writes `meta/sync` in
the dashboard DB — the dashboard's status bar will show "Last sync: …"
timestamped from that firing.

## Once it works, add the two others

Same recipe, different prompts:

- **SOD brief** (weekdays 08:00 IST = `30 2 * * 1-5` in UTC):
  prompt = "Read `routines/sod_brief.md` and follow it exactly. Dashboard URL: https://claude.ai/code/artifact/526731de-3797-4ccc-857e-b4e7e3107c6e"

- **EOD wrap** (weekdays 18:00 IST = `30 12 * * 1-5` in UTC):
  prompt = "Read `routines/eod_wrap.md` and follow it exactly. Dashboard URL: https://claude.ai/code/artifact/526731de-3797-4ccc-857e-b4e7e3107c6e"

Both use `create_new_session_on_fire: true` and the same
`connectors: ["Zoho", "Slack"]`.

## Already done for you

- `meta/config` in the dashboard DB is set with `slackDmChannel: U0A0XHWMXL2`
  and `zohoAccountId: 6968733000000002002` — the routines read from there.
- Browser notifications work already; just click **Enable notifications**
  in the dashboard footer.
