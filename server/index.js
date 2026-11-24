const config = require('./config');
const { createApp } = require('./app');
const { db } = require('./db');

if (config.seedSample) require('./seed').seedIfEmpty();

const mailer = require('./mailer');
const importer = require('./importer');
mailer.startScheduler();
// Auto-published imports trigger instant email alerts, same as publishing by hand.
importer.setOnPublished((id) => { if (config.instantAlerts) mailer.sendInstantForPost(id).catch((e) => console.error('[mail]', e.message)); });
importer.startScheduler();

const server = createApp().listen(config.port, () => {
  console.log(`${config.siteName} running on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
