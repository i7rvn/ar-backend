const { query, withTransaction } = require('../../config/database');

const MIN_DURATION_SECONDS = 60;
const MAX_DURATION_SECONDS = 30 * 24 * 60 * 60;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

function validatePollInput(poll) {
  if (!poll || typeof poll !== 'object') return null;
  if (!Array.isArray(poll.options) || poll.options.length < MIN_OPTIONS || poll.options.length > MAX_OPTIONS) {
    throw { status: 400, message: `الاستطلاع يحتاج من ${MIN_OPTIONS} إلى ${MAX_OPTIONS} خيارات`, code: 'INVALID_POLL_OPTIONS' };
  }

  const options = poll.options.map((option) => typeof option === 'string' ? option.trim() : '');
  if (options.some((option) => !option || option.length > 100)) {
    throw { status: 400, message: 'كل خيار يجب أن يكون بين حرف و100 حرف', code: 'INVALID_POLL_OPTION' };
  }
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
    throw { status: 400, message: 'خيارات الاستطلاع يجب ألا تتكرر', code: 'DUPLICATE_POLL_OPTION' };
  }

  const durationSeconds = Number(poll.durationSeconds);
  if (!Number.isInteger(durationSeconds) ||
      durationSeconds < MIN_DURATION_SECONDS ||
      durationSeconds > MAX_DURATION_SECONDS) {
    throw { status: 400, message: 'مدة الاستطلاع يجب أن تكون بين دقيقة و30 يوماً', code: 'INVALID_POLL_DURATION' };
  }

  return { options, durationSeconds };
}

async function createPoll(client, postId, pollInput) {
  const poll = validatePollInput(pollInput);
  if (!poll) return null;

  const expiresAt = new Date(Date.now() + poll.durationSeconds * 1000);
  const inserted = await client.query(
    `INSERT INTO polls (post_id, expires_at)
     VALUES ($1, $2)
     RETURNING id, post_id, expires_at`,
    [postId, expiresAt]
  );
  const pollId = inserted.rows[0].id;

  for (let i = 0; i < poll.options.length; i += 1) {
    await client.query(
      `INSERT INTO poll_options (poll_id, option_text, position)
       VALUES ($1, $2, $3)`,
      [pollId, poll.options[i], i]
    );
  }

  return inserted.rows[0];
}

async function getPollForPost(postId, viewerId = null) {
  const pollResult = await query(
    `SELECT id, post_id, expires_at, created_at
     FROM polls
     WHERE post_id = $1`,
    [postId]
  );
  if (!pollResult.rows.length) return null;

  const poll = pollResult.rows[0];
  const options = await query(
    `SELECT
       po.id,
       po.option_text,
       po.position,
       COUNT(pv.id)::int AS vote_count
     FROM poll_options po
     LEFT JOIN poll_votes pv ON pv.option_id = po.id
     WHERE po.poll_id = $1
     GROUP BY po.id
     ORDER BY po.position ASC`,
    [poll.id]
  );

  let myVote = null;
  if (viewerId) {
    const vote = await query(
      `SELECT option_id FROM poll_votes WHERE poll_id = $1 AND user_id = $2`,
      [poll.id, viewerId]
    );
    myVote = vote.rows[0]?.option_id || null;
  }

  const totalVotes = options.rows.reduce((sum, option) => sum + option.vote_count, 0);
  return {
    id: poll.id,
    postId: poll.post_id,
    expiresAt: poll.expires_at,
    createdAt: poll.created_at,
    hasEnded: new Date(poll.expires_at).getTime() <= Date.now(),
    totalVotes,
    votedByMe: Boolean(myVote),
    myOptionId: myVote,
    options: options.rows,
  };
}

async function voteOnPoll(postId, userId, optionId) {
  if (typeof optionId !== 'string') {
    throw { status: 400, message: 'optionId مطلوب', code: 'INVALID_POLL_OPTION_ID' };
  }

  return await withTransaction(async (client) => {
    const poll = await client.query(
      `SELECT id, expires_at
       FROM polls p
       JOIN posts po ON po.id = p.post_id
       WHERE p.post_id = $1 AND po.is_deleted = FALSE
       FOR UPDATE`,
      [postId]
    );
    if (!poll.rows.length) throw { status: 404, message: 'الاستطلاع غير موجود', code: 'POLL_NOT_FOUND' };
    if (new Date(poll.rows[0].expires_at).getTime() <= Date.now()) {
      throw { status: 400, message: 'انتهى الاستطلاع', code: 'POLL_EXPIRED' };
    }

    const option = await client.query(
      `SELECT id FROM poll_options WHERE id = $1 AND poll_id = $2`,
      [optionId, poll.rows[0].id]
    );
    if (!option.rows.length) {
      throw { status: 400, message: 'خيار الاستطلاع غير صالح', code: 'INVALID_POLL_OPTION' };
    }

    try {
      await client.query(
        `INSERT INTO poll_votes (poll_id, option_id, user_id)
         VALUES ($1, $2, $3)`,
        [poll.rows[0].id, optionId, userId]
      );
    } catch (err) {
      if (err.code === '23505') {
        throw { status: 409, message: 'صوّت في هذا الاستطلاع من قبل', code: 'POLL_ALREADY_VOTED' };
      }
      throw err;
    }

    return getPollForPost(postId, userId);
  });
}

module.exports = {
  validatePollInput,
  createPoll,
  getPollForPost,
  voteOnPoll,
};
