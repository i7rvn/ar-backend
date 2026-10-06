const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const axios = require('axios');
const { URL } = require('url');
const { getCache, setCache } = require('../../config/redis');

const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_SECONDS = 3600;

function isPrivateOrReservedIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateOrReservedIPv6(ip) {
  const value = ip.toLowerCase();
  return value === '::' ||
    value === '::1' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe8') ||
    value.startsWith('fe9') ||
    value.startsWith('fea') ||
    value.startsWith('feb');
}

async function resolvePublicAddress(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw { status: 400, message: 'هذا النطاق غير مسموح به', code: 'PRIVATE_URL_BLOCKED' };
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) throw { status: 400, message: 'تعذر حل اسم النطاق', code: 'DNS_LOOKUP_FAILED' };

  const safe = addresses.find(({ address, family }) =>
    family === 4 ? !isPrivateOrReservedIPv4(address) : !isPrivateOrReservedIPv6(address)
  );
  if (!safe) {
    throw { status: 400, message: 'لا يمكن الوصول إلى نطاق داخلي أو محجوز', code: 'PRIVATE_URL_BLOCKED' };
  }
  return safe;
}

function getAgent(protocol, hostname, address, family) {
  const Agent = protocol === 'https:' ? https.Agent : http.Agent;
  return new Agent({
    keepAlive: false,
    lookup: (_host, _options, callback) => callback(null, address, family),
    servername: hostname,
  });
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractMeta(html, key, attr = 'property') {
  const safeKey = key.replace(/[.*+?^()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    '<meta\\s+[^>]*' + attr + '\\s*=\\s*["\\\']' + safeKey +
    '["\\\'][^>]*content\\s*=\\s*["\\\']([^"\\\']*)["\\\'][^>]*>',
    'i'
  );
  const reversePattern = new RegExp(
    '<meta\\s+[^>]*content\\s*=\\s*["\\\']([^"\\\']*)["\\\'][^>]*' +
    attr + '\\s*=\\s*["\\\']' + safeKey + '["\\\'][^>]*>',
    'i'
  );
  const match = html.match(pattern) || html.match(reversePattern);
  return match ? decodeHtml(match[1].trim()) : null;
}

function parsePreview(html, finalUrl) {
  const title = extractMeta(html, 'og:title') ||
    extractMeta(html, 'twitter:title') ||
    ((html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i) || [])[1] || '').trim();
  const description = extractMeta(html, 'og:description') ||
    extractMeta(html, 'twitter:description') ||
    extractMeta(html, 'description', 'name');
  const image = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image');
  let imageUrl = null;
  try {
    imageUrl = image ? new URL(image, finalUrl).toString() : null;
  } catch {
    imageUrl = null;
  }
  return {
    url: finalUrl,
    title: title ? title.slice(0, 300) : null,
    description: description ? description.slice(0, 500) : null,
    image: imageUrl,
  };
}

async function fetchOnce(targetUrl) {
  const address = await resolvePublicAddress(targetUrl.hostname);
  return axios.get(targetUrl.toString(), {
    httpAgent: getAgent(targetUrl.protocol, targetUrl.hostname, address.address, address.family),
    httpsAgent: getAgent(targetUrl.protocol, targetUrl.hostname, address.address, address.family),
    timeout: 5000,
    maxRedirects: 0,
    maxContentLength: MAX_HTML_BYTES,
    maxBodyLength: MAX_HTML_BYTES,
    responseType: 'text',
    transformResponse: [(data) => data],
    validateStatus: (status) => status >= 200 && status < 400,
    headers: {
      'User-Agent': 'ARLinkPreview/1.0',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
}

async function getLinkPreview(inputUrl) {
  let current;
  try {
    current = new URL(inputUrl);
  } catch {
    throw { status: 400, message: 'الرابط غير صالح', code: 'INVALID_URL' };
  }

  if (!['http:', 'https:'].includes(current.protocol) ||
      current.username || current.password ||
      current.port && !['80', '443'].includes(current.port)) {
    throw { status: 400, message: 'صيغة الرابط غير مسموحة', code: 'INVALID_URL' };
  }

  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const cacheKey = `link-preview:${current.toString()}`;
    const cached = await getCache(cacheKey);
    if (cached) return cached;

    let response;
    try {
      response = await fetchOnce(current);
    } catch (err) {
      if (err.response?.status >= 300 && err.response?.status < 400) {
        const location = err.response.headers.location;
        if (!location) throw { status: 400, message: 'الرابط أعاد إعادة توجيه غير صالحة', code: 'INVALID_REDIRECT' };
        current = new URL(location, current);
        if (!['http:', 'https:'].includes(current.protocol)) {
          throw { status: 400, message: 'إعادة التوجيه إلى بروتوكول غير مسموح', code: 'INVALID_REDIRECT' };
        }
        await resolvePublicAddress(current.hostname);
        continue;
      }
      throw { status: 502, message: 'تعذر جلب معاينة الرابط', code: 'LINK_FETCH_FAILED' };
    }

    if (response.status >= 300) {
      const location = response.headers.location;
      if (!location) throw { status: 400, message: 'الرابط أعاد إعادة توجيه غير صالحة', code: 'INVALID_REDIRECT' };
      current = new URL(location, current);
      continue;
    }

    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw { status: 415, message: 'الرابط لا يعرض صفحة HTML', code: 'UNSUPPORTED_LINK_TYPE' };
    }

    const preview = parsePreview(response.data, current.toString());
    await setCache(cacheKey, preview, CACHE_TTL_SECONDS);
    return preview;
  }

  throw { status: 400, message: 'عدد إعادة التوجيهات كبير جداً', code: 'TOO_MANY_REDIRECTS' };
}

module.exports = { getLinkPreview, parsePreview, resolvePublicAddress };
