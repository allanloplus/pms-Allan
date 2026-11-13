'use strict';
// PMS — 個人專案管理系統。零外部相依:Node 內建 http + node:sqlite。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3300);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SESSION_DAYS = 30;
const DEFAULT_USER = 'allanlo';
const DEFAULT_PASS = '00001231';

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'pms.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL, salt TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT '', source_name TEXT NOT NULL DEFAULT '',
  client TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'reserved',
  start_date TEXT, end_date TEXT,
  est_days REAL NOT NULL DEFAULT 0, est_revenue INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL, slot TEXT NOT NULL DEFAULT 'FULL', days REAL NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'planned', note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE TABLE IF NOT EXISTS incomes (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'expected', note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS types (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, label TEXT NOT NULL, short TEXT NOT NULL,
  color INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
`);

// 升級:舊資料庫補上新欄位
function addColumn(table, name, ddl) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}
addColumn('entries', 'content', "TEXT NOT NULL DEFAULT ''");          // 工作內容
addColumn('entries', 'billable', 'INTEGER NOT NULL DEFAULT 1');        // 0 = 義工:算實際人天,不請款、不占預估人天
addColumn('projects', 'billing', "TEXT NOT NULL DEFAULT 'milestone'"); // 收款方式:milestone 分期 / daily 按日計月結 / monthly 每月固定
addColumn('projects', 'rate', 'INTEGER NOT NULL DEFAULT 0');           // 日費或月費
addColumn('incomes', 'period', "TEXT NOT NULL DEFAULT ''");            // 計費月份 YYYY-MM(按日計/月費用)

// 工作類型:首次啟動(或由舊版升級)時建立預設值,之後可在「設定」中自行維護
if (!db.prepare('SELECT 1 FROM types LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO types (key, label, short, color, sort) VALUES (?,?,?,?,?)');
  [['consult_isms', 'ISMS 顧問輔導', 'ISMS輔導'], ['consult_tisax', 'TISAX 顧問輔導', 'TISAX輔導'],
    ['audit_cert', '驗證稽核(ISO 27001)', '驗證稽核'], ['audit_other', '二者/內部/委商稽核', '二者稽核'],
    ['dev', '系統開發案', '系統開發'], ['training', '教育訓練', '教育訓練'],
    ['talk', '講座邀約', '講座'], ['product', '自有產品研發', '產品研發'],
  ].forEach(([key, label, short], i) => ins.run(key, label, short, i + 1, (i + 1) * 10));
}

// ---------- 密碼與工作階段 ----------
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users (username, pw_hash, salt, must_change) VALUES (?,?,?,1)')
    .run(DEFAULT_USER, hashPw(DEFAULT_PASS, salt), salt);
  console.log(`已建立預設帳號 ${DEFAULT_USER}(請登入後立即變更密碼)`);
}

function verifyLogin(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  // 帳號不存在時仍做一次雜湊,避免以回應時間探測帳號
  const salt = u ? u.salt : '00000000000000000000000000000000';
  const got = Buffer.from(hashPw(password || '', salt), 'hex');
  const want = u ? Buffer.from(u.pw_hash, 'hex') : crypto.randomBytes(64);
  return crypto.timingSafeEqual(got, want) && u ? u : null;
}

// 登入失敗鎖定:同一 IP 15 分鐘內失敗 5 次即暫停
const FAIL_MAX = 5, FAIL_WINDOW = 15 * 60 * 1000;
const fails = new Map();
function failState(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > FAIL_WINDOW) { fails.delete(ip); return null; }
  return f;
}
setInterval(() => {
  for (const ip of fails.keys()) failState(ip);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 10 * 60 * 1000).unref();

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || '?';
}
const isHttps = (req) => TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https';

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function sessionCookie(req, token, maxAgeSec) {
  return `pms_sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}
function currentUser(req) {
  const tok = parseCookies(req).pms_sid;
  if (!tok) return null;
  const row = db.prepare(`SELECT u.id, u.username, u.must_change FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(tok), Date.now());
  return row || null;
}

// ---------- 輸入驗證 ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => { throw new HttpError(400, msg); };

const STATUSES = ['lead', 'reserved', 'confirmed', 'active', 'done', 'cancelled'];
const SLOTS = { FULL: 1, AM: 0.5, PM: 0.5 };
const ENTRY_STATUS = ['planned', 'done'];
const INCOME_STATUS = ['expected', 'invoiced', 'received'];
const BILLING = ['milestone', 'daily', 'monthly'];

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
function date(v, required, label) {
  if (v === null || v === undefined || v === '') { if (required) bad(`${label}為必填`); return null; }
  const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(v + 'T00:00:00Z') : NaN;
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v) bad(`${label}格式錯誤`);
  return v;
}
function oneOf(v, list, label) { if (!list.includes(v)) bad(`${label}不正確`); return v; }
function projectId(v) {
  const id = Number(v);
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id)) bad('專案不存在');
  return id;
}
function typeKey(v) {
  if (!db.prepare('SELECT 1 FROM types WHERE key = ?').get(String(v ?? ''))) bad('工作類型不正確');
  return String(v);
}
function cleanType(b) {
  const label = str(b.label, 40);
  if (!label) bad('類型名稱為必填');
  const color = Number(b.color), sort = Math.round(Number(b.sort || 0));
  if (!Number.isInteger(color) || color < 1 || color > 8) bad('顏色不正確');
  if (!(Math.abs(sort) <= 9999)) bad('排序不正確');
  return { label, short: str(b.short, 10) || label.slice(0, 6), color, sort, active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1 };
}
function cleanProject(b) {
  const name = str(b.name);
  if (!name) bad('專案名稱為必填');
  const estDays = Number(b.est_days || 0);
  let estRev = Math.round(Number(b.est_revenue || 0));
  const billing = oneOf(b.billing || 'milestone', BILLING, '收款方式');
  const rate = billing === 'milestone' ? 0 : Math.round(Number(b.rate || 0));
  if (!(rate >= 0)) bad('費率不正確');
  if (!(estDays >= 0) || Math.round(estDays * 2) !== estDays * 2) bad('預估人天需為 0.5 的倍數');
  if (!(estRev >= 0)) bad('預估收入不正確');
  const start = date(b.start_date, false, '開始日'), end = date(b.end_date, false, '結束日');
  if (start && end && end < start) bad('結束日不可早於開始日');
  // 按日計與月費的預估收入由費率推算
  if (billing === 'daily') estRev = Math.round(estDays * rate);
  if (billing === 'monthly') {
    if (!start || !end) bad('每月固定費用需填開始日與結束日(合約期間)');
    const months = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
    estRev = months * rate;
  }
  return {
    name, type: typeKey(b.type), source_type: str(b.source_type, 40),
    source_name: str(b.source_name), client: str(b.client),
    status: oneOf(b.status, STATUSES, '狀態'), start_date: start, end_date: end,
    est_days: estDays, est_revenue: estRev, billing, rate, notes: str(b.notes, 4000),
  };
}
function cleanEntry(b) {
  const slot = oneOf(b.slot, Object.keys(SLOTS), '時段');
  return {
    project_id: projectId(b.project_id), date: date(b.date, true, '日期'), slot, days: SLOTS[slot],
    status: oneOf(b.status || 'planned', ENTRY_STATUS, '狀態'),
    content: str(b.content, 500), note: str(b.note, 500),
    billable: b.billable === false || b.billable === 0 || b.billable === '0' ? 0 : 1,
  };
}
function cleanIncome(b) {
  const amount = Math.round(Number(b.amount));
  if (!(amount > 0)) bad('金額需大於 0');
  const pid = projectId(b.project_id), d = date(b.date, true, '日期');
  let period = str(b.period, 7);
  if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) bad('計費月份格式錯誤');
  // 按日計/月費專案的收款一律歸屬某個計費月份,避免與應計金額重複計算
  const billing = db.prepare('SELECT billing FROM projects WHERE id = ?').get(pid).billing;
  if (billing === 'milestone') period = ''; else if (!period) period = d.slice(0, 7);
  return {
    project_id: pid, date: d, amount, period,
    status: oneOf(b.status || 'expected', INCOME_STATUS, '狀態'), note: str(b.note, 500),
  };
}

function insert(table, obj) {
  const keys = Object.keys(obj);
  const r = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((k) => obj[k]));
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(r.lastInsertRowid));
}
function update(table, id, obj) {
  const keys = Object.keys(obj);
  const touch = table === 'projects' ? ", updated_at = datetime('now')" : '';
  const r = db.prepare(`UPDATE ${table} SET ${keys.map((k) => k + ' = ?').join(', ')}${touch} WHERE id = ?`)
    .run(...keys.map((k) => obj[k]), id);
  if (!r.changes) throw new HttpError(404, '資料不存在');
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}
function remove(table, id) {
  if (!db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes) throw new HttpError(404, '資料不存在');
  return { ok: true };
}
function allData() {
  const settings = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) settings[r.key] = r.value;
  return {
    types: db.prepare('SELECT * FROM types ORDER BY sort, id').all(),
    projects: db.prepare('SELECT * FROM projects ORDER BY id').all(),
    entries: db.prepare('SELECT * FROM entries ORDER BY date, id').all(),
    incomes: db.prepare('SELECT * FROM incomes ORDER BY date, id').all(),
    settings,
  };
}

const CLEAN = { projects: cleanProject, entries: cleanEntry, incomes: cleanIncome };

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  const ip = clientIp(req);

  if (p === '/api/login' && m === 'POST') {
    const f = failState(ip);
    if (f && f.count >= FAIL_MAX) throw new HttpError(429, '登入失敗次數過多,請 15 分鐘後再試');
    const b = await body(req);
    const u = verifyLogin(b.username, b.password);
    if (!u) {
      const cur = failState(ip) || { count: 0, first: Date.now() };
      cur.count++; fails.set(ip, cur);
      console.warn(`[auth] 登入失敗 ip=${ip}`);
      throw new HttpError(401, '帳號或密碼錯誤');
    }
    fails.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)')
      .run(sha256(token), u.id, Date.now() + SESSION_DAYS * 864e5);
    res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
    return { username: u.username, must_change: !!u.must_change };
  }

  const user = currentUser(req);
  if (p === '/api/logout' && m === 'POST') {
    const tok = parseCookies(req).pms_sid;
    if (tok) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(tok));
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return { ok: true };
  }
  if (!user) throw new HttpError(401, '尚未登入');

  if (p === '/api/me' && m === 'GET') return { username: user.username, must_change: !!user.must_change };
  if (p === '/api/data' && m === 'GET') return allData();
  if (p === '/api/export' && m === 'GET') {
    res.setHeader('Content-Disposition', `attachment; filename="pms-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return { exported_at: new Date().toISOString(), ...allData() };
  }
  if (p === '/api/password' && m === 'POST') {
    const b = await body(req);
    if (!verifyLogin(user.username, b.current)) throw new HttpError(400, '目前密碼錯誤');
    const next = String(b.next || '');
    if (next.length < 8) bad('新密碼至少 8 碼');
    if (next === DEFAULT_PASS) bad('新密碼不可與預設密碼相同');
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE users SET pw_hash = ?, salt = ?, must_change = 0 WHERE id = ?').run(hashPw(next, salt), salt, user.id);
    // 變更密碼後註銷其他裝置的工作階段
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, sha256(parseCookies(req).pms_sid));
    return { ok: true };
  }
  if (p === '/api/settings' && m === 'PUT') {
    const b = await body(req);
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const k of ['annual_target', 'monthly_capacity', 'default_daily_rate']) {
      if (b[k] === undefined) continue;
      const n = Number(b[k]);
      if (!(n >= 0)) bad('設定值不正確');
      set.run(k, String(n));
    }
    return allData().settings;
  }
  // 批次排程:日期區間一次建立多筆
  if (p === '/api/entries/batch' && m === 'POST') {
    const b = await body(req);
    const from = date(b.from, true, '起日'), to = date(b.to, true, '迄日');
    if (to < from) bad('迄日不可早於起日');
    const out = [];
    db.exec('BEGIN');
    try {
      for (let t = Date.parse(from + 'T00:00:00Z'), n = 0; t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) {
        const d = new Date(t);
        if (b.skip_weekends && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) continue;
        if (++n > 92) bad('單次最多建立 92 筆');
        out.push(insert('entries', cleanEntry({ ...b, date: d.toISOString().slice(0, 10) })));
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return out;
  }

  const tm = p.match(/^\/api\/types(?:\/(\d+))?$/);
  if (tm) {
    const id = Number(tm[1]);
    if (m === 'POST' && !tm[1]) return insert('types', { key: 'c' + crypto.randomBytes(5).toString('hex'), ...cleanType(await body(req)) });
    if (m === 'PUT' && id) return update('types', id, cleanType(await body(req)));
    if (m === 'DELETE' && id) {
      const t = db.prepare('SELECT key FROM types WHERE id = ?').get(id);
      if (!t) throw new HttpError(404, '資料不存在');
      const n = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE type = ?').get(t.key).n;
      if (n) bad(`仍有 ${n} 個專案使用此類型,無法刪除;可改為「停用」`);
      if (db.prepare('SELECT COUNT(*) AS n FROM types').get().n <= 1) bad('至少需保留一個類型');
      return remove('types', id);
    }
  }
  const mm = p.match(/^\/api\/(projects|entries|incomes)(?:\/(\d+))?$/);
  if (mm) {
    const [, table, idStr] = mm;
    if (m === 'POST' && !idStr) return insert(table, CLEAN[table](await body(req)));
    if (m === 'PUT' && idStr) return update(table, Number(idStr), CLEAN[table](await body(req)));
    if (m === 'DELETE' && idStr) return remove(table, Number(idStr));
  }
  throw new HttpError(404, 'Not found');
}

function body(req) {
  return new Promise((resolve, reject) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      return reject(new HttpError(415, '需為 application/json'));
    }
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new HttpError(413, '內容過大')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch { reject(new HttpError(400, 'JSON 格式錯誤')); }
    });
    req.on('error', reject);
  });
}

// ---------- 靜態檔案 ----------
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url);
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const out = await api(req, res, url);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: status === 500 ? '伺服器錯誤' : e.message }));
  }
});

// 指令列:node server.js set-password  (密碼由標準輸入讀入,用於部署時設定或忘記密碼時重設)
function setPasswordFromStdin() {
  const pw = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  if (pw.length < 8) { console.error('密碼至少 8 碼'); process.exit(1); }
  if (pw === DEFAULT_PASS) { console.error('不可使用預設密碼'); process.exit(1); }
  const u = db.prepare('SELECT id, username FROM users ORDER BY id LIMIT 1').get();
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET pw_hash = ?, salt = ?, must_change = 0 WHERE id = ?').run(hashPw(pw, salt), salt, u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  console.log(`已設定帳號 ${u.username} 的密碼,並登出所有裝置`);
}

if (require.main === module) {
  if (process.argv[2] === 'set-password') setPasswordFromStdin();
  else server.listen(PORT, HOST, () => console.log(`PMS 已啟動:http://${HOST}:${PORT}`));
}
module.exports = { server, db };
