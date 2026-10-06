const COOKIE_NAME = 'ar_refresh_token';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function cookieOptions(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: MAX_AGE_MS,
  };
}

function setRefreshCookie(res, token, env = process.env) {
  res.cookie(COOKIE_NAME, token, cookieOptions(env));
}

function clearRefreshCookie(res, env = process.env) {
  const options = cookieOptions(env);
  delete options.maxAge;
  res.clearCookie(COOKIE_NAME, options);
}

function readCookie(header, name = COOKIE_NAME) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function isAllowedBrowserOrigin(origin, env = process.env) {
  if (!origin) return true;
  return [env.FRONTEND_URL, env.DASHBOARD_URL].filter(Boolean).includes(origin);
}

module.exports = { COOKIE_NAME, cookieOptions, setRefreshCookie, clearRefreshCookie, readCookie, isAllowedBrowserOrigin };