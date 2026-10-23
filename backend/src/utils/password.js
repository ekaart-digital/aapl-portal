const { ApiError } = require('./ApiError');

const MIN_LENGTH = 8;
// bcrypt only uses the first 72 bytes; refuse longer passwords rather than
// silently ignoring the rest.
const MAX_BYTES = 72;

// SRS §39: a password policy. At least 8 characters with a letter and a digit.
function assertStrongPassword(password, label = 'password') {
  const value = typeof password === 'string' ? password : '';
  if (value.length < MIN_LENGTH) throw ApiError.badRequest(`${label} must be at least ${MIN_LENGTH} characters.`);
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) throw ApiError.badRequest(`${label} must be at most ${MAX_BYTES} bytes.`);
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw ApiError.badRequest(`${label} must contain at least one letter and one number.`);
  }
}

module.exports = { assertStrongPassword, MIN_LENGTH };
