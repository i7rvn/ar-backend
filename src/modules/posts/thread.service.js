const { query } = require('../../config/database');

async function getPostThread(postId, viewerId = null, limit = 200) {
  const root = await query('SELECT p.id, p.user_id, u.is_private FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND p.is_deleted = FALSE', [postId]);
  if (!root.rows.length) throw { status: 404, message: 'المنشور غير موجود', code: 'POST_NOT_FOUND' };
  if (root.rows[0].is_private && root.rows[0].user_id !== viewerId) {
    if (!viewerId) throw { status: 404, message: 'المنشور غير موجود', code: 'POST_NOT_FOUND' };
    const following = await query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [viewerId, root.rows[0].user_id]);
    if (!following.rows.length) throw { status: 404, message: 'المنشور غير موجود', code: 'POST_NOT_FOUND' };
  }

  const params = viewerId ? [postId, viewerId, Math.min(Math.max(Number(limit) || 200, 1), 200)] : [postId, Math.min(Math.max(Number(limit) || 200, 1), 200)];
  const visibility = viewerId
    ? "AND (t.is_private = FALSE OR t.user_id = $2 OR EXISTS (SELECT 1 FROM follows pf WHERE pf.follower_id = $2 AND pf.following_id = t.user_id)) AND (t.user_id = $2 OR t.visibility = 'public' OR t.visibility = 'unlisted' OR (t.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.following_id = t.user_id)) OR (t.visibility = 'mentioned' AND EXISTS (SELECT 1 FROM regexp_matches(t.content, '@([A-Za-z0-9_\\u0600-\\u06FF]+)', 'g') AS mention(match) WHERE lower(mention.match[1]) = (SELECT lower(u2.username) FROM users u2 WHERE u2.id = $2))))"
    : "AND t.visibility = 'public' AND t.is_private = FALSE";
  const limitParam = viewerId ? '$3' : '$2';
  const sql = [
    'WITH RECURSIVE thread AS (',
    '  SELECT p.id, p.user_id, p.content, p.media_urls, p.media_types, p.reply_to_id, p.quote_of_id, p.community_id,',
    '         p.is_sensitive, p.sensitive_warning, p.visibility, p.likes_count, p.reposts_count, p.replies_count, p.quotes_count,',
    '         p.views_count, p.is_deleted, p.created_at, p.updated_at, u.username, u.display_name, u.avatar_url, u.is_verified, u.is_private,',
    '         0 AS depth, ARRAY[p.id] AS path',
    '  FROM posts p JOIN users u ON u.id = p.user_id',
    '  WHERE p.id = $1 AND p.is_deleted = FALSE',
    '  UNION ALL',
    '  SELECT p.id, p.user_id, p.content, p.media_urls, p.media_types, p.reply_to_id, p.quote_of_id, p.community_id,',
    '         p.is_sensitive, p.sensitive_warning, p.visibility, p.likes_count, p.reposts_count, p.replies_count, p.quotes_count,',
    '         p.views_count, p.is_deleted, p.created_at, p.updated_at, u.username, u.display_name, u.avatar_url, u.is_verified, u.is_private,',
    '         t.depth + 1, t.path || p.id',
    '  FROM posts p JOIN users u ON u.id = p.user_id JOIN thread t ON p.reply_to_id = t.id',
    '  WHERE p.is_deleted = FALSE AND t.depth < 50 AND NOT (p.id = ANY(t.path))',
    ')',
    'SELECT * FROM thread t WHERE TRUE ' + visibility,
    'ORDER BY depth ASC, created_at ASC LIMIT ' + limitParam,
  ].join('\\n');

  const result = await query(sql, params);
  const nodes = result.rows.map((row) => ({ ...row, replies: [] }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const topLevel = [];
  for (const node of nodes) {
    if (node.reply_to_id && byId.has(node.reply_to_id)) byId.get(node.reply_to_id).replies.push(node);
    else if (node.id !== postId) topLevel.push(node);
  }
  return { root: byId.get(postId) || null, replies: topLevel };
}

module.exports = { getPostThread };