const test = require('node:test')
const assert = require('node:assert/strict')
const { cookieOptions, readCookie, isAllowedBrowserOrigin } = require('../utils/refreshCookie')

test('production refresh cookie is HttpOnly and Secure with SameSite None', () => {
  const options = cookieOptions({ NODE_ENV: 'production' })
  assert.equal(options.httpOnly, true)
  assert.equal(options.secure, true)
  assert.equal(options.sameSite, 'none')
  assert.equal(options.path, '/api/auth')
})

test('development refresh cookie remains usable on localhost', () => {
  const options = cookieOptions({ NODE_ENV: 'development' })
  assert.equal(options.httpOnly, true)
  assert.equal(options.secure, false)
  assert.equal(options.sameSite, 'lax')
})

test('cookie parser returns only the named cookie', () => {
  const header = 'foo=bar; ar_refresh_token=hello%20world; other=value'
  assert.equal(readCookie(header), 'hello world')
})

test('browser origin must be one of configured application origins', () => {
  assert.equal(isAllowedBrowserOrigin('https://ar.example', { FRONTEND_URL: 'https://ar.example' }), true)
  assert.equal(isAllowedBrowserOrigin('https://evil.example', { FRONTEND_URL: 'https://ar.example' }), false)
  assert.equal(isAllowedBrowserOrigin(undefined, { FRONTEND_URL: 'https://ar.example' }), true)
})