# Command Desk

Mark's daily dashboard: Zoho Mail, Slack and Monday.com (VenueScale, Mood Creative, The Great Escape) in one
urgency-ranked list, with a Claude-written plan for each item, a timed plan for the day, and a reply box that
sends back to the right place.

| Folder | What it is |
|---|---|
| `server/` | The hosted version for CloudPanel: Node.js app with a login page. Fetches every hour and re-plans with Claude, even when nobody has it open. |
| `artifact.html` | The claude.ai artifact version (https://claude.ai/artifact/Y8jo3pGAqTFY6ieQKNjvy1). Uses your claude.ai connectors, only refreshes while open. |

## Deploy on CloudPanel (same setup as giftsync)

**One-time setup on the server**

1. **Create the site.** CloudPanel → Sites → Add Site → **Create a Node.js Site**:
   - Domain: e.g. `desk.ecommerceally.com` (add an A record pointing at the server's IP first)
   - Node.js version: 22 · App Port: `3010` (any free port)
   - Note the **site user** and its password. The app folder is `/home/<site-user>/htdocs/desk.ecommerceally.com`.
2. **SSL.** Site → SSL/TLS → Actions → **New Let's Encrypt Certificate**.
3. **Put the settings file in place.** In CloudPanel → Site → **File Manager**, inside
   `htdocs/desk.ecommerceally.com`:
   - upload `command-desk/server/package.json` from the repo (the deploy checks for it, so it can never sync into the wrong folder);
   - create `.env` from `command-desk/server/.env.example` and fill in the keys (see "Getting each key").
     For `DASH_PASSWORD_HASH`, run `npm run hash-password -- 'choose-a-long-password'` on any machine with
     Node 22 and the repo; for `SESSION_SECRET`, any 64 random hex characters (`openssl rand -hex 32`).
   Then set up the GitHub secrets below and run **Actions → Deploy Command Desk → Run workflow**. The first run
   uploads the app, installs pm2 if needed and starts it. Open `https://desk.ecommerceally.com` and sign in.
4. **Keep pm2 running after a reboot:** run `pm2 startup` as the site user and, if it prints a `sudo ...`
   command, have it run as root once. (Or add `@reboot cd ~/htdocs/desk.ecommerceally.com && pm2 resurrect`
   under the site's Cron Jobs in CloudPanel.)

**Automatic deploys from GitHub** (`.github/workflows/deploy-command-desk.yml`)

Every push to `main` that changes `command-desk/server/` syncs the files over SSH, runs `npm ci`, restarts the
app with pm2 and checks `/healthz`. `.env` and `data/` on the server are never touched. To switch it on, add
these in GitHub → `markecom2/personal` → Settings → Secrets and variables → Actions (environment `production`):

| Secret | Value |
|---|---|
| `DESK_SSH_HOST` | the server's IP or hostname |
| `DESK_SSH_USER` | the site user from step 1 |
| `DESK_SSH_PORT` | only if SSH isn't on 22 |
| `DESK_SSH_PRIVATE_KEY` | a deploy key whose public half is in the site user's `~/.ssh/authorized_keys` |
| `DESK_SSH_KNOWN_HOSTS` | output of `ssh-keyscan -p 22 <server>` |
| `DESK_APP_DIR` | `/home/<site-user>/htdocs/desk.ecommerceally.com` |

Variable: `DESK_URL` = `https://desk.ecommerceally.com` (for the health check). Run the workflow once with
**dry run** ticked to see what it would change before the first real deploy.

The badges at the top of the dashboard show each source as green, amber (not set up) or red (with the error),
so you can add keys to `.env` one at a time; run `pm2 restart command-desk` after editing `.env`.

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
cp .env.example .env   # fill it in, set PORT=3000 and NODE_ENV=development
npm install
npm start
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
