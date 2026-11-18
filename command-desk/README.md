# Command Desk

Mark's daily dashboard: Zoho Mail, Slack and Monday.com (VenueScale, Mood Creative, The Great Escape) in one
urgency-ranked list, with a Claude-written plan for each item, a timed plan for the day, and a reply box that
sends back to the right place.

| Folder | What it is |
|---|---|
| `server/` | The hosted version for CloudPanel: Node.js app with a login page. Fetches every hour and re-plans with Claude, even when nobody has it open. |
| `artifact.html` | The claude.ai artifact version (https://claude.ai/artifact/Y8jo3pGAqTFY6ieQKNjvy1). Uses your claude.ai connectors, only refreshes while open. |

## Deploy on CloudPanel (about 20 minutes)

Deploys run from GitHub Actions (`.github/workflows/deploy-command-desk.yml`), the same way giftsync does.
Every push to the default branch that changes `command-desk/server/` writes the settings file, syncs the code
over SSH, runs `npm ci`, (re)starts the app with pm2 and checks `/healthz`. Saved state in `data/` is never touched.

**1. Create the site in CloudPanel**
- Add an A record for `desk.ecommerceally.com` pointing at the server's IP.
- CloudPanel → Sites → Add Site → **Create a Node.js Site**: domain `desk.ecommerceally.com`, Node.js **22**,
  App Port **3010**. Note the **site user** it creates.
- Site → **SSL/TLS** → Actions → **New Let's Encrypt Certificate**.

**2. Give GitHub a deploy key**
- On your computer: `ssh-keygen -t ed25519 -f desk_deploy -N "" -C command-desk-deploy`
- CloudPanel → Site → **SSH/FTP** → add an SSH user (or the site user's SSH keys) and paste the contents of
  `desk_deploy.pub`.
- `ssh-keyscan -p 22 <server-ip>` prints the known-hosts line you need below.

**3. Add the secrets** in GitHub → `Markecom2/Personal` → Settings → Environments → **production**
(create it if it doesn't exist) → Environment secrets:

| Secret | Value |
|---|---|
| `DESK_SSH_HOST` | the server's IP or hostname |
| `DESK_SSH_USER` | the SSH user from step 2 |
| `DESK_SSH_PORT` | only if SSH isn't on port 22 |
| `DESK_SSH_PRIVATE_KEY` | contents of `desk_deploy` (the private half) |
| `DESK_SSH_KNOWN_HOSTS` | the `ssh-keyscan` output |
| `DESK_APP_DIR` | `/home/<site-user>/htdocs/desk.ecommerceally.com` |
| `DESK_ENV_FILE` | the whole settings file: copy `command-desk/server/.env.example`, fill it in (password, Claude, Zoho, Slack, Monday keys) and paste all of it |

And one variable (Variables tab): `DESK_URL` = `https://desk.ecommerceally.com`.

**4. Deploy.** Merge the pull request into the default branch, or run **Actions → Deploy Command Desk → Run
workflow** (tick *dry run* first to see what it would do). Then open `https://desk.ecommerceally.com` and sign in
with the password you put in `DASH_PASSWORD`.

**5. Survive reboots.** Once, as the site user over SSH: `pm2 startup` (run the `sudo` line it prints as root),
or add a CloudPanel cron job `@reboot cd ~/htdocs/desk.ecommerceally.com && pm2 resurrect`.

To change a key later, update the `DESK_ENV_FILE` secret and run the workflow again. The deploy refuses to run
if `DESK_APP_DIR` holds another app, so it can't overwrite giftsync or a WordPress site by mistake.

The badges at the top of the dashboard show each source as green, amber (not set up) or red (with the error),
so you can fill in sources one at a time.

## Daily planner (Eat That Frog)

The **Daily planner** tab turns the same inbox into a day plan using Brian Tracy's method:

- **Today's frog:** the one A task that will make the biggest difference, chosen by Claude (or by you), with
  the first concrete step so you can start at once. Do it first, before email and Slack. "Ate the frog"
  marks it done and builds a streak.
- **ABCDE:** every email, Slack message, Monday task and your own tasks get a letter. A = must do,
  B = should do (never before an A), C = nice to do, D = delegate (Claude suggests to whom), E = eliminate
  ("Drop all" clears them). Re-letter, re-order (↑ ↓) or make any task the frog.
- **Focus blocks:** 25/60/90-minute single-task timers; minutes are logged for the day.
- **Plan tomorrow tonight:** carry unfinished A/B tasks over, set tomorrow's frog, keep notes.
- **Today's principle:** one of the 21 Eat That Frog ideas each day.

Claude's hourly plan puts the frog in the first block of the day, batches messages, and hands D tasks off early.

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

**Slack (one token per workspace).** Repeat for each workspace:
1. https://api.slack.com/apps → Create New App → From scratch → name "Command Desk", choose the workspace.
2. OAuth & Permissions → **User Token Scopes**: `search:read`, `chat:write`, `users:read`.
3. Install to Workspace (a workspace admin may need to approve). Copy the **User OAuth Token** (`xoxp-...`).
   Replies are posted as you.

Then set:
```
SLACK_ACCOUNTS=[{"label":"Workspace one","token":"xoxp-..."},{"label":"Workspace two","token":"xoxp-..."}]
```

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
