const { authenticateAccessToken } = require('./auth');

async function optionalAuthenticate(req, res, next) {
 const authHeader = req.headers.authorization;
 if (!authHeader?.startsWith('Bearer ')) return next();

 try {
  const session = await authenticateAccessToken(authHeader.slice(7).trim());
  req.user = session.user;
  req.token = session.token;
  req.deviceId = session.deviceId;
  req.auth = session.decoded;
 } catch {
 }
 next();
}

module.exports = { optionalAuthenticate };
