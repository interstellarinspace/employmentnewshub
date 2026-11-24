# Deploy EmploymentNewsHub on Render (step by step)

Cost: Render's **Starter** plan (about US$7/month) plus a 1 GB disk (about US$0.25/month).
The free plan can't be used, because it has no permanent disk, so every post would be erased on restart.

## 1. Create a Render account
Go to https://render.com, click **Get Started**, and sign up with **GitHub** (same account: interstellarinspace).
Add a payment card under **Billing**.

## 2. Create the service from the Blueprint
1. In the Render dashboard click **New +** → **Blueprint**.
2. Connect GitHub if asked, and allow access to the `employmentnewshub` repository.
3. Pick `interstellarinspace/employmentnewshub`. Render reads `render.yaml` and shows one web service named **employmentnewshub**.
4. Fill in the blank values it asks for:
   - `ADMIN_PASSWORD`: a long password you will use at /admin (save it somewhere safe)
   - `SITE_URL`: `https://employmentnewshub.onrender.com` (change it later if you add your own domain)
   - `CONTACT_EMAIL`: your email address
   - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`: leave empty for now if you have no email service yet
5. Click **Apply**. The first build takes 3–5 minutes. Wait until the status shows **Live**.

## 3. Check it works
- Open `https://employmentnewshub.onrender.com` (the exact link is at the top of the service page).
- Open `/admin`, log in with your `ADMIN_PASSWORD`.
- Delete the `[Sample]` posts and add your first real post.
- In Render → **Environment**, change `SEED_SAMPLE` to `false` so samples never come back.

## 4. Turn on email alerts (when ready)
1. Sign up at https://www.brevo.com (free: 300 emails/day).
2. In Brevo: **Senders, Domains & Dedicated IPs** → add and verify your sender email (or domain).
3. In Brevo: **SMTP & API** → copy the SMTP server, login and an SMTP key.
4. In Render → your service → **Environment**, set:
   - `SMTP_HOST` = `smtp-relay.brevo.com`
   - `SMTP_PORT` = `587`
   - `SMTP_USER` = your Brevo SMTP login
   - `SMTP_PASS` = your Brevo SMTP key
   - `MAIL_FROM` = `"EmploymentNewsHub" <the-email-you-verified>`
5. Save (Render restarts the site). Open `/admin/email`. It should say **Connected**. Send yourself a test email.

## 5. Use your own domain (optional)
1. Buy a domain (e.g. from GoDaddy, Hostinger, Namecheap).
2. Render → service → **Settings** → **Custom Domains** → **Add**, enter `www.yourdomain.com`.
3. Add the DNS record Render shows (a CNAME) at your domain provider. HTTPS is set up automatically.
4. Update `SITE_URL` in Render to `https://www.yourdomain.com`.
5. Submit `https://www.yourdomain.com/sitemap.xml` in Google Search Console.

## Updating the site later
Any change pushed to the `main` branch on GitHub is deployed by Render automatically.

## Backups
Render takes daily snapshots of the disk. You can also download `/app/data/site.db` from the Render **Shell** tab.
