const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { slugify } = require('./taxonomy');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS posts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    type          TEXT NOT NULL,
    title         TEXT NOT NULL,
    slug          TEXT NOT NULL UNIQUE,
    organization  TEXT,
    summary       TEXT,
    category      TEXT,
    state         TEXT,
    qualification TEXT,
    vacancies     INTEGER,
    salary        TEXT,
    age_limit     TEXT,
    fees          TEXT,
    eligibility   TEXT,
    selection     TEXT,
    how_to_apply  TEXT,
    content       TEXT,
    start_date    TEXT,
    last_date     TEXT,
    exam_date     TEXT,
    links         TEXT NOT NULL DEFAULT '[]',
    status        TEXT NOT NULL DEFAULT 'published',
    featured      INTEGER NOT NULL DEFAULT 0,
    views         INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_posts_last ON posts(last_date);
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add columns introduced after the first release (safe to run on every start).
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('subscribers', 'token', 'TEXT');
addColumn('subscribers', 'frequency', "TEXT NOT NULL DEFAULT 'daily'"); // instant | daily
addColumn('subscribers', 'types', "TEXT NOT NULL DEFAULT ''");          // comma lists; empty = everything
addColumn('subscribers', 'categories', "TEXT NOT NULL DEFAULT ''");
addColumn('subscribers', 'states', "TEXT NOT NULL DEFAULT ''");
addColumn('subscribers', 'qualifications', "TEXT NOT NULL DEFAULT ''");
addColumn('subscribers', 'active', 'INTEGER NOT NULL DEFAULT 1');
addColumn('subscribers', 'last_sent_at', 'TEXT');
addColumn('posts', 'published_at', 'TEXT');
addColumn('posts', 'alerted_at', 'TEXT');
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_token ON subscribers(token);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, post_id INTEGER, recipients INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'html',            -- html | rss
    selector TEXT,                                -- CSS selector for links on html pages
    include_keywords TEXT,                        -- comma list; empty = built-in defaults
    exclude_keywords TEXT,
    default_type TEXT,                            -- empty = guess from the title
    default_category TEXT,
    default_state TEXT,
    auto_publish INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    interval_minutes INTEGER NOT NULL DEFAULT 60,
    last_checked_at TEXT,
    last_status TEXT,                             -- ok | error | blocked
    last_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS source_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    post_id INTEGER,
    baseline INTEGER NOT NULL DEFAULT 0,          -- 1 = existed at first check, no draft made
    seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id, url)
  );
  CREATE TABLE IF NOT EXISTS source_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    status TEXT NOT NULL, found INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL DEFAULT 0,
    message TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Backfill tokens / published_at for rows created before these columns existed.
for (const r of db.prepare('SELECT id FROM subscribers WHERE token IS NULL').all()) {
  db.prepare('UPDATE subscribers SET token = ? WHERE id = ?').run(require('node:crypto').randomBytes(24).toString('base64url'), r.id);
}
db.exec("UPDATE posts SET published_at = created_at WHERE published_at IS NULL AND status = 'published'");
db.exec("UPDATE posts SET alerted_at = created_at WHERE alerted_at IS NULL AND status = 'published'");

const FIELDS = ['type', 'title', 'slug', 'organization', 'summary', 'category', 'state', 'qualification', 'vacancies',
  'salary', 'age_limit', 'fees', 'eligibility', 'selection', 'how_to_apply', 'content', 'start_date', 'last_date',
  'exam_date', 'links', 'status', 'featured'];

function hydrate(row) {
  if (!row) return row;
  let links = [];
  try { links = JSON.parse(row.links || '[]'); } catch { /* ignore */ }
  return { ...row, links, featured: !!row.featured };
}

function uniqueSlug(base, excludeId = 0) {
  const root = slugify(base) || 'post';
  let slug = root;
  for (let i = 2; db.prepare('SELECT 1 FROM posts WHERE slug = ? AND id != ?').get(slug, excludeId); i++) slug = `${root}-${i}`;
  return slug;
}

function toParams(p) {
  return FIELDS.map((f) => {
    if (f === 'links') return JSON.stringify(p.links || []);
    if (f === 'featured') return p.featured ? 1 : 0;
    const v = p[f];
    return v === '' || v === undefined ? null : v;
  });
}

const posts = {
  create(p) {
    p.slug = uniqueSlug(p.slug || p.title);
    const sql = `INSERT INTO posts (${FIELDS.join(',')}) VALUES (${FIELDS.map(() => '?').join(',')})`;
    const id = Number(db.prepare(sql).run(...toParams(p)).lastInsertRowid);
    if (p.status === 'published') db.prepare("UPDATE posts SET published_at = datetime('now') WHERE id = ?").run(id);
    return id;
  },
  update(id, p) {
    p.slug = uniqueSlug(p.slug || p.title, id);
    const sql = `UPDATE posts SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`;
    const changes = db.prepare(sql).run(...toParams(p), id).changes;
    if (p.status === 'published') db.prepare("UPDATE posts SET published_at = COALESCE(published_at, datetime('now')) WHERE id = ?").run(id);
    return changes;
  },
  publish: (id) => db.prepare("UPDATE posts SET status = 'published', published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now') WHERE id = ?").run(id).changes,
  markAlerted: (id) => db.prepare("UPDATE posts SET alerted_at = datetime('now') WHERE id = ?").run(id),
  publishedSince: (since) => db.prepare("SELECT * FROM posts WHERE status = 'published' AND published_at > ? ORDER BY published_at DESC LIMIT 200").all(since).map(hydrate),
  remove: (id) => db.prepare('DELETE FROM posts WHERE id = ?').run(id).changes,
  get: (id) => hydrate(db.prepare('SELECT * FROM posts WHERE id = ?').get(id)),
  bySlug: (slug) => hydrate(db.prepare("SELECT * FROM posts WHERE slug = ? AND status = 'published'").get(slug)),
  addView: (id) => db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(id),
  count: () => db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,

  // Flexible listing used by public pages, search and admin.
  list({ type, category, state, qualification, q, status = 'published', active, featured, sort = 'new', limit = 20, offset = 0 } = {}) {
    const where = [];
    const args = [];
    if (status) { where.push('status = ?'); args.push(status); }
    if (type) { where.push('type = ?'); args.push(type); }
    if (category) { where.push('category = ?'); args.push(category); }
    if (state) { where.push('state = ?'); args.push(state); }
    if (qualification) { where.push("(',' || qualification || ',') LIKE ?"); args.push(`%,${qualification},%`); }
    if (featured) where.push('featured = 1');
    if (active) where.push("(last_date IS NULL OR last_date >= date('now'))");
    if (q) {
      const terms = q.trim().split(/\s+/).slice(0, 6);
      for (const t of terms) {
        where.push('(title LIKE ? OR organization LIKE ? OR summary LIKE ? OR category LIKE ?)');
        const like = `%${t.replace(/[%_]/g, '')}%`;
        args.push(like, like, like, like);
      }
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = sort === 'last_date' ? 'last_date IS NULL, last_date ASC' : sort === 'views' ? 'views DESC' : 'created_at DESC, id DESC';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM posts ${w}`).get(...args).n;
    const rows = db.prepare(`SELECT * FROM posts ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, limit, offset);
    return { total: Number(total), rows: rows.map(hydrate) };
  },

  countsBy(column) {
    if (!['category', 'state', 'type'].includes(column)) throw new Error('bad column');
    return Object.fromEntries(db.prepare(`SELECT ${column} AS k, COUNT(*) AS n FROM posts WHERE status='published' AND ${column} IS NOT NULL GROUP BY ${column}`).all().map((r) => [r.k, Number(r.n)]));
  },
  allPublishedForSitemap: () => db.prepare("SELECT slug, type, updated_at FROM posts WHERE status='published' ORDER BY updated_at DESC LIMIT 45000").all(),
};

const PREF_COLS = ['frequency', 'types', 'categories', 'states', 'qualifications'];
const newToken = () => require('node:crypto').randomBytes(24).toString('base64url');

const subscribers = {
  // Insert or update preferences. Returns { sub, created }.
  upsert(email, prefs = {}) {
    const existing = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email);
    const vals = {
      frequency: prefs.frequency === 'instant' ? 'instant' : 'daily',
      types: prefs.types || '', categories: prefs.categories || '', states: prefs.states || '', qualifications: prefs.qualifications || '',
    };
    if (existing) {
      db.prepare(`UPDATE subscribers SET ${PREF_COLS.map((c) => `${c} = ?`).join(', ')}, active = 1 WHERE id = ?`).run(...PREF_COLS.map((c) => vals[c]), existing.id);
      return { sub: subscribers.byId(existing.id), created: false };
    }
    const r = db.prepare(`INSERT INTO subscribers (email, token, ${PREF_COLS.join(', ')}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(email, newToken(), ...PREF_COLS.map((c) => vals[c]));
    return { sub: subscribers.byId(Number(r.lastInsertRowid)), created: true };
  },
  updatePrefs(id, prefs) {
    db.prepare(`UPDATE subscribers SET ${PREF_COLS.map((c) => `${c} = ?`).join(', ')}, active = 1 WHERE id = ?`)
      .run(prefs.frequency === 'instant' ? 'instant' : 'daily', prefs.types || '', prefs.categories || '', prefs.states || '', prefs.qualifications || '', id);
  },
  byId: (id) => db.prepare('SELECT * FROM subscribers WHERE id = ?').get(id),
  byEmail: (email) => db.prepare('SELECT * FROM subscribers WHERE email = ?').get(email),
  byToken: (token) => (typeof token === 'string' && token.length > 10 ? db.prepare('SELECT * FROM subscribers WHERE token = ?').get(token) : undefined),
  setActive: (id, active) => db.prepare('UPDATE subscribers SET active = ? WHERE id = ?').run(active ? 1 : 0, id),
  active: (frequency) => db.prepare('SELECT * FROM subscribers WHERE active = 1 AND frequency = ?').all(frequency),
  markSent: (id) => db.prepare("UPDATE subscribers SET last_sent_at = datetime('now') WHERE id = ?").run(id),
  list: () => db.prepare('SELECT * FROM subscribers ORDER BY id DESC').all(),
  stats: () => db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(active=1),0) AS active, COALESCE(SUM(active=1 AND frequency='instant'),0) AS instant, COALESCE(SUM(active=1 AND frequency='daily'),0) AS daily FROM subscribers").get(),
  remove: (id) => db.prepare('DELETE FROM subscribers WHERE id = ?').run(id).changes,
};

const settings = {
  get: (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? null,
  set: (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v)),
};

const emailLog = {
  add: (e) => db.prepare('INSERT INTO email_log (kind, post_id, recipients, failed, note) VALUES (?, ?, ?, ?, ?)').run(e.kind, e.post_id ?? null, e.recipients || 0, e.failed || 0, e.note || null),
  recent: () => db.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT 20').all(),
};

const messages = {
  add: (m) => db.prepare('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)').run(m.name, m.email, m.message),
  list: () => db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 500').all(),
  remove: (id) => db.prepare('DELETE FROM messages WHERE id = ?').run(id).changes,
};

const SRC_FIELDS = ['name', 'url', 'kind', 'selector', 'include_keywords', 'exclude_keywords', 'default_type', 'default_category',
  'default_state', 'auto_publish', 'enabled', 'interval_minutes'];
const sources = {
  list: () => db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM source_items i WHERE i.source_id = s.id AND i.post_id IS NOT NULL) AS imported
    FROM sources s ORDER BY s.name`).all(),
  get: (id) => db.prepare('SELECT * FROM sources WHERE id = ?').get(id),
  create: (d) => Number(db.prepare(`INSERT INTO sources (${SRC_FIELDS.join(',')}) VALUES (${SRC_FIELDS.map(() => '?').join(',')})`).run(...SRC_FIELDS.map((f) => d[f] ?? null)).lastInsertRowid),
  update: (id, d) => db.prepare(`UPDATE sources SET ${SRC_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...SRC_FIELDS.map((f) => d[f] ?? null), id),
  remove: (id) => db.prepare('DELETE FROM sources WHERE id = ?').run(id),
  due: () => db.prepare(`SELECT * FROM sources WHERE enabled = 1 AND (last_checked_at IS NULL
    OR last_checked_at <= datetime('now', '-' || interval_minutes || ' minutes'))`).all(),
  setResult: (id, status, message) => db.prepare("UPDATE sources SET last_checked_at = datetime('now'), last_status = ?, last_message = ? WHERE id = ?").run(status, message, id),
  hasItems: (id) => !!db.prepare('SELECT 1 FROM source_items WHERE source_id = ? LIMIT 1').get(id),
  seen: (id, url) => !!db.prepare('SELECT 1 FROM source_items WHERE source_id = ? AND url = ?').get(id, url),
  addItem: (id, url, title, postId, baseline) => db.prepare('INSERT OR IGNORE INTO source_items (source_id, url, title, post_id, baseline) VALUES (?, ?, ?, ?, ?)').run(id, url, title, postId ?? null, baseline ? 1 : 0),
  items: (id) => db.prepare(`SELECT i.*, p.status AS post_status, p.slug, p.type FROM source_items i LEFT JOIN posts p ON p.id = i.post_id
    WHERE i.source_id = ? ORDER BY i.id DESC LIMIT 200`).all(id),
  addRun: (r) => db.prepare('INSERT INTO source_runs (source_id, status, found, created, message) VALUES (?, ?, ?, ?, ?)').run(r.source_id, r.status, r.found || 0, r.created || 0, r.message || null),
  runs: (id) => db.prepare('SELECT * FROM source_runs WHERE source_id = ? ORDER BY id DESC LIMIT 30').all(id),
  pendingDrafts: () => db.prepare("SELECT COUNT(*) AS n FROM posts p JOIN source_items i ON i.post_id = p.id WHERE p.status = 'draft'").get().n,
};

module.exports = { db, posts, subscribers, messages, settings, emailLog, sources };
