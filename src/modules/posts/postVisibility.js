const VISIBILITIES = ['public', 'unlisted', 'followers', 'mentioned'];

function normalizeVisibility(value) {
  const visibility = value === undefined || value === null ? 'public' : value;
  if (!VISIBILITIES.includes(visibility)) {
    throw { status: 400, message: 'مستوى رؤية المنشور غير صالح', code: 'INVALID_POST_VISIBILITY' };
  }
  return visibility;
}

function buildVisibilityClause(viewerParam, options = {}) {
  const viewer = '$' + viewerParam;
  const includeUnlisted = Boolean(options.includeUnlisted);
  const unlisted = includeUnlisted ? "\n    OR p.visibility = 'unlisted'" : '';
  const mentionCondition = "EXISTS (SELECT 1 FROM regexp_matches(p.content, '@([A-Za-z0-9_\\u0600-\\u06FF]+)', 'g') AS mention(match) WHERE lower(mention.match[1]) = (SELECT lower(u2.username) FROM users u2 WHERE u2.id = " + viewer + "))";
  return "AND (\n    p.user_id = " + viewer + "\n    OR p.visibility = 'public'" + unlisted + "\n    OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = " + viewer + " AND f.following_id = p.user_id))\n    OR (p.visibility = 'mentioned' AND (" + mentionCondition + "))\n  )";
}

module.exports = { VISIBILITIES, normalizeVisibility, buildVisibilityClause };