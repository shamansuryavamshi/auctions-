const path = require('path');
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

(async () => {
  const config = loadConfig();
  const { app, hostToken, generated, initInfo, hub } = await createApp(config);

  app.listen(config.port, () => {
    console.log(`Sports Auction server listening on http://localhost:${config.port}`);
    console.log(`  Setup page:   http://localhost:${config.port}/index.html`);
    console.log(`  Live console: http://localhost:${config.port}/live.html`);
    console.log(`  Participant:  http://localhost:${config.port}/view.html`);
    console.log(`  Conclusion:   http://localhost:${config.port}/conclusion.html`);
    console.log(`  Data file:    ${path.join(config.dataDir, 'auction.json')}`);
    if (generated) {
      console.log('  Host token:   GENERATED (saved to data/host-token.txt and shown below)');
      console.log(`                ${hostToken}`);
      console.log('                Set HOST_TOKEN in .env for a stable token; never commit it.');
    } else {
      console.log('  Host token:   loaded from environment (not displayed)');
    }
    if (initInfo.created) console.log('  Initialized a new auction data file.');
    if (initInfo.recovered) console.log('  WARNING: recovered auction data from backup after a malformed main file.');
  });
})().catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
