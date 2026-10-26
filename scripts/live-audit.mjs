import { load } from 'cheerio';
import { mkdirSync, writeFileSync } from 'node:fs';

const site = process.argv[2];
if (!site || !/^https:\/\/[a-z0-9.-]+\/?$/i.test(site)) throw new Error('Usage: node scripts/live-audit.mjs https://example.com');
const origin = new URL(site).origin;
const maxPages = Number(process.env.AUDIT_MAX_PAGES || 2000);
const maxAssets = Number(process.env.AUDIT_MAX_ASSETS || 5000);
const concurrency = 6;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Set(['/']), visited = new Set(), resources = new Map(), findings = [];
const add = (kind, source, url, status, detail = '') => findings.push({ kind, source, url, status, detail });
const canonical = (raw, base) => {
  try {
    const u = new URL(raw, base);
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    u.hash = '';
    return u;
  } catch { return null; }
};
const fetchSafe = async (url, method = 'GET') => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(16000), headers: { 'user-agent': 'CMS-Live-Audit/1.0 (+site-owner-check)' } });
      if ([429, 502, 503, 504].includes(res.status) && attempt === 0) { await sleep(1500); continue; }
      return res;
    } catch (e) {
      if (attempt) return { status: 0, ok: false, error: String(e), headers: new Headers() };
      await sleep(500);
    }
  }
};
const queuePage = u => {
  if (u.origin !== origin || pending.size + visited.size >= maxPages) return;
  if (/\.(?:xml|pdf|png|jpe?g|webp|gif|svg|ico|css|js|woff2?|mp4|zip)$/i.test(u.pathname)) return;
  pending.add(u.pathname + u.search);
};
const queueResource = (raw, base, kind, source) => {
  const u = canonical(raw, base);
  if (!u) { add(kind, source, raw, 'invalid-url'); return; }
  if (kind === 'link' && u.origin === origin) { queuePage(u); return; }
  if (kind === 'link' && u.origin !== origin) return; // Third-party destinations change independently.
  if (resources.size >= maxAssets || resources.has(u.href)) return;
  resources.set(u.href, { kind, source });
};
const checkResource = async ([url, { kind, source }]) => {
  let res = await fetchSafe(url, 'HEAD');
  if ([0, 403, 405, 501].includes(res.status)) res = await fetchSafe(url, 'GET');
  if (!res.ok) { add(kind, source, url, res.status || 'network-error', res.error || ''); return; }
  const mime = res.headers.get('content-type') || '';
  if (kind === 'image' && mime && !/^(image\/|application\/octet-stream)/i.test(mime)) add(kind, source, url, res.status, 'unexpected content-type: ' + mime);
  if (res.body) await res.body.cancel().catch(() => {});
};
const runPool = async (items, fn) => {
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
};
const sitemapRes = await fetchSafe(origin + '/sitemap.xml');
if (sitemapRes.ok) {
  const root = await sitemapRes.text();
  const xmls = [...root.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(x => x[1].replaceAll('&amp;', '&'));
  for (const candidate of xmls) {
    const u = canonical(candidate, origin);
    if (!u || u.origin !== origin) continue;
    if (u.pathname.endsWith('.xml')) {
      const part = await fetchSafe(u.href);
      if (!part.ok) { add('sitemap', origin + '/sitemap.xml', u.href, part.status); continue; }
      for (const m of (await part.text()).matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
        const p = canonical(m[1].replaceAll('&amp;', '&'), origin);
        if (p) queuePage(p);
      }
    } else queuePage(u);
  }
} else add('sitemap', origin, origin + '/sitemap.xml', sitemapRes.status || 'network-error');
queuePage(new URL(origin + '/'));
while (pending.size && visited.size < maxPages) {
  const batch = [...pending].slice(0, concurrency);
  for (const p of batch) { pending.delete(p); visited.add(p); }
  await runPool(batch, async path => {
    const url = origin + path;
    const res = await fetchSafe(url);
    if (!res.ok) { add('page', url, url, res.status || 'network-error', res.error || ''); return; }
    const mime = res.headers.get('content-type') || '';
    if (!mime.includes('text/html')) return;
    const html = await res.text();
    const $ = load(html);
    $('a[href]').each((_, el) => queueResource($(el).attr('href'), url, 'link', url));
    $('img[src],source[src]').each((_, el) => queueResource($(el).attr('src'), url, 'image', url));
    $('img[srcset],source[srcset]').each((_, el) => {
      for (const candidate of ($(el).attr('srcset') || '').split(',')) {
        const raw = candidate.trim().split(/\s+/)[0];
        if (raw) queueResource(raw, url, 'image', url);
      }
    });
    $('link[rel="stylesheet"][href]').each((_, el) => queueResource($(el).attr('href'), url, 'stylesheet', url));
  });
}
await runPool([...resources], checkResource);
mkdirSync('.reports', { recursive: true });
const result = { origin, checkedAt: new Date().toISOString(), pagesChecked: visited.size, assetsChecked: resources.size, truncated: visited.size >= maxPages || resources.size >= maxAssets, failures: findings };
const name = new URL(origin).hostname.replace(/[^a-z0-9.-]/g, '_');
writeFileSync('.reports/live-' + name + '.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ origin, pagesChecked: result.pagesChecked, assetsChecked: result.assetsChecked, failures: findings.length, truncated: result.truncated }, null, 2));
for (const f of findings.slice(0, 100)) console.error(JSON.stringify(f));
if (findings.length || result.truncated) process.exitCode = 1;
