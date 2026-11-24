const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { posts, subscribers, messages } = require('./db');
const mailer = require('./mailer');
const { TYPES, CATEGORIES, QUALIFICATIONS, STATES, fromSlug, typeByPath, slugify } = require('./taxonomy');
const { validateEmail, validateContact } = require('./validate');
const v = require('./views');

const router = express.Router();
const PER_PAGE = 20;

const formLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

function readFilters(query) {
  const pick = (val, list) => (list.includes(val) ? val : '');
  return {
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '',
    type: TYPES[query.type] ? query.type : '',
    category: pick(query.category, CATEGORIES),
    state: pick(query.state, STATES),
    qualification: pick(query.qualification, QUALIFICATIONS),
    sort: query.sort === 'last_date' ? 'last_date' : '',
    active: query.active === '1' ? '1' : '',
  };
}
const pageNum = (q) => Math.max(1, Math.min(parseInt(q.page, 10) || 1, 1000));

function renderList(req, res, { heading, intro, crumbs, canonical, fixed = {}, showType = false }) {
  const filters = readFilters(req.query);
  const page = pageNum(req.query);
  const { total, rows } = posts.list({
    ...filters, ...fixed, type: fixed.type || filters.type || undefined,
    active: !!filters.active, sort: filters.sort || 'new', limit: PER_PAGE, offset: (page - 1) * PER_PAGE,
  });
  res.send(v.listPage({ heading, intro, crumbs, canonical, rows, total, page, perPage: PER_PAGE, filters, showType, basePath: req.path }));
}

router.get('/', (req, res) => {
  const boxes = {};
  for (const k of Object.keys(TYPES)) boxes[k] = posts.list({ type: k, limit: 12 }).rows;
  const closing = posts.list({ type: 'job', active: true, sort: 'last_date', limit: 10 }).rows;
  const featured = posts.list({ featured: true, limit: 8 }).rows;
  res.send(v.homePage({ boxes, closing, featured, catCounts: posts.countsBy('category'), stateCounts: posts.countsBy('state') }));
});

router.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  renderList(req, res, { heading: q ? `Search results for "${q.slice(0, 100)}"` : 'Search', crumbs: [['Search']], canonical: '/search', showType: true });
});

for (const [kind, list] of [['category', CATEGORIES], ['state', STATES], ['qualification', QUALIFICATIONS]]) {
  router.get(`/${kind}/:slug`, (req, res, next) => {
    const value = fromSlug(list, req.params.slug);
    if (!value) return next();
    const heading = kind === 'state' ? `${value} Govt Jobs` : kind === 'qualification' ? `${value} Jobs` : value;
    renderList(req, res, {
      heading, intro: `Latest ${heading.toLowerCase()} notifications, results and admit cards.`,
      crumbs: [[heading]], canonical: `/${kind}/${req.params.slug}`, fixed: { [kind]: value }, showType: true,
    });
  });
}

router.get('/about', (req, res) => res.send(v.staticPage('About Us', v.html`
  <p>${config.siteName} brings together the latest government and private job notifications, exam results, admit cards and answer keys in one simple, fast website.</p>
  <p>Our team reads official notifications and publishes the important details (dates, eligibility, fees and direct links) so you can find what matters quickly.</p>
  <p>We are an independent information portal and are not connected to any government body or recruiting organisation. Always check the official notification before you apply.</p>`, '/about')));

router.get('/privacy', (req, res) => res.send(v.staticPage('Privacy Policy', v.html`
  <p>We respect your privacy. This policy explains what we collect and why.</p>
  <h2>Information we collect</h2>
  <ul><li>Email address, if you subscribe to job alerts.</li><li>Name, email and message, if you contact us.</li><li>Basic, anonymous server logs needed to keep the site secure and running.</li></ul>
  <h2>How we use it</h2>
  <p>We use your email only to send the alerts you asked for or to reply to you. We never sell your data. You can ask us to delete your data at any time by writing to <a href="mailto:${config.contactEmail}">${config.contactEmail}</a>.</p>
  <h2>Cookies</h2><p>The public site does not set tracking cookies. If you add analytics or ads, update this section.</p>`, '/privacy')));

router.get('/disclaimer', (req, res) => res.send(v.staticPage('Disclaimer', v.html`
  <p>The information on ${config.siteName} is collected from official websites, newspapers and notifications and is provided for general information only.</p>
  <p>While we try to keep it accurate and up to date, we make no guarantee of completeness or accuracy. Dates, fees and eligibility can change. Always verify with the official notification before taking any action.</p>
  <p>${config.siteName} is not a recruiting agency and never asks candidates for money for jobs. Beware of fraud.</p>`, '/disclaimer')));

router.get('/contact', (req, res) => res.send(v.contactPage({ sent: req.query.sent === '1' })));
router.post('/contact', formLimiter, (req, res) => {
  const { data, errors, isSpam } = validateContact(req.body);
  if (isSpam) return res.redirect(303, '/contact?sent=1');
  if (Object.keys(errors).length) return res.status(400).send(v.contactPage({ errors, values: data }));
  messages.add(data);
  res.redirect(303, '/contact?sent=1');
});

// ---- Email alerts ----
const csv = (v, allowed) => [].concat(v || []).filter((x) => allowed.includes(x)).join(',');
function readPrefs(body = {}) {
  return {
    frequency: body.frequency === 'instant' ? 'instant' : 'daily',
    types: csv(body.types, Object.keys(TYPES)), categories: csv(body.categories, CATEGORIES),
    states: csv(body.states, STATES), qualifications: csv(body.qualifications, QUALIFICATIONS),
  };
}
const fireAndForget = (p) => p.catch((e) => console.error('[mail]', e.message));

// New subscriber: create + welcome email. Existing subscriber: never overwrite their
// preferences from a public form; email them their private manage link instead.
async function subscribe(email, prefs) {
  const existing = subscribers.byEmail(email);
  if (existing) { fireAndForget(mailer.sendWelcome(existing)); return false; }
  const { sub } = subscribers.upsert(email, prefs);
  fireAndForget(mailer.sendWelcome(sub));
  return true;
}

// Footer quick signup: JSON (from main.js) or plain form post. Daily digest, everything.
router.post('/subscribe', formLimiter, async (req, res) => {
  const email = validateEmail(req.body?.email);
  const wantsJson = req.is('application/json');
  if (!email) return wantsJson ? res.status(400).json({ error: 'Please enter a valid email address.' }) : res.redirect(303, '/?subscribed=0');
  await subscribe(email, { frequency: 'daily' });
  return wantsJson ? res.status(201).json({ ok: true }) : res.redirect(303, '/?subscribed=1');
});

router.get('/alerts', (req, res) => res.send(v.alertsPage({
  message: req.query.done === '1' ? 'Done! Check your inbox for a confirmation email with a link to change your preferences anytime.' : null,
})));
router.post('/alerts', formLimiter, async (req, res) => {
  if (typeof req.body.website === 'string' && req.body.website.trim()) return res.redirect(303, '/alerts?done=1');
  const email = validateEmail(req.body.email);
  const prefs = readPrefs(req.body);
  if (!email) return res.status(400).send(v.alertsPage({ sub: { ...prefs, email: req.body.email }, error: 'Please enter a valid email address.' }));
  await subscribe(email, prefs);
  res.redirect(303, '/alerts?done=1');
});

router.get('/alerts/manage', (req, res, next) => {
  const sub = subscribers.byToken(req.query.token);
  if (!sub) return next();
  res.send(v.alertsPage({ mode: 'manage', sub, message: req.query.saved === '1' ? 'Your preferences have been saved.' : null }));
});
router.post('/alerts/manage', formLimiter, (req, res, next) => {
  const sub = subscribers.byToken(req.body.token);
  if (!sub) return next();
  subscribers.updatePrefs(sub.id, readPrefs(req.body));
  res.redirect(303, `/alerts/manage?token=${encodeURIComponent(sub.token)}&saved=1`);
});

router.get('/alerts/unsubscribe', (req, res) => res.send(v.unsubscribePage(subscribers.byToken(req.query.token), false)));
// Also handles one-click unsubscribe (RFC 8058) from email clients.
router.post('/alerts/unsubscribe', (req, res) => {
  const sub = subscribers.byToken(req.query.token || req.body?.token);
  if (sub) subscribers.setActive(sub.id, false);
  res.send(v.unsubscribePage(sub, true));
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /search\nDisallow: /alerts/\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const u = (loc, lastmod, pri = '0.6') => `<url><loc>${v.esc(config.siteUrl + loc)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}<priority>${pri}</priority></url>`;
  const urls = [u('/', null, '1.0'), ...Object.values(TYPES).map((t) => u(`/${t.path}`, null, '0.9')),
    ...CATEGORIES.map((c) => u(`/category/${slugify(c)}`, null, '0.5')), ...STATES.map((s) => u(`/state/${slugify(s)}`, null, '0.5')),
    ...QUALIFICATIONS.map((q) => u(`/qualification/${slugify(q)}`, null, '0.5')),
    ...['/alerts', '/about', '/contact', '/privacy', '/disclaimer'].map((p) => u(p, null, '0.3')),
    ...posts.allPublishedForSitemap().map((p) => u(`/${TYPES[p.type]?.path || 'jobs'}/${p.slug}`, p.updated_at, '0.8'))];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
});

router.get('/api/health', (req, res) => res.json({ ok: true, posts: posts.count() }));

// Listings: /jobs, /results, /admit-cards ...
router.get('/:typePath', (req, res, next) => {
  const type = typeByPath(req.params.typePath);
  if (!type) return next();
  const t = TYPES[type];
  renderList(req, res, {
    heading: t.label, intro: `All the latest ${t.label.replace(/^Latest /, '').toLowerCase()} in one place, updated daily.`,
    crumbs: [[t.label]], canonical: `/${t.path}`, fixed: { type },
  });
});

// Detail: /jobs/:slug
router.get('/:typePath/:slug', (req, res, next) => {
  const type = typeByPath(req.params.typePath);
  if (!type) return next();
  const post = posts.bySlug(req.params.slug);
  if (!post) return next();
  if (post.type !== type) return res.redirect(301, v.postUrl(post));
  posts.addView(post.id);
  const related = posts.list({ type: post.type, category: post.category || undefined, limit: 9 }).rows.filter((r) => r.id !== post.id).slice(0, 8);
  res.send(v.detailPage(post, related));
});

module.exports = router;
