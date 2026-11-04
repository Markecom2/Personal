# Command Desk

Mark's daily dashboard: Zoho Mail, Slack and Monday.com (VenueScale, Mood Creative, The Great Escape) in one
urgency-ranked list, with a Claude-written plan for each item, a timed plan for the day, and a reply box that
sends back to the right place.

| Folder | What it is |
|---|---|
| `server/` | The hosted version: Node.js app with a login page. Fetches every hour and re-plans with Claude, even when nobody has it open. |
| `artifact.html` | The claude.ai artifact version (https://claude.ai/artifact/Y8jo3pGAqTFY6ieQKNjvy1). Uses your claude.ai connectors, only refreshes while open. |

## Deploy on Render (about 30 minutes, mostly collecting keys)

1. **Collect the keys** (details below): Anthropic API key, Zoho client ID/secret/refresh token, Slack user token,
   one Monday API token per account.
2. **Make your password hash** on any machine with Node 20+:
   ```bash
   cd command-desk/server && npm install && npm run hash-password -- 'choose-a-long-password'
   ```
   Copy the `scrypt$...` line it prints.
3. In Render: **New → Blueprint**, pick the `markecom2/personal` repo and the branch. Render reads `render.yaml`
   and creates the `command-desk` service (Starter plan, about $7/month, with a 1 GB disk for saved state).
4. Fill in the secret values it asks for: `DASH_PASSWORD_HASH`, `ANTHROPIC_API_KEY`, the three `ZOHO_*` values,
   `SLACK_USER_TOKEN`, `MONDAY_ACCOUNTS`. `SESSION_SECRET` is generated for you.
5. Deploy. Your dashboard is at `https://command-desk-XXXX.onrender.com`. Sign in with your password.

The badges at the top of the dashboard show each source as green, amber (not set up) or red (with the error),
so you can add sources one at a time.

## Getting each key

**Anthropic (plans and drafts).** console.anthropic.com → API Keys → Create key. The server uses Claude Opus 5.5.
Each hourly plan reads up to ~90 items; expect very roughly $2–4 a day for 14 runs. Set
`CLAUDE_MODEL=claude-sonnet-5-5` to roughly halve that, or narrow `WORK_HOURS`.

**Zoho Mail.**
1. Go to https://api-console.zoho.in → Add Client → **Self Client** → Create.
2. Generate Code tab: scope `ZohoMail.accounts.READ,ZohoMail.messages.ALL`, duration 10 minutes, description
   "Command Desk". Copy the code.
3. Within 10 minutes, swap it for a refresh token:
   ```bash
   curl -X POST "https://accounts.zoho.in/oauth/v2/token?grant_type=authorization_code&client_id=CLIENT_ID&client_secret=CLIENT_SECRET&code=THE_CODE"
   ```
   Copy `refresh_token` from the reply into `ZOHO_REFRESH_TOKEN`.

**Slack.** The token decides which workspace you see (client work is in **stonebridgecrew**).
1. https://api.slack.com/apps → Create New App → From scratch → name "Command Desk", workspace stonebridgecrew.
2. OAuth & Permissions → **User Token Scopes**: `search:read`, `chat:write`, `users:read`.
3. Install to Workspace (a workspace admin may need to approve). Copy the **User OAuth Token** (`xoxp-...`).
   Replies are posted as you.

**Monday.com (one token per account).** In each account (venuescale, moodcreative-company,
the-great-escape-gang): click your avatar → **Developers** → **My access tokens** → copy. Then set:
```
MONDAY_ACCOUNTS=[{"label":"VenueScale","token":"...","boards":[5024056553]},{"label":"Mood Creative","token":"..."},{"label":"The Great Escape","token":"..."}]
```
`boards` is optional; without it the four boards you used most recently are read.

## Running locally

```bash
cd command-desk/server
cp .env.example .env   # fill it in
npm install
node --env-file=.env src/index.js
```
Open http://localhost:3000.

## How it behaves

- Fetches all sources at start-up and then every `REFRESH_MINUTES` (default 60) within `WORK_HOURS` in
  `TIMEZONE` (default 7–21, Asia/Kolkata), then asks Claude to re-rank and re-plan. **Refresh** and
  **Re-plan my day** run it on demand.
- "Handled" items and ticked plan steps are saved on the server, so they match on your phone and laptop.
- Replies: email replies go out from your Zoho address, Slack replies post in the thread as you, Monday
  replies post on the item (or in the thread). Every send asks you to confirm first.
- Security: one password (scrypt-hashed), signed HttpOnly SameSite=Strict session cookie for 30 days,
  8 failed logins per 15 minutes per IP, no third-party scripts besides Google Fonts. All API keys stay on
  the server.
