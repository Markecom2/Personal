// Single-user login: scrypt password hash in env, HMAC-signed session cookie.
import crypto from "node:crypto";

const COOKIE = "cd_session";
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, saltHex, keyHex] = stored.split("$");
  const key = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 32);
  const want = Buffer.from(keyHex, "hex");
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ random characters)");
  return s;
};
const sign = (v) => crypto.createHmac("sha256", secret()).update(v).digest("base64url");

function makeToken() {
  const payload = `${Date.now() + MAX_AGE_MS}.${crypto.randomBytes(12).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}
function validToken(tok) {
  if (!tok) return false;
  const i = tok.lastIndexOf(".");
  if (i < 0) return false;
  const payload = tok.slice(0, i), mac = tok.slice(i + 1);
  const good = sign(payload);
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return false;
  return Number(payload.split(".")[0]) > Date.now();
}
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// Simple in-memory limiter: 8 failed logins per IP per 15 minutes.
const fails = new Map();
function tooMany(ip) {
  const now = Date.now(), list = (fails.get(ip) || []).filter((t) => now - t < 15 * 60000);
  fails.set(ip, list);
  return list.length >= 8;
}

export function mountAuth(app) {
  const secure = process.env.NODE_ENV === "production";
  app.get("/login", (req, res) => res.type("html").send(loginPage(req.query.e === "1")));
  app.post("/login", (req, res) => {
    const ip = req.ip;
    if (tooMany(ip)) return res.status(429).type("html").send(loginPage(false, "Too many attempts. Wait 15 minutes and try again."));
    if (!verifyPassword(String(req.body.password || ""), process.env.DASH_PASSWORD_HASH)) {
      fails.get(ip).push(Date.now());
      return res.redirect(303, "/login?e=1");
    }
    fails.delete(ip);
    res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(makeToken())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_MS / 1000}${secure ? "; Secure" : ""}`);
    res.redirect(303, "/");
  });
  app.post("/logout", (req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`);
    res.redirect(303, "/login");
  });
}

export function requireAuth(req, res, next) {
  if (validToken(readCookie(req, COOKIE))) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "signed_out" });
  res.redirect(303, "/login");
}

function loginPage(failed, msg) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Command Desk · Sign in</title>
<style>
:root{--bg:#f4f6f8;--s:#fff;--ink:#121620;--m:#5d6676;--line:#dde2e8;--a:#0f766e;--c:#c8302c}
@media (prefers-color-scheme:dark){:root{--bg:#0d1016;--s:#151922;--ink:#e9edf4;--m:#9ba4b6;--line:#2a3140;--a:#3cc7b5;--c:#ff7a72;color-scheme:dark}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
form{background:var(--s);border:1px solid var(--line);border-radius:16px;padding:28px;width:min(360px,100%);display:grid;gap:14px}
h1{margin:0;font-size:22px}p{margin:0;color:var(--m);font-size:14px}
input{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
button{font:inherit;font-weight:600;padding:10px;border:0;border-radius:10px;background:var(--a);color:#fff;cursor:pointer}
.err{color:var(--c)}
</style></head><body><form method="post" action="/login">
<h1>Command Desk</h1><p>Sign in to see today's mail, Slack and Monday.</p>
${failed ? '<p class="err">That password is not right.</p>' : ""}${msg ? `<p class="err">${msg}</p>` : ""}
<label for="pw" style="font-size:13px;font-weight:600">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Sign in</button></form></body></html>`;
}

// `npm run hash-password -- 'your password'` prints a DASH_PASSWORD_HASH value.
if (process.argv[2] === "hash") {
  const pw = process.argv[3];
  if (!pw) { console.error("Usage: npm run hash-password -- 'your password'"); process.exit(1); }
  console.log(hashPassword(pw));
}
