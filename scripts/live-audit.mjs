import { load } from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';

const supplied = process.argv[2];
const allowLocalTest = process.env.CMS_AUDIT_TEST_HTTP === '1';
if (!supplied || !new RegExp(allowLocalTest ? '^https?://[^/]+/?$' : '^https://[a-z0-9.-]+/?$', 'i').test(supplied)) {
  throw Error('Usage: node scripts/live-audit.mjs https://domain.example');
}
const origin = new URL(supplied).origin;
const hostname = new URL(origin).hostname;
const starting = Date.now();
const positive = (key, fallback) => {
  const n = Number(process.env[key] || fallback);
  if (!Number.isInteger(n) || n <= 0) throw Error('Invalid audit limit: ' + key);
  return n;
};
const MAX_PAGES = positive('AUDIT_MAX_PAGES', 2000);
const MAX_ASSETS = positive('AUDIT_MAX_ASSETS', 10000);
const MAX_EXTERNAL = positive('AUDIT_MAX_EXTERNAL', 1000);
const MAX_MS = positive('AUDIT_MAX_MS', 23 * 60 * 1000);
const CONCURRENCY = 5;
const seenSitemaps = new Set();
const pages = new Map([['/', origin + '/']]);
const visited = new Set();
const assets = new Map();
const external = new Map();
const findings = [];
const limits = new Set();
const nap = ms => new Promise(resolve => setTimeout(resolve, ms));
const expired = () => Date.now() - starting > MAX_MS;

function add(severity, type, source, url, status, detail = '') {
  findings.push({ severity, type, source, url, status, detail });
}
function safeUrl(raw, base) {
  try {
    if (!raw || /^(data|blob|mailto|tel|sms|javascript):/i.test(raw.trim())) return null;
    const url = new URL(raw, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!allowLocalTest && /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|\[::1\]$)/i.test(url.hostname)) return null;
    if (url.username || url.password) return null;
    return url;
  } catch { return null; }
}
function internal(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return host === hostname.toLowerCase().replace(/^www\./, '');
}
function normalize(url) {
  url.hash = '';
  return url;
}
function enqueuePage(url, source) {
  if (!internal(url)) return;
  normalize(url);
  if (/\.(?:xml|pdf|zip|jpe?g|png|webp|gif|avif|svg|ico|css|js|woff2?|mp4|webm|txt)$/i.test(url.pathname)) {
    enqueueAsset(url.href, 'file', source);
    return;
  }
  const path = url.pathname + url.search;
  if (pages.has(path)) return;
  if (pages.size >= MAX_PAGES) { limits.add('pages'); return; }
  pages.set(path, source);
}
function enqueueAsset(raw, kind, source) {
  const url = safeUrl(raw, source);
  if (!url) return;
  normalize(url);
  if (assets.has(url.href)) return;
  if (assets.size >= MAX_ASSETS) { limits.add('assets'); return; }
  assets.set(url.href, { kind, source });
}
function enqueueLink(raw, source) {
  const url = safeUrl(raw, source);
  if (!url) return;
  normalize(url);
  if (internal(url)) return enqueuePage(url, source);
  if (external.has(url.href)) return;
  if (external.size >= MAX_EXTERNAL) { limits.add('external-links'); return; }
  external.set(url.href, source);
}
async function request(raw, method = 'GET', headers = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let current = raw;
    try {
      for (let redirects = 0; redirects <= 6; redirects++) {
        if (expired()) return { error: 'audit time budget exceeded' };
        const url = safeUrl(current, origin);
        if (!url) return { error: 'blocked URL or redirect' };
        const response = await fetch(url.href, {
          method, headers: { 'user-agent': 'CMS-Live-Audit/2.0 (site owner diagnostic)', ...headers },
          redirect: 'manual', signal: AbortSignal.timeout(14000),
        });
        if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
          const target = safeUrl(response.headers.get('location'), url.href);
          if (response.body) await response.body.cancel().catch(() => {});
          if (!target) return { error: 'blocked redirect' };
          current = target.href;
          continue;
        }
        if (redirects === 6) return { error: 'too many redirects' };
        if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
          if (response.body) await response.body.cancel().catch(() => {});
          await nap(350 * (attempt + 1));
          break;
        }
        return { response, finalUrl: url.href };
      }
    } catch (error) {
      if (attempt === 2) return { error: String(error) };
    }
  }
  return { error: 'request retries exhausted' };
}
async function pool(items, task) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length && !expired()) await task(items[i++]);
  }));
}
async function sitemap(raw, depth = 0) {
  if (depth > 5 || seenSitemaps.has(raw) || seenSitemaps.size >= 150 || expired()) return;
  seenSitemaps.add(raw);
  const result = await request(raw);
  if (!result.response?.ok) {
    add(depth === 0 ? 'error' : 'warning', 'sitemap', origin, raw, result.response?.status || 'network-error', result.error || '');
    return;
  }
  const xml = await result.response.text();
  if (!/<(?:sitemapindex|urlset)\b/i.test(xml)) {
    add('error', 'sitemap', origin, raw, result.response.status, 'Sitemap response was not sitemap XML');
    return;
  }
  const sitemapFiles = [];
  for (const m of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
    const url = safeUrl(m[1].replaceAll('&amp;', '&').trim(), raw);
    if (!url || !internal(url)) continue;
    if (/\.xml$/i.test(url.pathname)) sitemapFiles.push(url.href);
    else enqueuePage(url, raw);
  }
  for (const next of sitemapFiles) await sitemap(next, depth + 1);
}
function srcset(value, source) {
  for (const part of (value || '').split(',')) {
    const url = part.trim().split(/\s+/)[0];
    if (url) enqueueAsset(url, 'image', source);
  }
}
async function page([path, source]) {
  const url = origin + path;
  const result = await request(url);
  const response = result.response;
  if (!response?.ok) {
    const status = response?.status || 'network-error';
    const severity = status === 403 || status === 429 ? 'warning' : 'error';
    add(severity, 'page', source, url, status, result.error || '');
    if (response?.body) await response.body.cancel().catch(() => {});
    return;
  }
  const mime = response.headers.get('content-type') || '';
  if (!mime.includes('text/html')) {
    add('error', 'page', source, url, response.status, 'Expected text/html, got ' + mime);
    if (response.body) await response.body.cancel().catch(() => {});
    return;
  }
  const html = await response.text();
  const finalUrl = result.finalUrl || url;
  const $ = load(html);
  if (!$('title').text().trim()) add('warning', 'html', source, url, response.status, 'Missing title');
  $('a[href]').each((_, el) => enqueueLink($(el).attr('href'), finalUrl));
  $('img[src],img[data-src],source[src],video[poster]').each((_, el) =>
    enqueueAsset($(el).attr('src') || $(el).attr('data-src') || $(el).attr('poster'), 'image', finalUrl));
  $('img[srcset],source[srcset],img[data-srcset]').each((_, el) =>
    srcset($(el).attr('srcset') || $(el).attr('data-srcset'), finalUrl));
  $('link[rel="stylesheet"][href]').each((_, el) => enqueueAsset($(el).attr('href'), 'stylesheet', finalUrl));
  $('link[rel="icon"][href],link[rel="apple-touch-icon"][href]').each((_, el) =>
    enqueueAsset($(el).attr('href'), 'image', finalUrl));
  $('meta[property="og:image"][content],meta[name="twitter:image"][content]').each((_, el) =>
    enqueueAsset($(el).attr('content'), 'image', finalUrl));
  $('[style]').each((_, el) => {
    for (const m of ($(el).attr('style') || '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
      enqueueAsset(m[1], 'image', finalUrl);
    }
  });
}
async function imageBody(response) {
  const mime = (response.headers.get('content-type') || '').toLowerCase();
  if (/text\/html|application\/json|text\/plain/.test(mime)) return 'Server returned ' + mime;
  if (!response.body) return 'Missing response body';
  const reader = response.body.getReader();
  let bytes = Buffer.alloc(0);
  try {
    while (bytes.length < 1024) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      bytes = Buffer.concat([bytes, Buffer.from(value)]);
      if (bytes.length >= 4096) break;
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!bytes.length) return 'Empty image response';
  const txt = bytes.subarray(0, 4096).toString('utf8').trimStart();
  if (/^<!doctype html|^<html/i.test(txt)) return 'HTML error page returned with image URL';
  const bmp = bytes[0] === 0x42 && bytes[1] === 0x4d;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const gif = bytes.toString('ascii', 0, 3) === 'GIF';
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const avif = bytes.toString('ascii', 4, 8) === 'ftyp' && /avi[fs]|mif1|heic/.test(bytes.toString('ascii', 8, 32));
  const ico = bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
  const svg = /^(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(txt);
  if (!(bmp || jpg || png || gif || webp || avif || ico || svg)) return 'Image signature not recognized, content-type=' + mime;
  return '';
}
async function asset([url, meta]) {
  // Range limits transfer volume when a CDN supports partial reads.
  let result = await request(url, meta.kind === 'image' ? 'GET' : 'HEAD',
    meta.kind === 'image' ? { Range: 'bytes=0-4095' } : {});
  if (meta.kind !== 'image' && [403, 405, 501].includes(result.response?.status)) {
    if (result.response?.body) await result.response.body.cancel().catch(() => {});
    result = await request(url, 'GET', { Range: 'bytes=0-4095' });
  }
  const response = result.response;
  if (!response?.ok) {
    const status = response?.status || 'network-error';
    add([403, 429].includes(status) ? 'warning' : 'error',
      meta.kind, meta.source, url, status, result.error || '');
    if (response?.body) await response.body.cancel().catch(() => {});
    return;
  }
  if (meta.kind === 'image') {
    try {
      const problem = await imageBody(response);
      if (problem) add('error', meta.kind, meta.source, url, response.status, problem);
    } catch (e) { add('warning', meta.kind, meta.source, url, 'stream-error', String(e)); }
  } else if (response.body) await response.body.cancel().catch(() => {});
}
async function link([url, source]) {
  let result = await request(url, 'HEAD');
  if ([403, 405, 501].includes(result.response?.status)) {
    if (result.response?.body) await result.response.body.cancel().catch(() => {});
    result = await request(url, 'GET', { Range: 'bytes=0-4095' });
  }
  const status = result.response?.status || 'network-error';
  if (!result.response?.ok) {
    // Third-party sites often block bots; only definitive 404/410 count as errors.
    add([404, 410].includes(status) ? 'error' : 'warning', 'external-link', source, url, status, result.error || '');
  }
  if (result.response?.body) await result.response.body.cancel().catch(() => {});
}
try {
  await sitemap(origin + '/sitemap.xml');
  while (visited.size < pages.size && !expired()) {
    const batch = [...pages.entries()].filter(([p]) => !visited.has(p)).slice(0, CONCURRENCY * 3);
    if (!batch.length) break;
    for (const [path] of batch) visited.add(path);
    await pool(batch, page);
  }
  await pool([...assets.entries()], asset);
  await pool([...external.entries()], link);
} catch (e) { add('error', 'crawler', origin, origin, 'exception', String(e)); }
if (expired()) limits.add('time');
const result = {
  origin, checkedAt: new Date().toISOString(), pagesChecked: visited.size, pagesFound: pages.size,
  sitemapsChecked: seenSitemaps.size, assetsChecked: assets.size, externalLinksChecked: external.size,
  truncated: [...limits], errors: findings.filter(x => x.severity === 'error').length,
  warnings: findings.filter(x => x.severity === 'warning').length, findings,
};
mkdirSync('.reports', { recursive: true });
writeFileSync('.reports/live-' + hostname + '.json', JSON.stringify(result, null, 2) + '\n');
writeFileSync('.reports/live-' + hostname + '.md', [
  '# ' + hostname + ' 正式網站巡檢',
  '',
  '頁面：' + result.pagesChecked + '／' + result.pagesFound +
  '；圖片及其他資源：' + result.assetsChecked + '；站外連結：' + result.externalLinksChecked +
  '；錯誤：' + result.errors + '；提醒：' + result.warnings,
  '截斷項目：' + (result.truncated.join(', ') || '無'),
  '',
  ...findings.map(x => '- [' + x.severity + '] ' + x.type + ' ' + x.status + ' ' + x.url +
    '（來源：' + x.source + '）' + (x.detail ? ' ' + x.detail : '')),
  '',
].join('\n'));
console.log(JSON.stringify({
  domain: hostname, pagesChecked: result.pagesChecked, pagesFound: result.pagesFound,
  assetsChecked: result.assetsChecked, externalLinksChecked: result.externalLinksChecked,
  errors: result.errors, warnings: result.warnings, truncated: result.truncated,
}, null, 2));
for (const item of findings.slice(0, 100)) console.log(JSON.stringify(item));
if (result.errors || result.truncated.length) process.exitCode = 1;
