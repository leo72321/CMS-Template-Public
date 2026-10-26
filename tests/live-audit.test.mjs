import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../scripts/live-audit.mjs', import.meta.url));
const goodPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZasAAAAASUVORK5CYII=', 'base64');

async function fixture({ broken }) {
  let root = '';
  const server = createServer((req, res) => {
    const path = req.url || '/';
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body); };
    if (path === '/sitemap.xml') return send(200, 'application/xml', '<sitemapindex><sitemap><loc>' + root + '/posts-001.xml</loc></sitemap></sitemapindex>');
    if (path === '/posts-001.xml') return send(200, 'application/xml', '<urlset><url><loc>' + root + '/article/</loc></url></urlset>');
    if (path === '/style.css') return send(req.method === 'HEAD' ? 404 : 200, 'text/css', 'body{margin:0}');
    if (path === '/good.png') return send(200, 'image/png', goodPng);
    if (path === '/good.svg') return send(200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    if (path === '/wrong-image.png') return send(200, 'text/html', '<html><body>not image</body></html>');
    if (path === '/article/') return send(200, 'text/html', '<title>Post</title><a href="/">Home</a><img src="/good.svg" alt="good">');
    if (path === '/') return send(200, 'text/html', '<title>Home</title><link rel="stylesheet" href="/style.css"><a href="/article/">Post</a>' +
      (broken ? '<a href="/missing/">Missing</a><img src="/wrong-image.png" alt="bad">' +
        '<img srcset="/good.png 1x, /missing-img.png 2x" alt="responsive">' : '<img src="/good.png" alt="good">'));
    return send(404, 'text/plain', 'missing');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  root = 'http://127.0.0.1:' + server.address().port;
  return { server, root };
}
async function run(root) {
  const cwd = mkdtempSync(join(tmpdir(), 'cms-live-audit-'));
  try {
    const child = spawn(process.execPath, [cli, root], {
      cwd, env: { ...process.env, CMS_AUDIT_TEST_HTTP: '1', AUDIT_MAX_MS: '30000', AUDIT_MAX_PAGES: '20' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    if (!['0', '1'].includes(String(code))) throw Error('Crawler crashed: ' + stderr);
    const filename = join(cwd, '.reports', 'live-127.0.0.1.json');
    return { code, report: JSON.parse(readFileSync(filename, 'utf8')) };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
test('Healthy pages and image signatures pass', async t => {
  const { server, root } = await fixture({ broken: false });
  t.after(() => server.close());
  const { code, report } = await run(root);
  assert.equal(code, 0);
  assert.equal(report.pagesChecked, 2);
  assert.equal(report.errors, 0);
  assert.equal(report.sitemapsChecked, 2);
  assert.deepEqual(report.truncated, []);
  assert.equal(report.assetsChecked, 3);
});
test('404 pages, missing srcset and HTML disguised as images fail', async t => {
  const { server, root } = await fixture({ broken: true });
  t.after(() => server.close());
  const { code, report } = await run(root);
  assert.equal(code, 1);
  assert.equal(report.pagesChecked, 3);
  assert.ok(report.errors >= 3, JSON.stringify(report.findings));
  assert.ok(report.findings.some(f => f.url.endsWith('/missing/') && f.type === 'page' && f.status === 404));
  assert.ok(report.findings.some(f => f.url.endsWith('/missing-img.png') && f.type === 'image' && f.status === 404));
  assert.ok(report.findings.some(f => f.url.endsWith('/wrong-image.png') && f.type === 'image' && /text\/html/.test(f.detail)));
});
