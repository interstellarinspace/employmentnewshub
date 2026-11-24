# EmploymentNewsHub – Job Alerts Website

A complete, ready-to-host job alerts portal: government and private jobs, results, admit cards, answer keys,
syllabus and admissions, with an admin panel to publish posts.

The name is set with one setting (`SITE_NAME`), so you can change it anytime without editing code.

## Features

**Public site**
- Home page with latest jobs, results, admit cards, answer keys, syllabus and admissions boxes
- "Closing soon" table, featured posts, and browse by category, state and qualification
- Listing pages with search, filters (category, state, qualification, open only) and pagination
- Detail pages with overview, important dates, fees, age limit, eligibility, selection process, how to apply and important links
- "New" and "X days left" badges, related posts, WhatsApp / Telegram / X share links
- Email job alerts: subscribers pick categories, states, qualifications and instant or daily emails
- Contact form, About, Privacy Policy and Disclaimer pages
- SEO: clean URLs (`/jobs/police-constable-recruitment-2026`), page titles and descriptions, canonical links,
  `sitemap.xml`, `robots.txt`, and Google JobPosting structured data on job pages
- Colourful design with gentle animated gradients (turned off automatically for users who prefer reduced motion), mobile friendly, dark mode, fast (server-rendered, no frontend framework)

**Admin panel** (`/admin`)
- Password login with rate limiting
- Create, edit, delete, draft or feature posts
- Simple formatting: lines like `General: ₹500` become a table, lines starting with `- ` become a bullet list
- Email alerts page: SMTP status, send a test email, send the daily digest now, recent sends
- Re-send any post to instant subscribers from its edit page
- View and export subscribers with their preferences (CSV), read contact messages

**Tech**: Node.js 22, Express, SQLite (built into Node, no separate database server), Nodemailer, Docker.

## Run it on your computer

Requires Node.js 22.5 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. The admin panel is at http://localhost:3000/admin (password `admin` in development).
On first start the site adds some `[Sample]` posts so it doesn't look empty. Delete them in the admin panel
before going live, or set `SEED_SAMPLE=false`.

Run the tests with `npm test`.

## Settings

Copy `.env.example` to `.env` and fill it in. The important ones:

| Setting | What it does |
|---|---|
| `SITE_NAME` | Your website's name, shown everywhere |
| `SITE_URL` | Your public address, e.g. `https://www.yourdomain.com` (used for the sitemap and share links) |
| `ADMIN_PASSWORD` | Admin login password (required in production) |
| `SESSION_SECRET` | Long random string for admin logins |
| `CONTACT_EMAIL` | Email shown on the contact and privacy pages |
| `SEED_SAMPLE` | `false` to start with an empty site |
| `TRUST_PROXY` | `true` when hosted behind Render, Railway, Nginx or Cloudflare |

## Email job alerts

How it works:
- Visitors subscribe from the footer (daily digest of everything) or from the **Email Alerts** page (`/alerts`), where they choose
  instant or daily emails and filter by update type, category, qualification and state.
- **Instant** subscribers get an email when you publish a matching post in the admin panel.
- **Daily** subscribers get one digest a day at `DIGEST_HOUR` (default 8 AM India time) with every matching post since the last digest.
- Every email has a "Change preferences" link and an "Unsubscribe" link, plus one-click unsubscribe headers that Gmail and Yahoo require.
- If someone enters an email that is already subscribed, their settings are not changed; they are emailed their private settings link instead.

Setup:
1. Create an account with an email sending service. **Brevo** has a free tier (300 emails/day). Amazon SES is the cheapest at volume.
   Gmail works for testing or very small lists (use an App Password), but it has low daily limits.
2. Verify your domain with the provider (they give you DNS records, usually SPF and DKIM) so emails don't land in spam.
3. Put the SMTP details in `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`) and restart.
4. Open **Admin → Email alerts**, check it says "Connected", and send yourself a test email.

Without SMTP settings the site still works; emails are written to the server log instead of being sent.

To change categories, states or qualifications, edit `server/taxonomy.js`. Colours are at the top of `public/css/styles.css`.

## Hosting

The site is one Node.js app plus one database file (`data/site.db`). **The database must live on a persistent disk**, or your posts will be lost when the server restarts.

### Option A: Render (easiest, no server to manage)
1. Put this folder in a GitHub repository.
2. On render.com, create a **Web Service** from the repo. Choose **Docker** as the runtime.
3. Add a **Disk** mounted at `/app/data` (1 GB is plenty). This keeps your posts.
4. Add the environment variables from `.env.example` (`NODE_ENV=production`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `SITE_URL`, `SITE_NAME`, `TRUST_PROXY=true`, and the `SMTP_...` settings).
   Use a paid instance (not the free one that sleeps), so the daily digest runs on time.
5. Deploy, then add your domain under **Settings → Custom Domains**.

Railway and Fly.io work the same way: deploy with the Dockerfile and attach a volume at `/app/data`.

### Option B: Your own VPS (DigitalOcean, Hostinger VPS, AWS Lightsail, etc.)
```bash
# on the server, with Docker installed
cp .env.example .env    # then edit .env
docker compose up -d --build
```
The site runs on port 3000 and stores data in a Docker volume. Put Nginx or Caddy in front for HTTPS. With Caddy, the whole config is:
```
yourdomain.com {
    reverse_proxy localhost:3000
}
```

### Option C: Without Docker (any host that runs Node 22)
```bash
npm ci --omit=dev
NODE_ENV=production ADMIN_PASSWORD=... SESSION_SECRET=... SITE_URL=https://yourdomain.com npm start
```
Use a process manager like `pm2` to keep it running.

Note: ordinary shared hosting that only supports PHP will not run this site. You need a host that supports Node.js or Docker.

### After going live
1. Log in at `https://yourdomain.com/admin`, delete the `[Sample]` posts and add real ones.
2. Submit `https://yourdomain.com/sitemap.xml` in Google Search Console.
3. Back up `data/site.db` regularly (copy the file).

## Project layout
```
server/
  index.js          start the server
  app.js            Express setup and security headers
  public-routes.js  public pages, search, sitemap, alerts signup, contact
  admin-routes.js   admin panel
  views.js          HTML templates
  db.js             SQLite tables and queries
  taxonomy.js       post types, categories, states, qualifications
  validate.js       form validation
  auth.js           admin login sessions
  mailer.js         email alerts: matching, instant alerts, daily digest, scheduler
  seed.js           sample posts
public/             CSS, JavaScript, favicon
test/               automated tests
```

## Content and legal notes
Write your own post text from official notifications and always link to the official source. Keep the Disclaimer page, and update the Privacy Policy if you add analytics or ads.
