const nodemailer = require('nodemailer');
const config = require('./config');
const { posts, subscribers, settings, emailLog } = require('./db');
const { TYPES } = require('./taxonomy');
const { esc, fmtDate, postUrl } = require('./views');

const smtpReady = !!config.smtp.host;
const transport = smtpReady
  ? nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    pool: true, maxConnections: 3, maxMessages: 200,
  })
  : nodemailer.createTransport({ jsonTransport: true });

// Test hook: lets tests capture outgoing mail.
let outbox = null;
function captureOutbox(arr) { outbox = arr; }

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// A subscriber matches a post when every preference they set includes the post's value.
// An empty preference means "anything". Posts without a value for a field match everyone.
function matches(sub, post) {
  const types = list(sub.types), cats = list(sub.categories), states = list(sub.states), quals = list(sub.qualifications);
  if (types.length && !types.includes(post.type)) return false;
  if (cats.length && post.category && !cats.includes(post.category)) return false;
  if (states.length && post.state && post.state !== 'All India' && !states.includes(post.state)) return false;
  if (quals.length && post.qualification && !list(post.qualification).some((q) => quals.includes(q) || q === 'Any')) return false;
  return true;
}

const links = (sub) => ({
  manage: `${config.siteUrl}/alerts/manage?token=${encodeURIComponent(sub.token)}`,
  unsubscribe: `${config.siteUrl}/alerts/unsubscribe?token=${encodeURIComponent(sub.token)}`,
});

function shell(title, inner, sub) {
  const l = sub ? links(sub) : null;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f3f0ff;font-family:Arial,Helvetica,sans-serif;color:#1f1b2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0ff;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#7c3aed;background-image:linear-gradient(120deg,#7c3aed,#ec4899,#f97316);padding:22px 24px;color:#ffffff">
<div style="font-size:22px;font-weight:800">${esc(config.siteName)}</div>
<div style="font-size:14px;opacity:.9">${esc(title)}</div></td></tr>
<tr><td style="padding:20px 24px">${inner}</td></tr>
<tr><td style="padding:16px 24px;background:#faf8ff;color:#6b6585;font-size:12px;line-height:1.6">
Always confirm details on the official website before applying.<br>
${l ? `You get this because you subscribed to ${esc(config.siteName)} job alerts. <a href="${esc(l.manage)}" style="color:#7c3aed">Change preferences</a> · <a href="${esc(l.unsubscribe)}" style="color:#7c3aed">Unsubscribe</a>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

function postBlock(p) {
  const t = TYPES[p.type];
  const facts = [
    p.organization, p.vacancies ? `${p.vacancies.toLocaleString('en-IN')} posts` : '',
    p.qualification ? list(p.qualification).join(', ') : '', p.state || '',
  ].filter(Boolean).map(esc).join(' · ');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ebe6fb;border-left:4px solid #ec4899;border-radius:10px;margin:0 0 12px">
<tr><td style="padding:12px 14px">
<div style="font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase">${esc(t?.singular || p.type)}</div>
<a href="${esc(config.siteUrl + postUrl(p))}" style="font-size:16px;font-weight:700;color:#1f1b2e;text-decoration:none">${esc(p.title)}</a>
${facts ? `<div style="font-size:13px;color:#6b6585;margin-top:4px">${facts}</div>` : ''}
${p.last_date ? `<div style="font-size:13px;color:#c2410c;font-weight:700;margin-top:4px">Last date: ${esc(fmtDate(p.last_date))}</div>` : ''}
<div style="margin-top:8px"><a href="${esc(config.siteUrl + postUrl(p))}" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">View details</a></div>
</td></tr></table>`;
}

function postText(p) {
  return `- ${p.title}${p.last_date ? ` (last date ${fmtDate(p.last_date)})` : ''}\n  ${config.siteUrl + postUrl(p)}`;
}

async function send(to, { subject, html, text }, sub) {
  const headers = {};
  if (sub) {
    const l = links(sub);
    headers['List-Unsubscribe'] = `<${l.unsubscribe}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  const msg = { from: config.mailFrom, to, subject, html, text, headers };
  if (outbox) { outbox.push(msg); return; }
  const info = await transport.sendMail(msg);
  if (!smtpReady) console.log(`[mail:not-sent, SMTP not configured] to=${to} subject="${subject}"`);
  return info;
}

async function sendPostsTo(sub, list_, kind) {
  const subject = list_.length === 1 ? `${kind === 'instant' ? 'New' : 'Today'}: ${list_[0].title}` : `${list_.length} new job updates for you – ${config.siteName}`;
  const intro = kind === 'instant' ? 'A new update matching your alert was just published:' : `Here are the new updates from the last day that match your alert (${list_.length}):`;
  await send(sub.email, {
    subject: subject.slice(0, 180),
    html: shell(kind === 'instant' ? 'New job alert' : 'Your daily job digest', `<p style="margin:0 0 14px">${esc(intro)}</p>${list_.map(postBlock).join('')}`, sub),
    text: `${intro}\n\n${list_.map(postText).join('\n\n')}\n\nChange preferences: ${links(sub).manage}\nUnsubscribe: ${links(sub).unsubscribe}`,
  }, sub);
  subscribers.markSent(sub.id);
}

async function deliver(kind, jobs, postId) {
  let sent = 0, failed = 0;
  for (const [sub, list_] of jobs) {
    try { await sendPostsTo(sub, list_, kind); sent++; } catch (e) { failed++; console.error(`[mail] ${sub.email}: ${e.message}`); }
  }
  emailLog.add({ kind, post_id: postId, recipients: sent, failed, note: smtpReady ? null : 'SMTP not configured (logged only)' });
  return { sent, failed };
}

// Email instant subscribers about one post. Skips if already alerted unless force=true.
async function sendInstantForPost(postId, { force = false } = {}) {
  const post = posts.get(postId);
  if (!post || post.status !== 'published') return { sent: 0, failed: 0, skipped: 'not published' };
  if (post.alerted_at && !force) return { sent: 0, failed: 0, skipped: 'already sent' };
  posts.markAlerted(postId);
  const jobs = subscribers.active('instant').filter((s) => matches(s, post)).map((s) => [s, [post]]);
  return deliver('instant', jobs, postId);
}

// Email daily subscribers every post published since the previous digest.
async function sendDailyDigest() {
  const since = settings.get('last_digest_at') || new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  settings.set('last_digest_at', now);
  const fresh = posts.publishedSince(since);
  if (!fresh.length) { emailLog.add({ kind: 'digest', note: 'No new posts' }); return { sent: 0, failed: 0, posts: 0 }; }
  const jobs = subscribers.active('daily').map((s) => [s, fresh.filter((p) => matches(s, p)).slice(0, 30)]).filter(([, l]) => l.length);
  return { ...(await deliver('digest', jobs)), posts: fresh.length };
}

async function sendWelcome(sub) {
  const l = links(sub);
  await send(sub.email, {
    subject: `You're subscribed to ${config.siteName} job alerts`,
    html: shell('Subscription confirmed', `<p>Thanks for subscribing! You'll get <b>${sub.frequency === 'instant' ? 'an email as soon as a matching job is posted' : 'one daily email with new matching jobs'}</b>.</p>
      <p><a href="${esc(l.manage)}" style="display:inline-block;background:#7c3aed;color:#fff;padding:9px 16px;border-radius:8px;font-weight:700;text-decoration:none">Choose categories, states &amp; qualifications</a></p>
      <p style="color:#6b6585;font-size:13px">Didn't sign up? Just click unsubscribe below.</p>`, sub),
    text: `Thanks for subscribing to ${config.siteName} job alerts.\nChange preferences: ${l.manage}\nUnsubscribe: ${l.unsubscribe}`,
  }, sub);
}

async function sendTest(to) {
  await send(to, { subject: `Test email from ${config.siteName}`, html: shell('Test email', '<p>Your email settings work. 🎉</p>'), text: 'Your email settings work.' });
}

async function verify() {
  if (!smtpReady) return { ok: false, message: 'SMTP is not configured. Add SMTP_HOST, SMTP_USER and SMTP_PASS to .env.' };
  try { await transport.verify(); return { ok: true, message: `Connected to ${config.smtp.host}` }; } catch (e) { return { ok: false, message: e.message }; }
}

// Run the daily digest once a day at DIGEST_HOUR in TIMEZONE.
function localParts() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
function startScheduler() {
  const tick = async () => {
    const { date, hour } = localParts();
    if (hour === config.digestHour && settings.get('last_digest_date') !== date) {
      settings.set('last_digest_date', date);
      try { const r = await sendDailyDigest(); console.log(`[mail] daily digest: ${JSON.stringify(r)}`); } catch (e) { console.error('[mail] digest failed', e); }
    }
  };
  setInterval(tick, 5 * 60 * 1000).unref();
  tick();
}

module.exports = { smtpReady, matches, sendInstantForPost, sendDailyDigest, sendWelcome, sendTest, verify, startScheduler, captureOutbox };
