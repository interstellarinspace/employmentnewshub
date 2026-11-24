const config = require('./config');
const { TYPES, CATEGORIES, QUALIFICATIONS, STATES, slugify } = require('./taxonomy');

// ---------- helpers ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => (v == null ? '' : String(v).replace(/[&<>"']/g, (c) => ESC[c]));
// Tagged template: interpolated values are escaped unless wrapped with raw().
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else out += v instanceof Raw ? v.s : esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day} ${MONTHS[Number(m) - 1]} ${y}`;
}
const todayStr = () => new Date().toISOString().slice(0, 10);
function daysLeft(d) {
  if (!d) return null;
  return Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(todayStr() + 'T00:00:00Z')) / 86400000);
}
const postUrl = (p) => `/${TYPES[p.type]?.path || 'jobs'}/${p.slug}`;
const isNew = (p) => Date.now() - Date.parse(String(p.created_at).replace(' ', 'T') + 'Z') < 3 * 86400000;

// Plain text -> safe HTML. Lines starting with "- " become bullet lists,
// "Key: value" lines inside a block become a two-column table.
function rich(text) {
  if (!text) return raw('');
  const blocks = String(text).replace(/\r/g, '').split(/\n{2,}/);
  return raw(blocks.map((b) => {
    const lines = b.split('\n').filter((l) => l.trim());
    if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    if (lines.length > 1 && lines.every((l) => /^[^:]{1,60}:\s*\S/.test(l))) {
      return `<table class="kv">${lines.map((l) => { const i = l.indexOf(':'); return `<tr><th>${esc(l.slice(0, i))}</th><td>${esc(l.slice(i + 1).trim())}</td></tr>`; }).join('')}</table>`;
    }
    return `<p>${lines.map(esc).join('<br>')}</p>`;
  }).join('\n'));
}

// ---------- layout ----------
function layout({ title, description, canonical, body, jsonLd, noindex }) {
  const fullTitle = title ? `${title} | ${config.siteName}` : `${config.siteName} - ${config.siteTagline}`;
  const desc = description || config.siteTagline;
  const nav = Object.values(TYPES).map((t) => html`<li><a href="/${t.path}">${t.label}</a></li>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
${canonical ? `<link rel="canonical" href="${esc(config.siteUrl + canonical)}">` : ''}
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(config.siteName)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta name="theme-color" content="#7c3aed">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/styles.css">
<script src="/js/main.js" defer></script>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container topbar">
    <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">${esc(config.siteName[0] || "")}</span><span>${esc(config.siteName)}</span></a>
    <form class="search" action="/search" method="get" role="search">
      <input type="search" name="q" placeholder="Search jobs, results, admit cards…" aria-label="Search" maxlength="100">
      <button type="submit" aria-label="Search">Search</button>
    </form>
    <button class="menu-toggle" aria-label="Toggle menu" aria-expanded="false">☰</button>
  </div>
  <nav class="mainnav" aria-label="Main">
    <ul class="container nav-links"><li><a href="/">Home</a></li>${nav.join('')}<li class="nav-cta-li"><a class="nav-cta" href="/alerts">🔔 Email Alerts</a></li></ul>
  </nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="container footer-grid">
    <div>
      <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">${esc(config.siteName[0] || "")}</span><span>${esc(config.siteName)}</span></a>
      <p>${esc(config.siteTagline)}. Always confirm details on the official website before applying.</p>
    </div>
    <div><h4>Updates</h4><ul>${Object.values(TYPES).map((t) => `<li><a href="/${t.path}">${esc(t.label)}</a></li>`).join('')}</ul></div>
    <div><h4>Site</h4><ul><li><a href="/about">About Us</a></li><li><a href="/contact">Contact</a></li><li><a href="/privacy">Privacy Policy</a></li><li><a href="/disclaimer">Disclaimer</a></li></ul></div>
    <div>
      <h4>Get job alerts by email</h4>
      <form id="subscribe-form" class="inline-form" action="/subscribe" method="post">
        <input type="email" name="email" placeholder="you@example.com" required aria-label="Email address">
        <button class="btn btn-primary btn-sm" type="submit">Subscribe</button>
      </form>
      <p id="subscribe-msg" role="status"></p>
      <p><a href="/alerts">Choose categories, states &amp; instant or daily alerts →</a></p>
    </div>
  </div>
  <div class="container footer-bottom">© ${new Date().getFullYear()} ${esc(config.siteName)}. All rights reserved.</div>
</footer>
</body>
</html>`;
}

// ---------- components ----------
function badges(p) {
  const out = [];
  if (isNew(p)) out.push('<span class="tag tag-new">New</span>');
  const dl = daysLeft(p.last_date);
  if (p.type === 'job' && dl != null) {
    if (dl < 0) out.push('<span class="tag tag-closed">Closed</span>');
    else if (dl <= 5) out.push(`<span class="tag tag-soon">${dl === 0 ? 'Last day' : `${dl} day${dl > 1 ? 's' : ''} left`}</span>`);
  }
  return raw(out.join(' '));
}

function updateBox(typeKey, rows) {
  const t = TYPES[typeKey];
  return html`<section class="box">
    <h2 class="box-title"><a href="/${t.path}">${t.label}</a></h2>
    <ul class="update-list">
      ${rows.length ? rows.map((p) => html`<li><a href="${postUrl(p)}">${p.title}</a> ${badges(p)}${p.last_date && p.type === 'job' ? html`<small>Last date: ${fmtDate(p.last_date)}</small>` : ''}</li>`) : raw('<li class="muted">No updates yet.</li>')}
    </ul>
    <a class="box-more" href="/${t.path}">View all ${t.label.toLowerCase()} →</a>
  </section>`;
}

function postCard(p) {
  const t = TYPES[p.type];
  return html`<article class="post-card">
    <div class="post-card-head"><span class="pill">${t?.singular || p.type}</span> ${badges(p)}</div>
    <h3><a href="${postUrl(p)}">${p.title}</a></h3>
    ${p.organization ? html`<p class="org">${p.organization}</p>` : ''}
    <dl class="facts">
      ${p.vacancies ? html`<div><dt>Posts</dt><dd>${p.vacancies.toLocaleString('en-IN')}</dd></div>` : ''}
      ${p.qualification ? html`<div><dt>Qualification</dt><dd>${p.qualification.split(',').join(', ')}</dd></div>` : ''}
      ${p.state ? html`<div><dt>Location</dt><dd>${p.state}</dd></div>` : ''}
      ${p.last_date ? html`<div><dt>Last date</dt><dd>${fmtDate(p.last_date)}</dd></div>` : ''}
      ${!p.last_date && p.exam_date ? html`<div><dt>Exam date</dt><dd>${fmtDate(p.exam_date)}</dd></div>` : ''}
    </dl>
  </article>`;
}

function options(list, selected, placeholder) {
  return raw(`<option value="">${esc(placeholder)}</option>` + list.map((x) => `<option value="${esc(x)}"${x === selected ? ' selected' : ''}>${esc(x)}</option>`).join(''));
}

function pagination(total, page, perPage, baseQuery) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return '';
  const link = (n, label = n) => {
    const qs = new URLSearchParams({ ...baseQuery, page: n }).toString();
    return n === page ? `<span class="current">${label}</span>` : `<a href="?${esc(qs)}">${label}</a>`;
  };
  const items = [];
  if (page > 1) items.push(link(page - 1, '‹ Prev'));
  for (let n = Math.max(1, page - 2); n <= Math.min(pages, page + 2); n++) items.push(link(n));
  if (page < pages) items.push(link(page + 1, 'Next ›'));
  return raw(`<nav class="pagination" aria-label="Pagination">${items.join('')}</nav>`);
}

function breadcrumbs(items) {
  return html`<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${items.map(([label, href]) => html` › ${href ? html`<a href="${href}">${label}</a>` : html`<span>${label}</span>`}`)}</nav>`;
}

// ---------- pages ----------
function homePage({ boxes, closing, featured, catCounts, stateCounts }) {
  const body = html`
  <section class="hero">
    <div class="container">
      <h1>${config.siteTagline}</h1>
      <p class="lead">Fresh notifications every day for central and state government, bank, railway, defence, teaching and private sector jobs.</p>
      <form class="hero-search" action="/search" method="get" role="search">
        <input type="search" name="q" placeholder="e.g. clerk, railway, 10th pass, Karnataka" aria-label="Search" maxlength="100">
        <button class="btn btn-primary" type="submit">Search</button>
      </form>
      <div class="chips">${CATEGORIES.slice(0, 8).map((c) => html`<a class="chip" href="/category/${slugify(c)}">${c}</a>`)}</div>
    </div>
  </section>

  ${featured.length ? html`<section class="container featured"><h2 class="section-title">Featured</h2><div class="featured-grid">${featured.map((p) => html`<a class="featured-item" href="${postUrl(p)}"><span class="pill">${TYPES[p.type].singular}</span><b>${p.title}</b>${p.last_date ? html`<small>Last date ${fmtDate(p.last_date)}</small>` : ''}</a>`)}</div></section>` : ''}

  <div class="container boxes">
    ${Object.keys(TYPES).map((k) => updateBox(k, boxes[k] || []))}
  </div>

  <div class="container two-col">
    <section class="box">
      <h2 class="box-title">Closing soon</h2>
      ${closing.length ? html`<table class="table"><thead><tr><th>Recruitment</th><th>Last date</th></tr></thead><tbody>
        ${closing.map((p) => html`<tr><td><a href="${postUrl(p)}">${p.title}</a></td><td class="nowrap">${fmtDate(p.last_date)} ${badges(p)}</td></tr>`)}
      </tbody></table>` : raw('<p class="muted">Nothing closing in the next few weeks.</p>')}
    </section>
    <section class="box">
      <h2 class="box-title">Jobs by qualification</h2>
      <div class="chips">${QUALIFICATIONS.filter((q) => q !== 'Any').map((q) => html`<a class="chip" href="/qualification/${slugify(q)}">${q}</a>`)}</div>
      <h2 class="box-title" style="margin-top:20px">Jobs by category</h2>
      <div class="chips">${CATEGORIES.map((c) => html`<a class="chip" href="/category/${slugify(c)}">${c}${catCounts[c] ? html` <small>(${catCounts[c]})</small>` : ''}</a>`)}</div>
    </section>
  </div>

  <section class="container box">
    <h2 class="box-title">Jobs by state</h2>
    <div class="state-grid">${STATES.map((s) => html`<a href="/state/${slugify(s)}">${s}${stateCounts[s] ? html` <small>(${stateCounts[s]})</small>` : ''}</a>`)}</div>
  </section>`;

  return layout({
    body, canonical: '/',
    jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: config.siteName, url: config.siteUrl,
      potentialAction: { '@type': 'SearchAction', target: `${config.siteUrl}/search?q={q}`, 'query-input': 'required name=q' } },
  });
}

function listPage({ heading, intro, crumbs, canonical, rows, total, page, perPage, filters, showType, basePath }) {
  const q = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const body = html`
  <div class="container page">
    ${breadcrumbs(crumbs)}
    <h1>${heading}</h1>
    ${intro ? html`<p class="lead">${intro}</p>` : ''}
    <form class="filters" method="get" action="${basePath}">
      <input type="search" name="q" value="${filters.q || ''}" placeholder="Keyword" aria-label="Keyword" maxlength="100">
      ${showType ? html`<select name="type" aria-label="Type">${raw(`<option value="">All types</option>` + Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${filters.type === k ? ' selected' : ''}>${esc(t.label)}</option>`).join(''))}</select>` : ''}
      <select name="category" aria-label="Category">${options(CATEGORIES, filters.category, 'All categories')}</select>
      <select name="state" aria-label="State">${options(STATES, filters.state, 'All states')}</select>
      <select name="qualification" aria-label="Qualification">${options(QUALIFICATIONS, filters.qualification, 'Any qualification')}</select>
      <select name="sort" aria-label="Sort"><option value="new"${filters.sort !== 'last_date' ? ' selected' : ''}>Newest first</option><option value="last_date"${filters.sort === 'last_date' ? ' selected' : ''}>Last date (soonest)</option></select>
      <label class="check"><input type="checkbox" name="active" value="1"${filters.active ? ' checked' : ''}> Open only</label>
      <button class="btn btn-primary btn-sm" type="submit">Apply</button>
      ${Object.keys(q).length ? html`<a class="btn btn-outline btn-sm" href="${basePath}">Clear</a>` : ''}
    </form>
    <p class="muted">${total.toLocaleString('en-IN')} result${total === 1 ? '' : 's'}</p>
    <div class="post-grid">${rows.length ? rows.map(postCard) : raw('<p class="empty">No posts match these filters. Try removing a filter.</p>')}</div>
    ${pagination(total, page, perPage, q)}
  </div>`;
  return layout({ title: heading, description: intro, canonical: page > 1 ? `${canonical}?page=${page}` : canonical, body, noindex: Object.keys(q).some((k) => k !== 'page') });
}

function section(title, content) {
  return content && String(content).trim() ? html`<section class="detail-section"><h2>${title}</h2>${content}</section>` : '';
}

function detailPage(p, related) {
  const t = TYPES[p.type];
  const dl = daysLeft(p.last_date);
  const dates = [['Application start', p.start_date], ['Last date', p.last_date], ['Exam date', p.exam_date]].filter(([, d]) => d);
  const body = html`
  <div class="container page detail">
    ${breadcrumbs([[t.label, `/${t.path}`], [p.title]])}
    <article>
      <header class="detail-head">
        <div><span class="pill">${t.singular}</span> ${badges(p)}</div>
        <h1>${p.title}</h1>
        ${p.organization ? html`<p class="org">${p.organization}</p>` : ''}
        <p class="muted">Posted ${fmtDate(p.created_at)}${p.updated_at !== p.created_at ? html` · Updated ${fmtDate(p.updated_at)}` : ''}</p>
        ${p.type === 'job' && dl != null && dl >= 0 ? html`<p class="deadline">Apply before <b>${fmtDate(p.last_date)}</b> (${dl === 0 ? 'today is the last day' : `${dl} day${dl > 1 ? 's' : ''} left`})</p>` : ''}
      </header>
      ${p.summary ? html`<p class="summary">${p.summary}</p>` : ''}

      <table class="kv overview">
        ${p.organization ? html`<tr><th>Organisation</th><td>${p.organization}</td></tr>` : ''}
        ${p.vacancies ? html`<tr><th>Total posts</th><td>${p.vacancies.toLocaleString('en-IN')}</td></tr>` : ''}
        ${p.qualification ? html`<tr><th>Qualification</th><td>${p.qualification.split(',').map((qq, i) => html`${i ? ', ' : ''}<a href="/qualification/${slugify(qq)}">${qq}</a>`)}</td></tr>` : ''}
        ${p.category ? html`<tr><th>Category</th><td><a href="/category/${slugify(p.category)}">${p.category}</a></td></tr>` : ''}
        ${p.state ? html`<tr><th>Location</th><td><a href="/state/${slugify(p.state)}">${p.state}</a></td></tr>` : ''}
        ${p.salary ? html`<tr><th>Salary / Pay scale</th><td>${p.salary}</td></tr>` : ''}
      </table>

      ${dates.length ? section('Important dates', html`<table class="kv">${dates.map(([l, d]) => html`<tr><th>${l}</th><td>${fmtDate(d)}</td></tr>`)}</table>`) : ''}
      ${section('Application fee', rich(p.fees))}
      ${section('Age limit', rich(p.age_limit))}
      ${section('Eligibility', rich(p.eligibility))}
      ${section('Selection process', rich(p.selection))}
      ${section('How to apply', rich(p.how_to_apply))}
      ${section('Details', rich(p.content))}

      ${p.links.length ? html`<section class="detail-section"><h2>Important links</h2><table class="table links">${p.links.map((l) => html`<tr><td>${l.label}</td><td class="nowrap"><a class="btn btn-primary btn-sm" href="${l.url}" target="_blank" rel="noopener nofollow">Open ↗</a></td></tr>`)}</table></section>` : ''}

      <p class="notice">Information on this page is collected from official notifications. Always verify dates, eligibility and fees on the official website before applying. ${config.siteName} is not affiliated with any recruiting organisation.</p>

      <div class="share">Share:
        <a href="https://wa.me/?text=${encodeURIComponent(p.title + ' ' + config.siteUrl + postUrl(p))}" target="_blank" rel="noopener">WhatsApp</a>
        <a href="https://t.me/share/url?url=${encodeURIComponent(config.siteUrl + postUrl(p))}&text=${encodeURIComponent(p.title)}" target="_blank" rel="noopener">Telegram</a>
        <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(config.siteUrl + postUrl(p))}&text=${encodeURIComponent(p.title)}" target="_blank" rel="noopener">X</a>
      </div>
    </article>
    ${related.length ? html`<section class="box"><h2 class="box-title">Related updates</h2><ul class="update-list">${related.map((r) => html`<li><a href="${postUrl(r)}">${r.title}</a> ${badges(r)}</li>`)}</ul></section>` : ''}
  </div>`;

  const jsonLd = p.type === 'job' ? {
    '@context': 'https://schema.org', '@type': 'JobPosting', title: p.title,
    description: [p.summary, p.eligibility, p.how_to_apply].filter(Boolean).join('\n\n') || p.title,
    datePosted: String(p.created_at).slice(0, 10), ...(p.last_date ? { validThrough: `${p.last_date}T23:59:59` } : {}),
    hiringOrganization: { '@type': 'Organization', name: p.organization || config.siteName },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressRegion: p.state && p.state !== 'All India' ? p.state : undefined, addressCountry: 'IN' } },
    ...(p.vacancies ? { totalJobOpenings: p.vacancies } : {}),
    ...(p.qualification ? { educationRequirements: p.qualification.split(',').join(', ') } : {}),
  } : { '@context': 'https://schema.org', '@type': 'Article', headline: p.title, datePublished: String(p.created_at).slice(0, 10), dateModified: String(p.updated_at).slice(0, 10) };

  return layout({ title: p.title, description: p.summary || `${p.title} - ${t.singular} details, dates, eligibility and links.`, canonical: postUrl(p), body, jsonLd });
}

function staticPage(title, content, canonical) {
  return layout({ title, canonical, body: html`<div class="container page prose">${breadcrumbs([[title]])}<h1>${title}</h1>${content}</div>` });
}

function contactPage({ errors = {}, values = {}, sent } = {}) {
  const err = (f) => (errors[f] ? html`<div class="field-error">${errors[f]}</div>` : '');
  return staticPage('Contact Us', html`
    <p>Found a mistake in a post, or want to suggest an update? Send us a message. You can also email <a href="mailto:${config.contactEmail}">${config.contactEmail}</a>.</p>
    ${sent ? raw('<div class="alert alert-success show">Thanks! Your message has been sent.</div>') : ''}
    ${Object.keys(errors).length ? raw('<div class="alert alert-error show">Please fix the highlighted fields.</div>') : ''}
    <form class="form card" method="post" action="/contact" style="max-width:640px">
      <div><label for="name">Name</label><input id="name" name="name" value="${values.name || ''}" required maxlength="100">${err('name')}</div>
      <div><label for="email">Email</label><input id="email" name="email" type="email" value="${values.email || ''}" required maxlength="200">${err('email')}</div>
      <div><label for="message">Message</label><textarea id="message" name="message" required maxlength="5000">${values.message || ''}</textarea>${err('message')}</div>
      <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
      <button class="btn btn-primary" type="submit">Send message</button>
    </form>`, '/contact');
}

const listOf = (s) => String(s || '').split(',').filter(Boolean);
function checkGroup(name, items, selected, labelFn = (x) => x) {
  const sel = new Set(selected);
  return raw(`<div class="check-grid">${items.map((v) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(v)}"${sel.has(v) ? ' checked' : ''}> ${esc(labelFn(v))}</label>`).join('')}</div>`);
}

// Sign-up (mode 'new') or preference editing (mode 'manage') form for email alerts.
function alertsPage({ mode = 'new', sub = {}, message, error } = {}) {
  const isManage = mode === 'manage';
  const freq = sub.frequency || 'daily';
  const body = html`
    <p class="lead">${isManage ? 'Update what you receive. Leave a group empty to get everything in it.' : 'Get new job notifications in your inbox. Pick what you care about, or leave a group empty to get everything.'}</p>
    ${message ? html`<div class="alert alert-success show">${message}</div>` : ''}
    ${error ? html`<div class="alert alert-error show">${error}</div>` : ''}
    ${sub.active === 0 && isManage ? raw('<div class="alert alert-error show">You are currently unsubscribed. Save your preferences to subscribe again.</div>') : ''}
    <form class="form card alerts-form" method="post" action="${isManage ? '/alerts/manage' : '/alerts'}">
      ${isManage ? html`<input type="hidden" name="token" value="${sub.token}"><p><b>Email:</b> ${sub.email}</p>`
        : html`<div><label for="a-email">Your email</label><input id="a-email" name="email" type="email" required maxlength="200" placeholder="you@example.com" value="${sub.email || ''}"></div>`}
      <fieldset><legend>How often?</legend>
        <label class="check"><input type="radio" name="frequency" value="instant"${freq === 'instant' ? raw(' checked') : ''}> Instantly, as soon as a matching post is published</label>
        <label class="check"><input type="radio" name="frequency" value="daily"${freq !== 'instant' ? raw(' checked') : ''}> Once a day (daily digest)</label>
      </fieldset>
      <fieldset><legend>Updates</legend>${checkGroup('types', Object.keys(TYPES), listOf(sub.types), (k) => TYPES[k].label)}</fieldset>
      <fieldset><legend>Job categories</legend>${checkGroup('categories', CATEGORIES, listOf(sub.categories))}</fieldset>
      <fieldset><legend>Qualification</legend>${checkGroup('qualifications', QUALIFICATIONS.filter((q) => q !== 'Any'), listOf(sub.qualifications))}</fieldset>
      <fieldset><legend>States</legend>${checkGroup('states', STATES.filter((x) => x !== 'All India'), listOf(sub.states))}<small class="muted">All-India posts are always included.</small></fieldset>
      <div class="hp" aria-hidden="true"><label for="a-website">Website</label><input id="a-website" name="website" tabindex="-1" autocomplete="off"></div>
      <div class="form-actions"><button class="btn btn-primary" type="submit">${isManage ? 'Save preferences' : 'Subscribe to alerts'}</button>
      ${isManage ? html`<a class="btn btn-outline" href="/alerts/unsubscribe?token=${sub.token}">Unsubscribe</a>` : ''}</div>
    </form>`;
  return layout({ title: isManage ? 'Manage email alerts' : 'Free job alerts by email', canonical: isManage ? null : '/alerts', noindex: isManage,
    body: html`<div class="container page">${breadcrumbs([['Email alerts']])}<h1>${isManage ? 'Manage your email alerts' : 'Free job alerts by email'}</h1>${body}</div>` });
}

function unsubscribePage(sub, done) {
  return layout({ title: 'Unsubscribe', noindex: true, body: html`<div class="container page prose">
    <h1>${done ? 'You have been unsubscribed' : 'Unsubscribe from job alerts?'}</h1>
    ${!sub ? raw('<p>This link is invalid or has expired.</p>') : done
      ? html`<p>${sub.email} will no longer receive emails from us. Changed your mind? <a href="/alerts/manage?token=${sub.token}">Subscribe again</a>.</p>`
      : html`<p>Stop sending job alerts to <b>${sub.email}</b>?</p>
        <form method="post" action="/alerts/unsubscribe?token=${sub.token}"><button class="btn btn-primary" type="submit">Yes, unsubscribe</button>
        <a class="btn btn-outline" href="/alerts/manage?token=${sub.token}">Change preferences instead</a></form>`}
  </div>` });
}

function notFoundPage() {
  return layout({ title: 'Page not found', noindex: true, body: html`<div class="container page" style="text-align:center;padding:80px 0"><h1>Page not found</h1><p class="lead">The page you're looking for doesn't exist or has been removed.</p><p><a class="btn btn-primary" href="/">Go to home</a></p></div>` });
}

module.exports = { alertsPage, unsubscribePage, esc, html, raw, layout, fmtDate, postUrl, homePage, listPage, detailPage, staticPage, contactPage, notFoundPage, options, breadcrumbs };
