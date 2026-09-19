const { query } = require('../../config/database');
const { getSetting } = require('../../config/settings');

async function countAccountsForEmail(email) {
 const result = await query(`SELECT COUNT(*) FROM linked_accounts WHERE email = $1`, [email]);
 return parseInt(result.rows[0].count);
}

async function canRegisterWithEmail(email) {
 const max = parseInt(await getSetting('max_accounts_per_email', 3));
 const current = await countAccountsForEmail(email);
 return { allowed: current < max, current, max };
}

async function linkAccount(email, userId) {
 await query(
 `INSERT INTO linked_accounts (email, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
 [email, userId]
 );
}

async function listLinkedAccounts(email) {
 const result = await query(
 `SELECT u.id, u.username, u.display_name, u.avatar_url
 FROM linked_accounts la JOIN users u ON u.id = la.user_id
 WHERE la.email = $1`,
 [email]
 );
 return result.rows;
}

module.exports = { canRegisterWithEmail, linkAccount, listLinkedAccounts, countAccountsForEmail };
