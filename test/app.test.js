const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.ADMIN_PASSWORD = 'secret-pass';

const { createApp } = require('../server/app');
require('../server/seed').seedIfEmpty();

let server, base, cookie;
before(async () => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const form = (obj) => new URLSearchParams(obj).toString();

test('public pages render', async () => {
  for (const p of ['/', '/jobs', '/results', '/admit-cards', '/answer-keys', '/search?q=police', '/category/bank-jobs', '/state/karnataka', '/qualification/graduate', '/about', '/contact', '/privacy', '/disclaimer']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
  }
  assert.equal((await fetch(base + '/does-not-exist')).status, 404);
});

test('sitemap lists posts', async () => {
  const xml = await (await fetch(base + '/sitemap.xml')).text();
  assert.match(xml, /<loc>[^<]+\/jobs\/sample-/);
});

test('subscribe validates email', async () => {
  const bad = await fetch(base + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"nope"}' });
  assert.equal(bad.status, 400);
  const ok = await fetch(base + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"a@example.com"}' });
  assert.equal(ok.status, 201);
});

test('admin requires login', async () => {
  const r = await fetch(base + '/admin', { redirect: 'manual' });
  assert.equal(r.status, 303);
  const bad = await fetch(base + '/admin/login', { method: 'POST', body: form({ password: 'x' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(bad.status, 401);
});

test('admin can create, view and delete a post', async () => {
  const login = await fetch(base + '/admin/login', { method: 'POST', redirect: 'manual', body: form({ password: 'secret-pass' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(login.status, 303);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const h = { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie };

  const created = await fetch(base + '/admin/posts', { method: 'POST', redirect: 'manual', headers: h,
    body: form({ type: 'job', title: 'Unit Test <b>Clerk</b> 2026', links: 'Apply | https://example.com\nEvil | javascript:alert(1)' }) });
  assert.equal(created.status, 303);

  const page = await fetch(base + '/jobs/unit-test-b-clerk-b-2026');
  assert.equal(page.status, 200);
  const htmlText = await page.text();
  assert.ok(htmlText.includes('Unit Test &lt;b&gt;Clerk'), 'title is escaped');
  assert.ok(!htmlText.includes('javascript:alert'), 'unsafe links dropped');

  const list = await (await fetch(base + '/admin?q=Unit+Test', { headers: { Cookie: cookie } })).text();
  const id = list.match(/\/admin\/posts\/(\d+)\/edit/)[1];
  const del = await fetch(`${base}/admin/posts/${id}/delete`, { method: 'POST', redirect: 'manual', headers: h });
  assert.equal(del.status, 303);
  assert.equal((await fetch(base + '/jobs/unit-test-b-clerk-b-2026')).status, 404);
});

test('cross-origin admin posts are blocked', async () => {
  const r = await fetch(base + '/admin/posts/1/delete', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('email alerts: signup, matching, instant send, manage and unsubscribe', async () => {
  const mailer = require('../server/mailer');
  const { subscribers } = require('../server/db');
  const outbox = [];
  mailer.captureOutbox(outbox);
  const h = { 'Content-Type': 'application/x-www-form-urlencoded' };

  // Instant subscriber who only wants Bank Jobs in Karnataka
  const r = await fetch(base + '/alerts', { method: 'POST', redirect: 'manual', headers: h,
    body: 'email=bank%40example.com&frequency=instant&categories=Bank+Jobs&states=Karnataka' });
  assert.equal(r.status, 303);
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(outbox.length, 1, 'welcome email');
  const sub = subscribers.byEmail('bank@example.com');
  assert.equal(sub.frequency, 'instant');

  // Re-submitting the public form must not change existing preferences
  await fetch(base + '/alerts', { method: 'POST', redirect: 'manual', headers: h, body: 'email=bank%40example.com&frequency=daily' });
  assert.equal(subscribers.byEmail('bank@example.com').frequency, 'instant');

  assert.equal(mailer.matches(sub, { type: 'job', category: 'Bank Jobs', state: 'Karnataka' }), true);
  assert.equal(mailer.matches(sub, { type: 'job', category: 'Bank Jobs', state: 'All India' }), true);
  assert.equal(mailer.matches(sub, { type: 'job', category: 'Railway Jobs', state: 'Karnataka' }), false);
  assert.equal(mailer.matches(sub, { type: 'job', category: 'Bank Jobs', state: 'Kerala' }), false);

  // Publishing a matching post from admin emails the instant subscriber
  outbox.length = 0;
  const ah = { ...h, Cookie: cookie };
  await fetch(base + '/admin/posts', { method: 'POST', redirect: 'manual', headers: ah,
    body: 'type=job&title=Karnataka+Bank+Clerk+Alert+Test&category=Bank+Jobs&state=Karnataka' });
  await new Promise((res) => setTimeout(res, 100));
  const alert = outbox.find((m) => m.to === 'bank@example.com');
  assert.ok(alert, 'instant alert sent');
  assert.match(alert.html, /Karnataka Bank Clerk Alert Test/);
  assert.match(alert.headers['List-Unsubscribe'], /alerts\/unsubscribe\?token=/);

  // Manage + unsubscribe with token
  assert.equal((await fetch(`${base}/alerts/manage?token=${sub.token}`)).status, 200);
  assert.equal((await fetch(`${base}/alerts/manage?token=bogus-token-123`)).status, 404);
  await fetch(`${base}/alerts/unsubscribe?token=${sub.token}`, { method: 'POST' });
  assert.equal(subscribers.byEmail('bank@example.com').active, 0);

  // Daily digest picks up posts for daily subscribers
  outbox.length = 0;
  await fetch(base + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"daily@example.com"}' });
  const digest = await mailer.sendDailyDigest();
  assert.ok(digest.posts >= 1);
  assert.ok(outbox.some((m) => m.to === 'daily@example.com' && /Karnataka Bank Clerk/.test(m.html)));
  mailer.captureOutbox(null);
});
