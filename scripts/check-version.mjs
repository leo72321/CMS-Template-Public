import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const readme = readFileSync('README.md', 'utf8');
const changes = readFileSync('CHANGELOG.md', 'utf8');
const version = pkg.version;
assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'CMS 版本應使用 SemVer（主版.次版.修訂版）');
assert.equal(lock.version, version, 'package-lock.json 版本必須同步');
assert.equal(lock.packages[''].version, version, 'package-lock.json 根套件版本必須同步');
assert.ok(readme.includes('目前公版版本：**v' + version + '**'), 'README 頂部必須標示與 package.json 相同的公版版本');
const entries = [...changes.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm)];
assert.ok(entries.length && entries[0][1] === version, 'CHANGELOG.md 首筆記錄應對應目前版本');
assert.equal(entries.filter(m => m[1] === version).length, 1, '同一版本只能有一份紀錄');
assert.match(changes.slice(entries[0].index + entries[0][0].length, entries[1]?.index ?? changes.length),
  /\n- .{5,}/, '最新版本至少需要一項實際變更說明');

if (process.argv.includes('--compare-base')) {
  const base = process.env.GITHUB_BASE_SHA;
  if (!base || !/^[0-9a-f]{40}$/i.test(base)) throw Error('需要 GitHub PR 的 GITHUB_BASE_SHA 才能比較版本');
  const before = JSON.parse(execFileSync('git', ['show', base + ':package.json'], { encoding:'utf8' }));
  const filenames = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding:'utf8' }).split('\n');
  // Only CMS-template changes require a bump. Per-site content and generated indices do not.
  const sourceChanged = filenames.some(name =>
    /^(src\/|scripts\/|schemas\/|tests\/|\.github\/workflows\/|docs\/|AGENTS\.md$|README\.md$|site\.config\.json$|package(-lock)?\.json$|astro\.config\.ts$|tsconfig\.json$|\.nvmrc$|public\/)/.test(name)
      && !/^docs\/(SITE_STRUCTURE\.md|CONTENT_INDEX\.json)$/.test(name));
  if (sourceChanged) {
    const numeric = v => v.split('.').map(Number);
    const prev = numeric(before.version), next = numeric(version);
    const newer = next[0] > prev[0] || (next[0] === prev[0] && (next[1] > prev[1] || (next[1] === prev[1] && next[2] > prev[2])));
    assert.ok(newer, '修改 CMS 公版功能、程式或文件，必須提高版本號並新增 CHANGELOG 記錄：' + before.version + ' → ' + version);
    console.log('✓ 本次 CMS PR 已升版：' + before.version + ' → ' + version);
  }
}
console.log('✓ 版本、README、package-lock 和 CHANGELOG 一致：v' + version);
