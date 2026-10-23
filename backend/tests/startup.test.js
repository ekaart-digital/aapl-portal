const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');

const server = path.join(__dirname, '..', 'src', 'server.js');

function runServer(env) {
  return spawnSync(process.execPath, [server], {
    env: { ...process.env, PORT: '0', ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
}

test('production refuses to start with a weak JWT secret', () => {
  for (const secret of ['', 'short', 'change_this_to_a_long_random_string_but_longer_than_32']) {
    const res = runServer({ NODE_ENV: 'production', JWT_SECRET: secret });
    assert.equal(res.status, 1, `secret "${secret}"`);
    assert.match(res.stderr, /JWT_SECRET/);
  }
});
