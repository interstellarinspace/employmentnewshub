const { TYPES, CATEGORIES, QUALIFICATIONS, STATES } = require('./taxonomy');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function validateEmail(v) {
  const email = str(v, 200).toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

function validateContact(body = {}) {
  const data = { name: str(body.name, 100), email: str(body.email, 200).toLowerCase(), message: str(body.message, 5000) };
  const errors = {};
  if (data.name.length < 2) errors.name = 'Please enter your name.';
  if (!EMAIL_RE.test(data.email)) errors.email = 'Please enter a valid email address.';
  if (data.message.length < 10) errors.message = 'Message should be at least 10 characters.';
  const isSpam = typeof body.website === 'string' && body.website.trim() !== '';
  return { data, errors, isSpam };
}

// "Label | https://url" per line -> [{label, url}]
function parseLinks(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30).map((line) => {
    const i = line.lastIndexOf('|');
    const label = (i > -1 ? line.slice(0, i) : 'Link').trim().slice(0, 120);
    const url = (i > -1 ? line.slice(i + 1) : line).trim().slice(0, 1000);
    return { label, url };
  }).filter((l) => /^https?:\/\//i.test(l.url));
}

const linksToText = (links = []) => links.map((l) => `${l.label} | ${l.url}`).join('\n');

function validatePost(body = {}) {
  const quals = [].concat(body.qualification || []).map((q) => str(q, 40)).filter((q) => QUALIFICATIONS.includes(q));
  const date = (v) => { const s = str(v, 10); return DATE_RE.test(s) ? s : null; };
  const vac = parseInt(body.vacancies, 10);
  const data = {
    type: TYPES[body.type] ? body.type : 'job',
    title: str(body.title, 250),
    slug: str(body.slug, 120),
    organization: str(body.organization, 200),
    summary: str(body.summary, 600),
    category: CATEGORIES.includes(body.category) ? body.category : null,
    state: STATES.includes(body.state) ? body.state : null,
    qualification: quals.length ? quals.join(',') : null,
    vacancies: Number.isFinite(vac) && vac > 0 ? vac : null,
    salary: str(body.salary, 300),
    age_limit: str(body.age_limit, 2000),
    fees: str(body.fees, 3000),
    eligibility: str(body.eligibility, 6000),
    selection: str(body.selection, 3000),
    how_to_apply: str(body.how_to_apply, 6000),
    content: str(body.content, 20000),
    start_date: date(body.start_date),
    last_date: date(body.last_date),
    exam_date: date(body.exam_date),
    links: parseLinks(body.links),
    status: body.status === 'draft' ? 'draft' : 'published',
    featured: body.featured === 'on' || body.featured === '1' || body.featured === true,
  };
  const errors = {};
  if (data.title.length < 5) errors.title = 'Title must be at least 5 characters.';
  return { data, errors };
}

module.exports = { validateEmail, validateContact, validatePost, parseLinks, linksToText };
