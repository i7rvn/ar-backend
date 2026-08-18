// ═══════════════════════════════════════════════════════════════
// AR App — نقاط السمعة (تُحسَب من تفاعلات حقيقية، لا قيمة ثابتة)
// ═══════════════════════════════════════════════════════════════

const { query } = require('../../config/database');

const POINTS = {
  like: 2,
  follow: 5,
  reply: 1,
  repost: 3,
};

async function awardReputation(userId, type) {
  const points = POINTS[type];
  if (!points) return;
  await query(`UPDATE users SET reputation_points = reputation_points + $1 WHERE id = $2`, [points, userId]);
}

module.exports = { awardReputation };
