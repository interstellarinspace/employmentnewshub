const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const publicRoutes = require('./public-routes');
const adminRoutes = require('./admin-routes');
const { notFoundPage } = require('./views');

function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.https ? [] : null,
      },
    },
    hsts: config.https,
    // Keep the Origin header on same-site form posts (needed by the admin CSRF check).
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use(express.json({ limit: '20kb' }));
  app.use(express.urlencoded({ extended: true, limit: '200kb' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '7d' : 0, index: false }));
  app.use('/admin', adminRoutes);
  app.use('/', publicRoutes);

  app.use((req, res) => res.status(404).send(notFoundPage()));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).send('Something went wrong. Please try again later.');
  });
  return app;
}

module.exports = { createApp };
