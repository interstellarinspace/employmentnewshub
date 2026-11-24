const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { posts, subscribers, messages, emailLog, settings, sources } = require('./db');
const importer = require('./importer');
const { STATES: ALL_STATES } = require('./taxonomy');
const mailer = require('./mailer');
const { TYPES, CATEGORIES, QUALIFICATIONS, STATES } = require('./taxonomy');
const { validatePost, linksToText } = require('./validate');
const { createToken, checkPassword, setSessionCookie, requireAdmin, isAdmin, sameOrigin } = require('./auth');
const { html, raw, esc, fmtDate, postUrl, options } = require('./views');

const router = express.Router();
router.use(sameOrigin);
router.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); res.set('Cache-Control', 'no-store'); next(); });

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).send(loginPage('Too many attempts. Try again in 15 minutes.')) });

function shell(title, body, { nav = true } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} · Admin · ${esc(config.siteName)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/styles.css"><script src="/js/admin.js" defer></script></head>
<body class="admin"><header class="site-header"><div class="container topbar">
<a class="brand" href="/admin"><span class="brand-mark" aria-hidden="true">${esc(config.siteName[0] || "")}</span><span>${esc(config.siteName)} Admin</span></a>
${nav ? `<nav class="admin-nav"><a href="/admin">Posts</a><a href="/admin/posts/new">+ New post</a><a href="/admin/sources">Auto-import</a><a href="/admin/subscribers">Subscribers</a><a href="/admin/email">Email alerts</a><a href="/admin/messages">Messages</a><a href="/" target="_blank">View site ↗</a>
<form method="post" action="/admin/logout" style="display:inline"><button class="btn btn-outline btn-sm">Log out</button></form></nav>` : ''}
</div></header><main class="container page">${body}</main></body></html>`;
}

function loginPage(error) {
  return shell('Login', html`<form class="form card" method="post" action="/admin/login" style="max-width:400px;margin:60px auto">
    <h1>Admin login</h1>
    ${error ? html`<div class="alert alert-error show">${error}</div>` : ''}
    <div><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus></div>
    <button class="btn btn-primary" type="submit">Log in</button></form>`.s, { nav: false });
}

router.get('/login', (req, res) => (isAdmin(req) ? res.redirect('/admin') : res.send(loginPage())));
router.post('/login', loginLimiter, (req, res) => {
  if (!checkPassword(req.body?.password)) return res.status(401).send(loginPage('Incorrect password.'));
  setSessionCookie(res, createToken());
  res.redirect(303, '/admin');
});
router.post('/logout', (req, res) => { setSessionCookie(res, ''); res.redirect(303, '/admin/login'); });

router.use(requireAdmin);

// ----- Posts list -----
router.get('/', (req, res) => {
  const type = TYPES[req.query.type] ? req.query.type : undefined;
  const status = ['published', 'draft'].includes(req.query.status) ? req.query.status : null;
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const { total, rows } = posts.list({ type, status, q, limit: 50, offset: (page - 1) * 50 });
  const pages = Math.ceil(total / 50);
  const qs = (n) => esc(new URLSearchParams({ ...(type && { type }), ...(status && { status }), ...(q && { q }), page: n }).toString());
  const flash = { saved: 'Post saved.', deleted: 'Post deleted.', alerted: 'Post saved. Instant email alerts are being sent to matching subscribers.', published: 'Post published.' }[req.query.msg];
  const pending = sources.pendingDrafts();
  const body = html`
    <div class="toolbar"><h1>Posts <small class="muted">(${total})</small></h1><a class="btn btn-primary" href="/admin/posts/new">+ New post</a></div>
    ${flash ? html`<div class="alert alert-success show">${flash}</div>` : ''}
    ${pending && status !== 'draft' ? html`<div class="alert alert-info show">${pending} auto-imported draft${pending > 1 ? 's are' : ' is'} waiting for review. <a href="/admin?status=draft">Review drafts →</a></div>` : ''}
    <form class="filters" method="get">
      <input type="search" name="q" value="${q}" placeholder="Search title or organisation">
      <select name="type">${raw('<option value="">All types</option>' + Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${type === k ? ' selected' : ''}>${esc(t.label)}</option>`).join(''))}</select>
      <select name="status"><option value="">Any status</option><option value="published"${status === 'published' ? ' selected' : ''}>Published</option><option value="draft"${status === 'draft' ? ' selected' : ''}>Draft</option></select>
      <button class="btn btn-outline btn-sm">Filter</button>
    </form>
    <div class="table-wrap"><table class="table admin-table"><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Last date</th><th>Views</th><th></th></tr></thead><tbody>
    ${rows.length ? rows.map((p) => html`<tr>
      <td><a href="/admin/posts/${p.id}/edit"><b>${p.title}</b></a>${p.featured ? raw(' <span class="tag tag-new">Featured</span>') : ''}<br><small class="muted">${p.organization || ''}</small></td>
      <td>${TYPES[p.type]?.singular || p.type}</td>
      <td><span class="tag ${p.status === 'draft' ? 'tag-closed' : 'tag-ok'}">${p.status}</span></td>
      <td class="nowrap">${fmtDate(p.last_date)}</td><td>${p.views}</td>
      <td class="nowrap"><a class="btn btn-outline btn-sm" href="/admin/posts/${p.id}/edit">Edit</a> ${p.status === 'draft' ? html`<form method="post" action="/admin/posts/${p.id}/publish" style="display:inline"><button class="btn btn-primary btn-sm">Publish</button></form>` : ''} ${p.status === 'published' ? html`<a class="btn btn-outline btn-sm" href="${postUrl(p)}" target="_blank">View</a>` : ''}</td>
    </tr>`) : raw('<tr><td colspan="6" class="muted">No posts yet. Click “New post” to add one.</td></tr>')}
    </tbody></table></div>
    ${pages > 1 ? raw(`<nav class="pagination">${Array.from({ length: pages }, (_, i) => i + 1).map((n) => (n === page ? `<span class="current">${n}</span>` : `<a href="?${qs(n)}">${n}</a>`)).join('')}</nav>`) : ''}`;
  res.send(shell('Posts', body.s));
});

// ----- Post form -----
function postForm(p, errors = {}, notice) {
  const isEdit = !!p.id;
  const quals = new Set(String(p.qualification || '').split(',').filter(Boolean));
  const f = (name, label, opts = {}) => html`<div class="${opts.wide ? 'span-2' : ''}"><label for="${name}">${label}</label>
    ${opts.area ? html`<textarea id="${name}" name="${name}" rows="${opts.rows || 4}" placeholder="${opts.ph || ''}">${p[name] ?? ''}</textarea>`
      : html`<input id="${name}" name="${name}" type="${opts.type || 'text'}" value="${p[name] ?? ''}" placeholder="${opts.ph || ''}"${opts.required ? raw(' required') : ''}>`}
    ${opts.hint ? html`<small class="muted">${opts.hint}</small>` : ''}${errors[name] ? html`<div class="field-error">${errors[name]}</div>` : ''}</div>`;
  const body = html`
    <div class="toolbar"><h1>${isEdit ? 'Edit post' : 'New post'}</h1>${isEdit && p.status === 'published' ? html`<a class="btn btn-outline btn-sm" href="${postUrl(p)}" target="_blank">View on site ↗</a>` : ''}</div>
    ${Object.keys(errors).length ? raw('<div class="alert alert-error show">Please fix the highlighted fields.</div>') : ''}
    ${notice ? html`<div class="alert alert-success show">${notice}</div>` : ''}
    <form class="form card admin-form" method="post" action="${isEdit ? `/admin/posts/${p.id}` : '/admin/posts'}">
      <div class="form-grid">
        <div><label for="type">Type</label><select id="type" name="type">${raw(Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${p.type === k ? ' selected' : ''}>${esc(t.singular)}</option>`).join(''))}</select></div>
        <div><label for="status">Status</label><select id="status" name="status"><option value="published"${p.status !== 'draft' ? ' selected' : ''}>Published</option><option value="draft"${p.status === 'draft' ? ' selected' : ''}>Draft (hidden)</option></select></div>
        ${f('title', 'Title', { wide: true, required: true, ph: 'e.g. State Police Constable Recruitment 2026 – 1,200 Posts' })}
        ${f('slug', 'URL slug', { wide: true, ph: 'Leave empty to generate from the title', hint: 'Used in the page address, e.g. /jobs/your-slug' })}
        ${f('organization', 'Organisation / Board', { ph: 'e.g. State Public Service Commission' })}
        ${f('vacancies', 'Total posts', { type: 'number' })}
        <div><label for="category">Category</label><select id="category" name="category">${options(CATEGORIES, p.category, '— None —')}</select></div>
        <div><label for="state">State / Location</label><select id="state" name="state">${options(STATES, p.state, '— None —')}</select></div>
        <div class="span-2"><label>Qualification</label><div class="check-grid">${QUALIFICATIONS.map((q) => html`<label class="check"><input type="checkbox" name="qualification" value="${q}"${quals.has(q) ? raw(' checked') : ''}> ${q}</label>`)}</div></div>
        ${f('start_date', 'Application start date', { type: 'date' })}
        ${f('last_date', 'Last date to apply', { type: 'date' })}
        ${f('exam_date', 'Exam date', { type: 'date' })}
        ${f('salary', 'Salary / Pay scale', { ph: 'e.g. ₹25,500 – ₹81,100 (Level 4)' })}
        ${f('summary', 'Short summary', { wide: true, area: true, rows: 2, hint: 'Shown at the top of the page and in search engines.' })}
        ${f('fees', 'Application fee', { wide: true, area: true, ph: 'General / OBC: ₹500\nSC / ST / Women: ₹250\nPayment: Online', hint: 'Tip: "Label: value" lines become a table, "- item" lines become a list.' })}
        ${f('age_limit', 'Age limit', { wide: true, area: true, ph: 'Minimum age: 18 years\nMaximum age: 27 years\nAge relaxation as per rules.' })}
        ${f('eligibility', 'Eligibility / Qualification details', { wide: true, area: true })}
        ${f('selection', 'Selection process', { wide: true, area: true, ph: '- Written exam\n- Physical test\n- Document verification' })}
        ${f('how_to_apply', 'How to apply', { wide: true, area: true })}
        ${f('content', 'Other details', { wide: true, area: true, rows: 6, hint: 'Vacancy break-up, exam pattern, anything else.' })}
        <div class="span-2"><label for="links">Important links</label><textarea id="links" name="links" rows="4" placeholder="Apply Online | https://...\nOfficial Notification (PDF) | https://...\nOfficial Website | https://...">${p.linksText ?? linksToText(p.links)}</textarea><small class="muted">One per line: Label | https://url</small></div>
        <div class="span-2"><label class="check"><input type="checkbox" name="featured"${p.featured ? raw(' checked') : ''}> Feature on the home page</label></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${isEdit ? 'Save changes' : 'Publish'}</button> <a class="btn btn-outline" href="/admin">Cancel</a></div>
    </form>
    ${isEdit && p.status === 'published' ? html`<form method="post" action="/admin/posts/${p.id}/notify" class="danger-zone" data-confirm="Email this post to all matching instant subscribers now?"><button class="btn btn-outline btn-sm">📧 Email this post to instant subscribers now</button> <small class="muted">${p.alerted_at ? `Last alert: ${fmtDate(p.alerted_at)}` : 'Not emailed yet'}</small></form>` : ''}
    ${isEdit ? html`<form method="post" action="/admin/posts/${p.id}/delete" class="danger-zone" data-confirm="Delete this post permanently?"><button class="btn btn-danger btn-sm">Delete post</button></form>` : ''}`;
  return shell(isEdit ? 'Edit post' : 'New post', body.s);
}

// Send instant alerts in the background the first time a post is published.
function maybeAlert(id) {
  const p = posts.get(id);
  if (!config.instantAlerts || !p || p.status !== 'published' || p.alerted_at) return false;
  mailer.sendInstantForPost(id).catch((e) => console.error('[mail]', e.message));
  return true;
}

router.post('/posts/:id/publish', (req, res, next) => {
  const id = Number(req.params.id);
  if (!posts.publish(id)) return next();
  res.redirect(303, `/admin?status=draft&msg=${maybeAlert(id) ? 'alerted' : 'published'}`);
});

router.post('/posts/:id/notify', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!posts.get(id)) return next();
  const r = await mailer.sendInstantForPost(id, { force: true });
  res.redirect(303, `/admin/posts/${id}/edit?notified=${r.skipped ? 'skip' : r.sent}`);
});

router.get('/posts/new', (req, res) => res.send(postForm({ type: TYPES[req.query.type] ? req.query.type : 'job', status: 'published', links: [] })));

router.post('/posts', (req, res) => {
  const { data, errors } = validatePost(req.body);
  if (Object.keys(errors).length) return res.status(400).send(postForm({ ...data, linksText: req.body.links }, errors));
  const id = posts.create(data);
  res.redirect(303, `/admin?msg=${maybeAlert(id) ? 'alerted' : 'saved'}`);
});

router.get('/posts/:id/edit', (req, res, next) => {
  const p = posts.get(Number(req.params.id));
  if (!p) return next();
  const n = req.query.notified;
  res.send(postForm(p, {}, n === undefined ? null : n === 'skip' ? 'Post is not published, so no emails were sent.' : `Alert emailed to ${n} subscriber(s).`));
});

router.post('/posts/:id', (req, res, next) => {
  const id = Number(req.params.id);
  const existing = posts.get(id);
  if (!existing) return next();
  const { data, errors } = validatePost(req.body);
  if (Object.keys(errors).length) return res.status(400).send(postForm({ ...data, id, linksText: req.body.links }, errors));
  posts.update(id, data);
  res.redirect(303, `/admin?msg=${maybeAlert(id) ? 'alerted' : 'saved'}`);
});

router.post('/posts/:id/delete', (req, res) => {
  posts.remove(Number(req.params.id));
  res.redirect(303, '/admin?msg=deleted');
});

// ----- Subscribers -----
router.get('/subscribers', (req, res) => {
  const list = subscribers.list();
  res.send(shell('Subscribers', html`<div class="toolbar"><h1>Subscribers <small class="muted">(${list.length})</small></h1>${list.length ? raw('<a class="btn btn-outline btn-sm" href="/admin/subscribers.csv">Download CSV</a>') : ''}</div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Email</th><th>Alerts</th><th>Preferences</th><th>Joined</th><th></th></tr></thead><tbody>
    ${list.length ? list.map((s) => html`<tr><td>${s.email}</td><td>${s.active ? s.frequency : raw('<span class="tag tag-closed">unsubscribed</span>')}</td>
      <td><small>${[s.types, s.categories, s.qualifications, s.states].filter(Boolean).join(' · ').replace(/,/g, ', ') || 'Everything'}</small></td><td>${fmtDate(s.created_at)}</td><td><form method="post" action="/admin/subscribers/${s.id}/delete" data-confirm="Remove this subscriber?"><button class="btn btn-outline btn-sm">Remove</button></form></td></tr>`) : raw('<tr><td colspan="5" class="muted">No subscribers yet.</td></tr>')}
    </tbody></table></div>`.s));
});
router.get('/subscribers.csv', (req, res) => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = subscribers.list().map((s) => [s.email, s.active ? 'yes' : 'no', s.frequency, s.types, s.categories, s.qualifications, s.states, s.created_at].map(q).join(','));
  res.type('text/csv').attachment('subscribers.csv').send(['email,active,frequency,types,categories,qualifications,states,created_at', ...rows].join('\n'));
});
router.post('/subscribers/:id/delete', (req, res) => { subscribers.remove(Number(req.params.id)); res.redirect(303, '/admin/subscribers'); });

// ----- Email alerts -----
router.get('/email', async (req, res) => {
  const st = subscribers.stats();
  const status = await mailer.verify();
  const flash = req.query.msg;
  res.send(shell('Email alerts', html`<h1>Email alerts</h1>
    ${flash ? html`<div class="alert alert-success show">${flash}</div>` : ''}
    <div class="stat-row">
      <div class="card"><b>${st.active}</b><span>Active subscribers</span></div>
      <div class="card"><b>${st.instant}</b><span>Instant alerts</span></div>
      <div class="card"><b>${st.daily}</b><span>Daily digest</span></div>
    </div>
    <div class="card" style="margin:16px 0">
      <h2>Email server (SMTP)</h2>
      <p>${status.ok ? raw('<span class="tag tag-ok">Connected</span>') : raw('<span class="tag tag-closed">Not working</span>')} ${status.message}</p>
      <p class="muted">Configure with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM in .env. Instant alerts are ${config.instantAlerts ? 'ON' : 'OFF'}. The daily digest goes out at ${String(config.digestHour).padStart(2, '0')}:00 (${config.timezone}).${settings.get('last_digest_at') ? ` Last digest: ${settings.get('last_digest_at')} UTC.` : ''}</p>
      <form method="post" action="/admin/email/test" class="inline-form"><input type="email" name="to" placeholder="your@email.com" required><button class="btn btn-outline btn-sm">Send test email</button></form>
    </div>
    <div class="card" style="margin:16px 0">
      <h2>Send now</h2>
      <p>New posts are emailed to <b>instant</b> subscribers automatically when you publish them. You can also re-send a single post from its edit page.</p>
      <form method="post" action="/admin/email/digest" data-confirm="Send the daily digest now to all daily subscribers?"><button class="btn btn-primary">Send daily digest now</button> <small class="muted">Includes every post published since the last digest.</small></form>
    </div>
    <h2>Recent sends</h2>
    <div class="table-wrap"><table class="table"><thead><tr><th>When (UTC)</th><th>Type</th><th>Post</th><th>Sent</th><th>Failed</th><th>Note</th></tr></thead><tbody>
    ${emailLog.recent().length ? '' : raw('<tr><td colspan="6" class="muted">No emails sent yet.</td></tr>')}
    ${emailLog.recent().map((e) => html`<tr><td class="nowrap">${e.created_at}</td><td>${e.kind}</td><td>${e.post_id ? html`<a href="/admin/posts/${e.post_id}/edit">#${e.post_id}</a>` : '—'}</td><td>${e.recipients}</td><td>${e.failed}</td><td><small>${e.note || ''}</small></td></tr>`)}
    </tbody></table></div>`.s));
});
router.post('/email/test', async (req, res) => {
  const to = String(req.body.to || '').trim().slice(0, 200);
  let msg;
  try { await mailer.sendTest(to); msg = mailer.smtpReady ? `Test email sent to ${to}.` : 'SMTP is not configured, so the email was only logged to the server console.'; } catch (e) { msg = `Sending failed: ${e.message}`; }
  res.redirect(303, `/admin/email?msg=${encodeURIComponent(msg)}`);
});
router.post('/email/digest', async (req, res) => {
  const r = await mailer.sendDailyDigest();
  res.redirect(303, `/admin/email?msg=${encodeURIComponent(r.posts ? `Digest sent to ${r.sent} subscriber(s) (${r.failed} failed), covering ${r.posts} new post(s).` : 'No new posts since the last digest, so nothing was sent.')}`);
});

// ----- Auto-import sources -----
const STATUS_TAG = { ok: 'tag-ok', error: 'tag-closed', blocked: 'tag-soon' };
function readSource(b = {}) {
  const kw = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean).join(', ').slice(0, 500);
  let url = String(b.url || '').trim().slice(0, 1000);
  const errors = {};
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw new Error(); } catch { errors.url = 'Enter a full web address starting with https://'; }
  const name = String(b.name || '').trim().slice(0, 120);
  if (name.length < 2) errors.name = 'Give this source a name, e.g. "Staff Selection Commission".';
  return {
    data: {
      name, url, kind: b.kind === 'rss' ? 'rss' : 'html', selector: String(b.selector || '').trim().slice(0, 300) || null,
      include_keywords: kw(b.include_keywords) || null, exclude_keywords: kw(b.exclude_keywords) || null,
      default_type: TYPES[b.default_type] ? b.default_type : null,
      default_category: CATEGORIES.includes(b.default_category) ? b.default_category : null,
      default_state: ALL_STATES.includes(b.default_state) ? b.default_state : null,
      auto_publish: b.auto_publish === 'on' ? 1 : 0, enabled: b.enabled === 'on' ? 1 : 0,
      interval_minutes: Math.min(Math.max(parseInt(b.interval_minutes, 10) || 60, 15), 1440),
    },
    errors,
  };
}

router.get('/sources', (req, res) => {
  const list = sources.list();
  res.send(shell('Auto-import', html`
    <div class="toolbar"><h1>Auto-import from official websites</h1><a class="btn btn-primary" href="/admin/sources/new">+ Add source</a></div>
    ${req.query.msg ? html`<div class="alert alert-success show">${req.query.msg}</div>` : ''}
    <p class="muted">Add the "latest notifications" page or RSS feed of official recruitment websites. The site checks each one on a schedule and turns new notices into drafts for you to review (or publishes them directly if you turn on auto-publish). It follows each website's robots.txt rules and identifies itself as <code>${importer.USER_AGENT}</code>.</p>
    <div class="table-wrap"><table class="table admin-table"><thead><tr><th>Source</th><th>Every</th><th>Last check</th><th>Status</th><th>Imported</th><th></th></tr></thead><tbody>
    ${list.length ? list.map((s) => html`<tr>
      <td><a href="/admin/sources/${s.id}"><b>${s.name}</b></a> ${s.enabled ? '' : raw('<span class="tag tag-closed">paused</span>')} ${s.auto_publish ? raw('<span class="tag tag-new">auto-publish</span>') : ''}<br><small class="muted">${s.url.length > 70 ? s.url.slice(0, 70) + '…' : s.url}</small></td>
      <td class="nowrap">${s.interval_minutes} min</td>
      <td class="nowrap">${s.last_checked_at ? html`${s.last_checked_at} UTC` : raw('<span class="muted">Not yet</span>')}</td>
      <td>${s.last_status ? html`<span class="tag ${STATUS_TAG[s.last_status] || ''}">${s.last_status}</span><br><small class="muted">${s.last_message || ''}</small>` : ''}</td>
      <td>${s.imported}</td>
      <td class="nowrap"><form method="post" action="/admin/sources/${s.id}/check" style="display:inline"><button class="btn btn-outline btn-sm">Check now</button></form> <a class="btn btn-outline btn-sm" href="/admin/sources/${s.id}/edit">Edit</a></td>
    </tr>`) : raw('<tr><td colspan="6" class="muted">No sources yet. Click “Add source” to add your first official website.</td></tr>')}
    </tbody></table></div>
    <div class="card" style="margin-top:16px"><h2>Tips</h2><ul>
      <li>Use official websites only (commissions, boards, ministries, PSUs, banks, universities). Don't add other job-alert websites: their content is copyrighted and their terms usually forbid copying.</li>
      <li>Point the source at the page that lists notices (often called "What's New", "Latest News", "Recruitment" or "Notices"). If the site has an RSS feed, use that.</li>
      <li>Use <b>Test</b> on the form to see what would be picked up before saving. If it picks up menu links, add a CSS selector for the notice list, e.g. <code>#latest-news a</code> or <code>table.notices a</code>.</li>
      <li>The first check only remembers what's already there. After that, only newly added notices become drafts.</li>
    </ul></div>`.s));
});

function sourceForm(s, { errors = {}, previewResult } = {}) {
  const isEdit = !!s.id;
  const err = (f) => (errors[f] ? html`<div class="field-error">${errors[f]}</div>` : '');
  return shell(isEdit ? 'Edit source' : 'Add source', html`
    <div class="toolbar"><h1>${isEdit ? 'Edit source' : 'Add a source'}</h1>${isEdit ? html`<a class="btn btn-outline btn-sm" href="/admin/sources/${s.id}">View history</a>` : ''}</div>
    ${Object.keys(errors).length ? raw('<div class="alert alert-error show">Please fix the highlighted fields.</div>') : ''}
    ${previewResult ? previewResult : ''}
    <form class="form card admin-form" method="post" action="${isEdit ? `/admin/sources/${s.id}` : '/admin/sources'}">
      <div class="form-grid">
        <div><label for="name">Name</label><input id="name" name="name" value="${s.name || ''}" placeholder="e.g. Staff Selection Commission" required>${err('name')}</div>
        <div><label for="kind">Type</label><select id="kind" name="kind"><option value="html"${s.kind !== 'rss' ? raw(' selected') : ''}>Web page with a list of notices</option><option value="rss"${s.kind === 'rss' ? raw(' selected') : ''}>RSS / Atom feed</option></select></div>
        <div class="span-2"><label for="url">Page or feed address</label><input id="url" name="url" value="${s.url || ''}" placeholder="https://www.example.gov.in/latest-notices" required>${err('url')}</div>
        <div class="span-2"><label for="selector">CSS selector for the notice links (optional)</label><input id="selector" name="selector" value="${s.selector || ''}" placeholder="Leave empty to scan every link on the page, e.g. #news a"><small class="muted">Only for web pages. Narrows the scan to the part of the page that lists notices.</small></div>
        <div><label for="include_keywords">Only keep links containing (optional)</label><input id="include_keywords" name="include_keywords" value="${s.include_keywords || ''}" placeholder="recruitment, result, admit card"><small class="muted">Comma separated. Empty uses built-in job words. Use * to keep everything.</small></div>
        <div><label for="exclude_keywords">Skip links containing (optional)</label><input id="exclude_keywords" name="exclude_keywords" value="${s.exclude_keywords || ''}" placeholder="tender, corrigendum"></div>
        <div><label for="default_type">Post type</label><select id="default_type" name="default_type">${raw('<option value="">Guess from the title</option>' + Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${s.default_type === k ? ' selected' : ''}>${esc(t.singular)}</option>`).join(''))}</select></div>
        <div><label for="interval_minutes">Check every (minutes)</label><input id="interval_minutes" name="interval_minutes" type="number" min="15" max="1440" value="${s.interval_minutes || 60}"></div>
        <div><label for="default_category">Category for imported posts</label><select id="default_category" name="default_category">${options(CATEGORIES, s.default_category, '— None —')}</select></div>
        <div><label for="default_state">State for imported posts</label><select id="default_state" name="default_state">${options(ALL_STATES, s.default_state, '— None —')}</select></div>
        <div class="span-2"><label class="check"><input type="checkbox" name="enabled"${s.enabled !== 0 ? raw(' checked') : ''}> Check this source automatically</label></div>
        <div class="span-2"><label class="check"><input type="checkbox" name="auto_publish"${s.auto_publish ? raw(' checked') : ''}> Auto-publish new notices (skips review and emails instant subscribers right away)</label>
          <small class="muted">Recommended off: imported posts only have a title and link, so it's better to add dates, fees and eligibility first.</small></div>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${isEdit ? 'Save source' : 'Add source'}</button>
        <button class="btn btn-outline" type="submit" formaction="/admin/sources/test">Test (preview only)</button>
        <a class="btn btn-outline" href="/admin/sources">Cancel</a>
      </div>
      ${isEdit ? html`<input type="hidden" name="id" value="${s.id}">` : ''}
    </form>
    ${isEdit ? html`<form method="post" action="/admin/sources/${s.id}/delete" class="danger-zone" data-confirm="Delete this source? Posts already imported stay."><button class="btn btn-danger btn-sm">Delete source</button></form>` : ''}`.s);
}

router.get('/sources/new', (req, res) => res.send(sourceForm({ interval_minutes: 60, enabled: 1 })));
router.post('/sources', (req, res) => {
  const { data, errors } = readSource(req.body);
  if (Object.keys(errors).length) return res.status(400).send(sourceForm(data, { errors }));
  const id = sources.create(data);
  // Run the first check right away so the user sees it working.
  importer.checkSource(sources.get(id)).catch((e) => console.error('[sources]', e));
  res.redirect(303, `/admin/sources?msg=${encodeURIComponent('Source added. The first check is running now.')}`);
});
router.post('/sources/test', async (req, res) => {
  const { data, errors } = readSource(req.body);
  const id = Number(req.body.id) || undefined;
  if (Object.keys(errors).length) return res.status(400).send(sourceForm({ ...data, id }, { errors }));
  let block;
  try {
    const r = await importer.preview(data);
    block = html`<div class="card" style="margin-bottom:16px"><h2>Test result</h2>
      <p>Found ${r.raw} link(s) on the page, <b>${r.items.length}</b> look like job notices${r.items.length > 50 ? ' (showing the first 50)' : ''}. Nothing was saved.</p>
      ${r.items.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Notice</th><th>Would be</th></tr></thead><tbody>${r.items.slice(0, 50).map((i) => html`<tr><td><a href="${i.url}" target="_blank" rel="noopener">${i.title}</a></td><td>${TYPES[i.type].singular}</td></tr>`)}</tbody></table></div>`
        : raw('<p class="muted">Nothing matched. Try clearing the CSS selector, or set "Only keep links containing" to * to see every link.</p>')}</div>`;
  } catch (e) {
    block = html`<div class="alert alert-error show">Test failed: ${e.name === 'TimeoutError' ? 'the website took too long to respond.' : e.message}</div>`;
  }
  res.send(sourceForm({ ...data, id }, { previewResult: block }));
});
router.get('/sources/:id', (req, res, next) => {
  const s = sources.get(Number(req.params.id));
  if (!s) return next();
  const items = sources.items(s.id), runs = sources.runs(s.id);
  res.send(shell(s.name, html`
    <div class="toolbar"><h1>${s.name}</h1><div><form method="post" action="/admin/sources/${s.id}/check" style="display:inline"><button class="btn btn-primary btn-sm">Check now</button></form> <a class="btn btn-outline btn-sm" href="/admin/sources/${s.id}/edit">Edit</a></div></div>
    <p><a href="${s.url}" target="_blank" rel="noopener">${s.url}</a></p>
    <h2>Recent checks</h2>
    <div class="table-wrap"><table class="table"><thead><tr><th>When (UTC)</th><th>Status</th><th>Notices found</th><th>Imported</th><th>Message</th></tr></thead><tbody>
    ${runs.length ? runs.map((r) => html`<tr><td class="nowrap">${r.created_at}</td><td><span class="tag ${STATUS_TAG[r.status] || ''}">${r.status}</span></td><td>${r.found}</td><td>${r.created}</td><td><small>${r.message || ''}</small></td></tr>`) : raw('<tr><td colspan="5" class="muted">Not checked yet.</td></tr>')}
    </tbody></table></div>
    <h2 style="margin-top:20px">Notices seen</h2>
    <div class="table-wrap"><table class="table"><thead><tr><th>Notice</th><th>Post</th><th>Seen (UTC)</th></tr></thead><tbody>
    ${items.length ? items.map((i) => html`<tr><td><a href="${i.url}" target="_blank" rel="noopener">${i.title}</a></td>
      <td>${i.post_id ? (i.post_status ? html`<a href="/admin/posts/${i.post_id}/edit">${i.post_status}</a>` : 'deleted') : raw('<span class="muted">existing at first check</span>')}</td><td class="nowrap">${i.seen_at}</td></tr>`) : raw('<tr><td colspan="3" class="muted">None yet.</td></tr>')}
    </tbody></table></div>`.s));
});
router.get('/sources/:id/edit', (req, res, next) => {
  const s = sources.get(Number(req.params.id));
  if (!s) return next();
  res.send(sourceForm(s));
});
router.post('/sources/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (!sources.get(id)) return next();
  const { data, errors } = readSource(req.body);
  if (Object.keys(errors).length) return res.status(400).send(sourceForm({ ...data, id }, { errors }));
  sources.update(id, data);
  res.redirect(303, `/admin/sources?msg=${encodeURIComponent('Source saved.')}`);
});
router.post('/sources/:id/check', async (req, res, next) => {
  const s = sources.get(Number(req.params.id));
  if (!s) return next();
  const r = await importer.checkSource(s);
  res.redirect(303, `/admin/sources?msg=${encodeURIComponent(`${s.name}: ${r.message}`)}`);
});
router.post('/sources/:id/delete', (req, res) => {
  sources.remove(Number(req.params.id));
  res.redirect(303, `/admin/sources?msg=${encodeURIComponent('Source deleted.')}`);
});

// ----- Messages -----
router.get('/messages', (req, res) => {
  const list = messages.list();
  res.send(shell('Messages', html`<h1>Messages <small class="muted">(${list.length})</small></h1>
    ${list.length ? list.map((m) => html`<article class="card msg"><div class="msg-head"><div><b>${m.name}</b> · <a href="mailto:${m.email}">${m.email}</a></div><small class="muted">${fmtDate(m.created_at)}</small></div>
      <p class="msg-body">${m.message}</p><form method="post" action="/admin/messages/${m.id}/delete" data-confirm="Delete this message?"><button class="btn btn-outline btn-sm">Delete</button></form></article>`) : raw('<p class="muted">No messages yet.</p>')}`.s));
});
router.post('/messages/:id/delete', (req, res) => { messages.remove(Number(req.params.id)); res.redirect(303, '/admin/messages'); });

module.exports = router;
