const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeVisibility, buildVisibilityClause } = require('../modules/posts/postVisibility');

test('visibility defaults to public', () => {
  assert.equal(normalizeVisibility(undefined), 'public');
});

test('unsupported visibility is rejected', () => {
  assert.throws(
    () => normalizeVisibility('friends'),
    (err) => err.code === 'INVALID_POST_VISIBILITY'
  );
});

test('followers visibility SQL requires follower relation', () => {
  const sql = buildVisibilityClause(2);
  assert.match(sql, /p\.visibility = 'followers'/);
  assert.match(sql, /f\.follower_id = \$2/);
});

test('unlisted can be included for direct/profile reads', () => {
  assert.match(buildVisibilityClause(2, { includeUnlisted: true }), /p\.visibility = 'unlisted'/);
});
