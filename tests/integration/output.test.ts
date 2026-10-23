import { test, after } from 'node:test';
import { encodePath } from '../../src/lib/model';
import { readModel } from '../../scripts/lib/content';
import { load } from 'cheerio';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
// 故障注入只改臨時副本，不碰實際的 dist，也不影響開發預覽。
const originalRoot = process.cwd();
const sandbox = mkdtempSync(join(tmpdir(), 'cms-output-test-'));
for (const name of ['dist', 'content', 'site.config.json']) cpSync(join(originalRoot, name), join(sandbox, name), { recursive: true });
const path = join(sandbox, 'dist/index.html');
const audit = () => spawnSync(process.execPath, ['--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href, resolve('scripts/audit.ts')], { encoding: 'utf8', cwd: sandbox });
function altered(file: string, transform: (s: string) => string, expected: RegExp) {
  const before = readFileSync(file, 'utf8');
  try {
    writeFileSync(file, transform(before));
    const result = audit();
    assert.notEqual(result.status, 0, '錯誤產物不能通過驗收');
    assert.match(result.stderr, expected);
  } finally { writeFileSync(file, before); }
}
test('正常產物可通過最終驗收', () => { const r = audit(); assert.equal(r.status, 0, r.stderr); });
test('文章標準網址依分類，舊 Blog 和舊分類均永久轉址至唯一分類網址', () => {
  const home = readFileSync(join(sandbox, 'dist/index.html'), 'utf8');
  const redirects = readFileSync(join(sandbox, 'dist/_redirects'), 'utf8').split('\n');
  for (const slug of ['SEO發布檢查', '圖片上傳流程', '新增第一篇文章']) {
    const canonical = `/website-guides/${slug}/`;
    const page = readFileSync(join(sandbox, 'dist', 'website-guides', slug, 'index.html'), 'utf8');
    assert.ok(home.includes(`href="${canonical}"`), `首頁文章連結應使用分類：${slug}`);
    assert.ok(page.includes(`href="https://example.com${encodePath(canonical)}"`), `標準網址須走分類：${slug}`);
    for (const legacy of [`/blog/${slug}/`, `/網站筆記/${slug}/`]) {
      assert.ok(redirects.includes(`${encodePath(legacy)} ${encodePath(canonical)} 301`), `缺少 301：${legacy}`);
    }
  }
  assert.ok(redirects.includes(`${encodePath('/網站筆記/')} /blog/ 301`), '舊文章總覽入口仍到 /blog/');
});
test('所有 POST 只輸出全站啟用的頁尾區塊，不再顯示主題中心或額外服務卡', () => {
  const cfg = JSON.parse(readFileSync(join(sandbox, 'site.config.json'), 'utf8'));
  for (const slug of ['SEO發布檢查', '圖片上傳流程', '新增第一篇文章']) {
    const $ = load(readFileSync(join(sandbox, 'dist', 'website-guides', slug, 'index.html'), 'utf8'));
    assert.equal($('.topic-link, .sidebar, .notice').length, 0);
    assert.equal($('.post-footer-author').length, Number(cfg.postFooter.author.enabled));
    assert.equal($('.post-footer-tags').length, Number(cfg.postFooter.tags));
    assert.equal($('.post-footer-custom').length, cfg.postFooter.blocks.filter((b: { enabled: boolean; title: string; text: string; href: string }) => b.enabled && (b.title || b.text || b.href)).length);
    assert.ok($('.post-footer-related').length <= 1);
  }
});
test('故意加入失效連結會被攔下', () => altered(path, s => s.replace('</main>', '<a href="/does-not-exist/">不存在</a></main>'), /失效連結/));
test('故意放重複 H1 會被攔下', () => altered(path, s => s.replace('</main>', '<h1>重複標題</h1></main>'), /一個 H1/));
test('故意改錯 Canonical 會被攔下', () => altered(path, s => s.replace(/rel="canonical" href="[^"]+"/, 'rel="canonical" href="https://wrong.example/"'), /Canonical/));
test('故意反轉索引設定會被攔下', () => altered(path, s => s.replace(/name="robots" content="(noindex|index), follow"/, (_, mode) => `name="robots" content="${mode === 'index' ? 'noindex' : 'index'}, follow"`), /索引設定/));
test('故意將不收錄頁塞進 Sitemap 會被攔下', () => altered(join(sandbox, 'dist/sitemap.xml'), s => s.replace('</urlset>', '<url><loc>https://wrong.example/should-not-exist/</loc></url></urlset>'), /Sitemap/));
test('公版預設 noindex，根 Sitemap 必須是空的，不能讓草稿或測試文章暴露到 Sitemap Index', () => {
  const sitemap = readFileSync(join(sandbox, 'dist/sitemap.xml'), 'utf8');
  assert.match(sitemap, /<urlset/);
  assert.doesNotMatch(sitemap, /<sitemap><loc>/);
  assert.doesNotMatch(sitemap, /<url><loc>/);
});
test('故意加入前端程式會被攔下', () => altered(path, s => s.replace('</body>', '<script>console.log(1)</script></body>'), /前端 JavaScript/));
test('故意放缺少尺寸的圖片會被攔下', () => altered(path, s => s.replace('</main>', '<img src="/missing.webp" alt="測試"></main>'), /圖片缺少/));
test('故意切斷文章索引的全部連入，會判為孤兒頁', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const originals = walk(join(sandbox, 'dist')).filter(f => f.endsWith('.html')).map(f => [f, readFileSync(f, 'utf8')] as const);
  try {
    for (const [file, content] of originals) writeFileSync(file, content.replaceAll('href="/blog/"', 'href="/"'));
    const result = audit();
    assert.notEqual(result.status, 0); assert.match(result.stderr, /孤兒頁/);
  } finally { for (const [file, content] of originals) writeFileSync(file, content); }
});
after(() => { try { const result = audit(); assert.equal(result.status, 0, result.stderr); } finally { rmSync(sandbox, { recursive: true, force: true }); } });

test('靜態 301 與容量政策一致，沒有重複、超額或退役規則復活', () => {
  const model = readModel();
  const expected = [...model.redirects].map(([from, to]) => encodePath(from) + ' ' + encodePath(to) + ' 301');
  const actual = readFileSync(join(sandbox, 'dist/_redirects'), 'utf8').trim().split(/\r?\n/).filter(Boolean);
  assert.deepEqual(actual, expected);
  assert.ok(actual.length <= model.site.redirectManagement.maxActive);
  for (const [from, record] of Object.entries(model.redirectState.history.entries)) {
    if (record.retiredAt) assert.equal(model.redirects.has(from), false);
  }
});
