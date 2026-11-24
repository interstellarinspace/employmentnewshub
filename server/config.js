const path = require('node:path');
const crypto = require('node:crypto');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const config = {
  port: Number(env.PORT) || 3000,
  isProd,
  siteName: env.SITE_NAME || 'EmploymentNewsHub',
  siteTagline: env.SITE_TAGLINE || 'Latest Govt & Private Job Alerts, Results and Admit Cards',
  siteUrl: (env.SITE_URL || `http://localhost:${Number(env.PORT) || 3000}`).replace(/\/+$/, ''),
  contactEmail: env.CONTACT_EMAIL || 'contact@example.com',
  dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'site.db'),
  adminPassword: env.ADMIN_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  trustProxy: env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1',
  seedSample: env.SEED_SAMPLE !== 'false',

  // Email alerts (SMTP). Leave SMTP_HOST empty to log emails to the console instead of sending.
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true' || Number(env.SMTP_PORT) === 465,
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },
  mailFrom: env.MAIL_FROM || `"${env.SITE_NAME || 'EmploymentNewsHub'}" <alerts@example.com>`,
  instantAlerts: env.INSTANT_ALERTS !== 'false',     // email instant subscribers when a post is published
  digestHour: Number.isFinite(Number(env.DIGEST_HOUR)) && env.DIGEST_HOUR !== '' ? Number(env.DIGEST_HOUR) : 8, // 0-23, local time of TIMEZONE
  timezone: env.TIMEZONE || 'Asia/Kolkata',
};
// HTTPS-only features (secure cookies, HSTS) switch on when the public URL is https.
config.https = config.isProd && config.siteUrl.startsWith('https://');

if (!config.adminPassword) {
  if (isProd) {
    console.error('ADMIN_PASSWORD must be set in production.');
    process.exit(1);
  }
  config.adminPassword = 'admin';
  console.warn('[warn] ADMIN_PASSWORD not set; using "admin" for development.');
}
if (!env.SESSION_SECRET && isProd) {
  console.warn('[warn] SESSION_SECRET not set; admin sessions will reset on every restart.');
}

module.exports = config;
