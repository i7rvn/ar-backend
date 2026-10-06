const { query, withTransaction } = require('../../config/database');
const { deleteCachePattern } = require('../../config/redis');

const MAX_FILTERS = 100;
const MAX_PHRASE_LENGTH = 80;
const MAX_DURATION_DAYS = 365;

function normalizePhrase(phrase) {
  if (typeof phrase !== 'string') {
    throw { status: 400, message: 'العبارة غير صالحة', code: 'INVALID_FILTER_PHRASE' };
  }
  const value = phrase.trim().toLowerCase();
  if (!value || value.length > MAX_PHRASE_LENGTH) {
    throw { status: 400, message: 'العبارة يجب أن تكون بين حرف و80 حرف', code: 'INVALID_FILTER_PHRASE' };
  }
  return value;
}

function normalizeDurationDays(durationDays) {
  if (durationDays === undefined || durationDays === null || durationDays === '') return null;
  const days = Number(durationDays);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DURATION_DAYS) {
    throw { status: 400, message: 'مدة الفلتر يجب أن تكون بين يوم و365 يوماً', code: 'INVALID_FILTER_DURATION' };
  }
  return days;
}

async function invalidateFeedCache(userId) {
  await Promise.all([
    deleteCachePattern(`feed:foryou:${userId}:*`),
    deleteCachePattern(`feed:following:${userId}:*`),
    deleteCachePattern(`feed:trending:*:${userId}`),
  ]);
}

async function listFilters(userId) {
  const result = await query(
    `SELECT id, phrase, expires_at, created_at
     FROM user_word_filters
     WHERE user_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

async function addFilter(userId, phrase, durationDays) {
  const normalizedPhrase = normalizePhrase(phrase);
  const days = normalizeDurationDays(durationDays);

  return await withTransaction(async (client) => {
    const count = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM user_word_filters
       WHERE user_id = $1
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
    if (count.rows[0].total >= MAX_FILTERS) {
      throw { status: 409, message: 'وصلت للحد الأقصى لفلاتر الكلمات', code: 'FILTER_LIMIT_REACHED' };
    }

    const expiresAt = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
    try {
      const result = await client.query(
        `INSERT INTO user_word_filters (user_id, phrase, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, phrase, expires_at, created_at`,
        [userId, normalizedPhrase, expiresAt]
      );
      return result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw { status: 409, message: 'هذا الفلتر موجود من قبل', code: 'FILTER_EXISTS' };
      }
      throw err;
    }
  }).then(async (filter) => {
    await invalidateFeedCache(userId);
    return filter;
  });
}

async function removeFilter(userId, filterId) {
  const result = await query(
    `DELETE FROM user_word_filters
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [filterId, userId]
  );
  if (!result.rows.length) {
    throw { status: 404, message: 'الفلتر غير موجود', code: 'FILTER_NOT_FOUND' };
  }
  await invalidateFeedCache(userId);
  return true;
}

module.exports = {
  normalizePhrase,
  normalizeDurationDays,
  listFilters,
  addFilter,
  removeFilter,
};
