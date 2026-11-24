// Watches official recruitment websites (HTML pages or RSS/Atom feeds) for new notices and
// turns them into draft posts. Polite by design: obeys robots.txt, identifies itself, waits
// between requests to the same site and never fetches more often than each source allows.
const cheerio = require('cheerio');
const config = require('./config');
const { posts, sources } = require('./db');
const { TYPES } = require('./taxonomy');

const USER_AGENT = `${config.siteName.replace(/\s+/g, '')}Bot/1.0 (+${config.siteUrl})`;
const BOT_TOKEN = USER_AGENT.split('/')[0].toLowerCase();
const MAX_BYTES = 3 * 1024 * 1024;
const HOST_GAP_MS = Number(process.env.SOURCE_HOST_GAP_MS ?? 3000);
const MAX_NEW_PER_RUN = 25;

const DEFAULT_INCLUDE = ['recruitment', 'notification', 'vacancy', 'vacancies', 'advertisement', 'advt', 'result', 'admit card',
  'hall ticket', 'call letter', 'answer key', 'exam', 'apply', 'application', 'selection list', 'merit list', 'interview',
  'syllabus', 'admission', 'posts', 'engagement', 'walk-in', 'walk in'];
const DEFAULT_EXCLUDE = ['tender', 'rti', 'auction', 'quotation'];

// ---------- fetching ----------
const lastHit = new Map();
async function politeWait(host) {
  const wait = (lastHit.get(host) || 0) + HOST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

async function fetchText(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are supported');
  await politeWait(u.host);
  const res = await fetch(u, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5' },
    redirect: 'follow', signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${u.host}`);
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('Page is too large');
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { reader.cancel(); throw new Error('Page is too large'); }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), finalUrl: res.url || url, contentType: res.headers.get('content-type') || '' };
}

// ---------- robots.txt ----------
const robotsCache = new Map(); // origin -> { at, rules }
function parseRobots(text) {
  const groups = []; let cur = null; let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && BOT_TOKEN.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}
function pathAllowed(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue; // "Disallow:" (empty) allows everything
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
async function robotsAllows(url) {
  const u = new URL(url);
  let entry = robotsCache.get(u.origin);
  if (!entry || Date.now() - entry.at > 6 * 3600 * 1000) {
    let rules = [];
    try { rules = parseRobots((await fetchText(`${u.origin}/robots.txt`)).text); } catch { rules = []; } // no robots.txt = allowed
    entry = { at: Date.now(), rules };
    robotsCache.set(u.origin, entry);
  }
  return pathAllowed(entry.rules, u.pathname + u.search);
}

// ---------- parsing ----------
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const list = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

function parseFeed(xml, base) {
  const $ = cheerio.load(xml, { xml: true });
  const out = [];
  $('item').each((_, el) => out.push({ title: clean($(el).children('title').text()), url: clean($(el).children('link').text()) || clean($(el).children('guid').text()) }));
  $('entry').each((_, el) => {
    const link = $(el).children('link[rel="alternate"]').attr('href') || $(el).children('link').attr('href');
    out.push({ title: clean($(el).children('title').text()), url: clean(link) });
  });
  return out.map((i) => ({ ...i, url: absolute(i.url, base) })).filter((i) => i.url && i.title);
}

function absolute(href, base) {
  if (!href || /^(javascript|mailto|tel):/i.test(href) || href.trim() === '#') return null;
  try { const u = new URL(href.trim(), base); u.hash = ''; return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
}

function parseHtml(html, base, selector) {
  const $ = cheerio.load(html);
  const out = [];
  let nodes;
  try { nodes = $(selector || 'a'); } catch { throw new Error(`Invalid CSS selector: ${selector}`); }
  nodes.each((_, el) => {
    const anchors = el.tagName === 'a' ? [el] : $(el).find('a').toArray();
    for (const a of anchors) {
      const url = absolute($(a).attr('href'), base);
      if (!url) continue;
      let title = clean($(a).text()) || clean($(a).attr('title'));
      // Links like "Click here" / "Download": use the surrounding row or list item text instead.
      if (title.length < 12 || /^(click here|download|view|details|pdf|link|apply online|here)$/i.test(title)) {
        const row = $(a).closest('tr, li, p, div').first();
        const rowText = row.length ? clean(cheerio.load(`<x>${(row.html() || '').replace(/<[^>]+>/g, ' ')}</x>`)('x').text()) : '';
        title = rowText.replace(/\b(click here|download|view details|view|pdf|apply online)\b\s*$/gi, '').trim() || title;
      }
      if (title.length >= 8) out.push({ title: title.slice(0, 250), url });
    }
  });
  return out;
}

function filterItems(items, source) {
  const inc = list(source.include_keywords);
  const include = inc.includes('*') ? null : (inc.length ? inc : DEFAULT_INCLUDE);
  const exclude = [...DEFAULT_EXCLUDE, ...list(source.exclude_keywords)];
  const seen = new Set();
  return items.filter((i) => {
    const t = i.title.toLowerCase();
    if (seen.has(i.url)) return false;
    seen.add(i.url);
    if (include && !include.some((k) => t.includes(k))) return false;
    return !exclude.some((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t));
  }).slice(0, 150);
}

// ---------- turning a notice into a post ----------
function guessType(title) {
  const t = title.toLowerCase();
  if (/answer key/.test(t)) return 'answer-key';
  if (/admit card|hall ticket|call letter/.test(t)) return 'admit-card';
  if (/result|merit list|selection list|marks|cut ?off|final list/.test(t)) return 'result';
  if (/syllabus|exam pattern|scheme of exam/.test(t)) return 'syllabus';
  if (/admission|counselling|counseling/.test(t)) return 'admission';
  return 'job';
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function findLastDate(title) {
  const m = title.match(/(?:last|closing|end)\s*date[^0-9a-z]{0,15}(?:is\s*)?(\d{1,2})(?:st|nd|rd|th)?[\s./-]+([a-z]{3,9}|\d{1,2})[\s.,/-]+(\d{4})/i);
  if (!m) return null;
  const day = Number(m[1]);
  const mon = /\d/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].slice(0, 3).toLowerCase()];
  const year = Number(m[3]);
  if (!mon || day < 1 || day > 31 || mon > 12) return null;
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildPost(source, item) {
  const vac = item.title.match(/(\d[\d,]*)\s*(?:posts|vacancies|vacancy)/i);
  const isPdf = /\.pdf($|\?)/i.test(item.url);
  let site = source.url;
  try { site = new URL(source.url).origin; } catch { /* keep */ }
  return {
    type: TYPES[source.default_type] ? source.default_type : guessType(item.title),
    title: item.title,
    organization: source.name,
    summary: source.auto_publish
      ? `New notice from ${source.name}. Open the official notice below for full details.`
      : `Auto-imported from ${source.name}. Check the official notice and fill in dates, eligibility and fees before publishing.`,
    category: source.default_category || null,
    state: source.default_state || null,
    vacancies: vac ? Number(vac[1].replace(/,/g, '')) || null : null,
    last_date: findLastDate(item.title),
    links: [{ label: isPdf ? 'Official Notice (PDF)' : 'Official Notice', url: item.url }, { label: 'Official Website', url: site }],
    status: source.auto_publish ? 'published' : 'draft',
    featured: false,
  };
}

// ---------- running a source ----------
async function fetchItems(source) {
  if (!(await robotsAllows(source.url))) {
    const err = new Error(`${new URL(source.url).host} asks bots not to visit this page (robots.txt), so it was skipped.`);
    err.blocked = true; throw err;
  }
  const { text, finalUrl, contentType } = await fetchText(source.url);
  const isFeed = source.kind === 'rss' || /xml|rss|atom/.test(contentType) && /<(rss|feed)[\s>]/i.test(text.slice(0, 2000));
  const raw = isFeed ? parseFeed(text, finalUrl) : parseHtml(text, finalUrl, source.selector);
  return { raw: raw.length, items: filterItems(raw, source) };
}

// Preview without saving anything (used by the "Test" button in admin).
async function preview(source) {
  const { raw, items } = await fetchItems(source);
  return { raw, items: items.map((i) => ({ ...i, type: TYPES[source.default_type] ? source.default_type : guessType(i.title) })) };
}

let onPublished = null; // set by app to trigger instant email alerts
function setOnPublished(fn) { onPublished = fn; }

async function checkSource(source) {
  try {
    const { items } = await fetchItems(source);
    const firstRun = !sources.hasItems(source.id);
    const fresh = items.filter((i) => !sources.seen(source.id, i.url));
    let created = 0;
    if (firstRun) {
      for (const i of fresh) sources.addItem(source.id, i.url, i.title, null, true);
    } else {
      for (const i of fresh.slice(0, MAX_NEW_PER_RUN)) {
        const postId = posts.create(buildPost(source, i));
        sources.addItem(source.id, i.url, i.title, postId, false);
        created++;
        if (source.auto_publish && onPublished) onPublished(postId);
      }
    }
    const message = firstRun
      ? `First check: found ${items.length} existing notices and remembered them. Only notices added from now on will be imported.`
      : created ? `${created} new notice(s) imported${source.auto_publish ? ' and published' : ' as drafts'}.${fresh.length > created ? ` ${fresh.length - created} more will be picked up next run.` : ''}` : 'No new notices.';
    sources.setResult(source.id, 'ok', message);
    sources.addRun({ source_id: source.id, status: 'ok', found: items.length, created, message });
    return { status: 'ok', found: items.length, created, message };
  } catch (e) {
    const status = e.blocked ? 'blocked' : 'error';
    const message = e.name === 'TimeoutError' ? 'The website took too long to respond.' : e.message;
    sources.setResult(source.id, status, message);
    sources.addRun({ source_id: source.id, status, message });
    return { status, found: 0, created: 0, message };
  }
}

let running = false;
async function runDue() {
  if (running) return;
  running = true;
  try { for (const s of sources.due()) await checkSource(s); } finally { running = false; }
}
function startScheduler() {
  if (process.env.SOURCE_CHECKS === 'false') return;
  setInterval(() => runDue().catch((e) => console.error('[sources]', e)), 5 * 60 * 1000).unref();
  setTimeout(() => runDue().catch((e) => console.error('[sources]', e)), 30 * 1000).unref();
}

module.exports = { USER_AGENT, checkSource, preview, runDue, startScheduler, setOnPublished,
  _test: { parseRobots, pathAllowed, parseHtml, parseFeed, filterItems, guessType, findLastDate, buildPost } };
