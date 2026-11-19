// Sends one email through the configured mail settings, to check them.
//
// Usage: node scripts/send-test-email.js someone@example.com

require('dotenv').config();
const email = require('../src/services/email');

(async () => {
  const to = process.argv[2];
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Give the address to send to.');
  await email.sendNow({
    to,
    subject: 'AAPL Platform: test email',
    text: 'This is a test message from the AAPL Platform. If you can read it, email sending is set up correctly.',
  });
  console.log(`Sent a test email to ${to}.`);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
