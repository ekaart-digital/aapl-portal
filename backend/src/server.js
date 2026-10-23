require('dotenv').config();
const app = require('./app');
const { startSweepSchedule } = require('./services/timerSweep');
const settings = require('./services/settings');

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('change_this'))) {
  console.error('Refusing to start: set a strong JWT_SECRET (32+ characters) in production.');
  process.exit(1);
}

const PORT = process.env.PORT || 4000;

settings.load().then(() => {
  app.listen(PORT, () => {
    console.log(`AAPL Platform API listening on port ${PORT}`);
    startSweepSchedule();
  });
});
