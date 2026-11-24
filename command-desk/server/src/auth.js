// Single-user login: scrypt password hash in env, HMAC-signed session cookie.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const COOKIE = "cd_session";
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const SHORT_MS = 12 * 3600 * 1000; // without "Keep me signed in"
// Optional DASH_USER: when set, the username must match too (not case-sensitive).
const USER = () => String(process.env.DASH_USER || "").trim();

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

// SESSION_SECRET if set; otherwise a random key created once and kept in the data folder.
let sessionKey = null;
const secret = () => {
  if (sessionKey) return sessionKey;
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return (sessionKey = s);
  const file = path.resolve(process.env.DATA_DIR || "./data", "session.key");
  try { sessionKey = fs.readFileSync(file, "utf8").trim(); } catch { /* create below */ }
  if (!sessionKey || sessionKey.length < 32) {
    sessionKey = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, sessionKey, { mode: 0o600 });
  }
  return sessionKey;
};

// DASH_PASSWORD_HASH (scrypt$...) is preferred; a plain DASH_PASSWORD is hashed in memory at start-up.
let passwordHash = null;
const storedHash = () => passwordHash ||= process.env.DASH_PASSWORD_HASH || (process.env.DASH_PASSWORD ? hashPassword(process.env.DASH_PASSWORD) : null);
const sign = (v) => crypto.createHmac("sha256", secret()).update(v).digest("base64url");

function makeToken(ms = MAX_AGE_MS) {
  const payload = `${Date.now() + ms}.${crypto.randomBytes(12).toString("base64url")}`;
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
    const userOk = !USER() || String(req.body.username || "").trim().toLowerCase() === USER().toLowerCase();
    const passOk = verifyPassword(String(req.body.password || ""), storedHash());
    if (!userOk || !passOk) {
      fails.get(ip).push(Date.now());
      return res.redirect(303, "/login?e=1");
    }
    fails.delete(ip);
    const keep = !!req.body.remember;
    res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(makeToken(keep ? MAX_AGE_MS : SHORT_MS))}; Path=/; HttpOnly; SameSite=Strict${keep ? `; Max-Age=${MAX_AGE_MS / 1000}` : ""}${secure ? "; Secure" : ""}`);
    res.redirect(303, "/");
  });
  app.get("/logout", (req, res) => res.redirect(303, "/login"));
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
  const user = USER();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Command Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cabin:wght@400;500;600;700&display=swap">
<style>
:root{--bg:#f5f4f0;--s:#fff;--ink:#1c1f24;--m:#6a707b;--line:#e3e1db;--a:#0f766e;--a2:#e6f2f0;--c:#c0392b;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--s:#1b1e23;--ink:#eceef1;--m:#9aa1ad;--line:#2c3038;--a:#3cc0ae;--a2:#173230;--c:#ff7d73;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 "Cabin",system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
form{background:var(--s);border:1px solid var(--line);border-radius:18px;padding:32px 28px;width:min(380px,100%);display:grid;gap:16px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
.logo{width:44px;height:44px;border-radius:12px;background:var(--a2);color:var(--a);display:grid;place-items:center;font-weight:700;font-size:20px}
h1{margin:0;font-size:24px;letter-spacing:-.01em}p{margin:0;color:var(--m);font-size:15px}
label{display:grid;gap:6px;font-size:14px;font-weight:600}
input[type=text],input[type=password]{font:inherit;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink)}
input:focus-visible,button:focus-visible{outline:2px solid var(--a);outline-offset:2px}
.keep{display:flex;align-items:center;gap:8px;font-weight:500;color:var(--m)}
.keep input{width:18px;height:18px;accent-color:var(--a)}
button{font:inherit;font-weight:600;padding:12px;border:0;border-radius:12px;background:var(--a);color:#fff;cursor:pointer}
.err{color:var(--c);font-weight:500}
</style></head><body><form method="post" action="/login">
<div class="logo" aria-hidden="true">✓</div>
<div><h1>Welcome back</h1><p>Sign in to plan your day.</p></div>
${failed ? `<p class="err" role="alert">That ${user ? "username or password" : "password"} is not right.</p>` : ""}${msg ? `<p class="err" role="alert">${msg}</p>` : ""}
${user ? '<label>Username<input type="text" name="username" autocomplete="username" autocapitalize="none" required autofocus></label>' : ""}
<label>Password<input type="password" name="password" autocomplete="current-password" required ${user ? "" : "autofocus"}></label>
<label class="keep"><input type="checkbox" name="remember" value="1" checked> Keep me signed in for 30 days</label>
<button type="submit">Sign in</button></form></body></html>`;
}

// `npm run hash-password -- 'your password'` prints a DASH_PASSWORD_HASH value.
if (process.argv[2] === "hash") {
  const pw = process.argv[3];
  if (!pw) { console.error("Usage: npm run hash-password -- 'your password'"); process.exit(1); }
  console.log(hashPassword(pw));
}
