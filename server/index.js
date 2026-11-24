const config = require('./config');
const { createApp } = require('./app');
const { db } = require('./db');

if (config.seedSample) require('./seed').seedIfEmpty();

require('./mailer').startScheduler();

const server = createApp().listen(config.port, () => {
  console.log(`${config.siteName} running on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
