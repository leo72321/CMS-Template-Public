import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
// 故障注入只改臨時副本，不碰實際的 dist，也不影響開發預覽。
const originalRoot = process.cwd();
const sandbox = mkdtempSync(join(tmpdir(), 'cms-output-test-'));
for (const name of ['dist', 'content', 'site.config.json']) cpSync(join(originalRoot, name), join(sandbox, name), { recursive: true });
const path = join(sandbox, 'dist/index.html');
const audit = () => spawnSync(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('scripts/audit.ts')], { encoding: 'utf8', cwd: sandbox });
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
test('故意加入失效連結會被攔下', () => altered(path, s => s.replace('</main>', '<a href="/does-not-exist/">不存在</a></main>'), /失效連結/));
test('故意放重複 H1 會被攔下', () => altered(path, s => s.replace('</main>', '<h1>重複標題</h1></main>'), /一個 H1/));
test('故意改錯 Canonical 會被攔下', () => altered(path, s => s.replace(/rel="canonical" href="[^"]+"/, 'rel="canonical" href="https://wrong.example/"'), /Canonical/));
test('故意反轉索引設定會被攔下', () => altered(path, s => s.replace(/name="robots" content="(noindex|index), follow"/, (_, mode) => `name="robots" content="${mode === 'index' ? 'noindex' : 'index'}, follow"`), /索引設定/));
test('故意將不收錄頁塞進 Sitemap 會被攔下', () => altered(join(sandbox, 'dist/sitemap.xml'), s => s.replace('</urlset>', '<url><loc>https://wrong.example/should-not-exist/</loc></url></urlset>'), /Sitemap/));
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
