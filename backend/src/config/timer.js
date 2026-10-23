const settings = require('../services/settings');

// Longest a single Start/Stop session may be credited. Read on every call so
// the System Administrator can change it (or MAX_SESSION_HOURS) without a deployment.
function maxSessionMinutes() {
  return Math.round(settings.get('maxSessionHours') * 60);
}

module.exports = { maxSessionMinutes };
