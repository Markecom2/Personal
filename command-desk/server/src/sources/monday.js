// Monday.com via one personal API token per account.
// MONDAY_ACCOUNTS='[{"label":"VenueScale","token":"...","boards":[5024056553]},{"label":"Mood Creative","token":"..."}]'
// "boards" is optional: without it the 4 most recently used boards are read.
const API = "https://api.monday.com/v2";

export function accounts() {
  try {
    const list = JSON.parse(process.env.MONDAY_ACCOUNTS || "[]");
    return list.filter((a) => a && a.token && a.label).map((a) => ({ label: String(a.label), token: String(a.token), boards: (a.boards || []).map(String) }));
  } catch { throw new Error("MONDAY_ACCOUNTS is not valid JSON"); }
}

async function gql(acct, query, variables = {}) {
  const r = await fetch(API, { method: "POST", headers: { Authorization: acct.token, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors || j.error_message) throw new Error(`Monday (${acct.label}): ${j.errors?.[0]?.message || j.error_message || r.status}`);
  return j.data;
}

const ITEM_FIELDS = `items { id name url updated_at group { title } column_values { id type text column { title } } }`;
const UPDATE_FIELDS = `updates(limit: 30) { id text_body created_at updated_at item_id creator { name } replies { id text_body created_at creator { name } } }`;

async function boardIds(acct) {
  if (acct.boards.length) return acct.boards;
  const d = await gql(acct, `{ boards(limit: 12, order_by: used_at, state: active) { id name } }`);
  return (d.boards || []).filter((b) => !/^subitems of/i.test(b.name)).slice(0, 4).map((b) => b.id);
}

async function readBoards(acct, ids) {
  const ordered = `query($ids: [ID!]) { boards(ids: $ids) { id name url items_page(limit: 100, query_params: { order_by: [{ column_id: "__last_updated__", direction: desc }] }) { ${ITEM_FIELDS} } ${UPDATE_FIELDS} } }`;
  const plain = `query($ids: [ID!]) { boards(ids: $ids) { id name url items_page(limit: 200) { ${ITEM_FIELDS} } ${UPDATE_FIELDS} } }`;
  try { return (await gql(acct, ordered, { ids })).boards || []; }
  catch { return (await gql(acct, plain, { ids })).boards || []; }
}

const strip = (s) => String(s || "").replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();

function toTask(acct, board, it) {
  const cols = it.column_values || [];
  const find = (type, titleRe) => cols.find((c) => c.type === type && titleRe.test(c.column?.title || "")) || cols.find((c) => c.type === type);
  const status = find("status", /status/i)?.text || "";
  const due = String(find("date", /due|deadline/i)?.text || "").slice(0, 10);
  const people = (find("people", /person|owner|assign/i) || find("multiple-person", /./))?.text || "";
  const client = cols.find((c) => /client/i.test(c.column?.title || ""))?.text || (acct.label === "VenueScale" ? "" : acct.label);
  const group = it.group?.title || "";
  const label = acct.boardsLabelPrefix ? `${acct.label} · ${board.name}` : board.name;
  return {
    key: "t:" + it.id, source: "monday", kind: "task", server: acct.label, itemId: Number(it.id), board: label, link: it.url || "",
    from: people || "Unassigned", subject: it.name || "(untitled item)", status, due, client, group,
    preview: [status && "Status: " + status, due && "Due " + due, client && "Client: " + client, people && "Assigned: " + people, group && "Group: " + group].filter(Boolean).join("\n"),
    time: Date.parse(it.updated_at) || 0, unread: false
  };
}

function toUpdate(acct, board, u) {
  const reps = Array.isArray(u.replies) ? u.replies : [];
  const last = reps.length ? reps[reps.length - 1] : u;
  const thread = [`${u.creator?.name || "Someone"}: ${strip(u.text_body)}`].concat(reps.map((r) => `${r.creator?.name || "Someone"}: ${strip(r.text_body)}`));
  const label = acct.boardsLabelPrefix ? `${acct.label} · ${board.name}` : board.name;
  return {
    key: "u:" + u.id, source: "monday", kind: "update", server: acct.label, updateId: Number(u.id), itemId: Number(u.item_id), board: label,
    link: u.item_id && board.url ? `${board.url}/pulses/${u.item_id}` : board.url || "",
    from: last.creator?.name || "", starter: u.creator?.name || "",
    subject: (strip(last.text_body).split("\n").find((l) => l.trim()) || "(update)").slice(0, 140),
    preview: thread.join("\n\n").slice(0, 3000), time: Date.parse(last.created_at || u.updated_at || u.created_at) || 0, unread: false, replies: reps.length,
    client: acct.label === "VenueScale" ? "" : acct.label
  };
}

// Returns { boards: [{label, name}], tasks: [...], updates: [...] } for one account.
export async function readAccount(acct, primary) {
  acct.boardsLabelPrefix = !primary;
  const ids = await boardIds(acct);
  if (!ids.length) return { boards: [], tasks: [], updates: [] };
  const boards = await readBoards(acct, ids);
  const cutoff = Date.now() - 3 * 864e5;
  const tasks = [], updates = [];
  for (const b of boards) {
    for (const it of b.items_page?.items || []) {
      const t = toTask(acct, b, it);
      if (!/^done$/i.test(t.status) && !/complete/i.test(t.group)) tasks.push(t);
    }
    for (const u of b.updates || []) { const x = toUpdate(acct, b, u); if (x.time >= cutoff) updates.push(x); }
  }
  return { boards: boards.map((b) => ({ id: b.id, name: b.name })), tasks, updates };
}

export async function reply(item, text) {
  const acct = accounts().find((a) => a.label === item.server);
  if (!acct) throw new Error(`No Monday token for ${item.server}`);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return gql(acct, `mutation($item: ID!, $body: String!, $parent: ID) { create_update(item_id: $item, body: $body, parent_id: $parent) { id } }`,
    { item: String(item.itemId), body, parent: item.kind === "update" ? String(item.updateId) : null });
}
