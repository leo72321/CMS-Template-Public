import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const paths=['dist/i18n-fixture/index.html','dist/en/i18n-english/index.html','dist/es/i18n-espanol/index.html','dist/en/index.html','dist/es/index.html'];
for(const p of paths) assert.ok(existsSync(p),'Missing '+p);
const root=readFileSync(paths[0],'utf8');
const en=readFileSync(paths[1],'utf8');
const es=readFileSync(paths[2],'utf8');
assert.match(root,/<html lang="zh-TW">/);
assert.match(en,/<html lang="en">/);
assert.match(es,/<html lang="es">/);
for(const text of [root,en,es]){
  assert.match(text,/hreflang="zh-TW"/);
  assert.match(text,/hreflang="en"/);
  assert.match(text,/hreflang="es"/);
  assert.match(text,/data-locale-link="en"/);
  assert.match(text,/data-locale-link="es"/);
}
assert.match(root,/href="https:\/\/i18n-test.example.org\/i18n-fixture\/"/);
assert.match(en,/href="https:\/\/i18n-test.example.org\/en\/i18n-english\/"/);
assert.match(es,/href="https:\/\/i18n-test.example.org\/es\/i18n-espanol\/"/);
const sitemap=readFileSync('dist/sitemap.xml','utf8');
assert.match(sitemap,/sitemapindex/);
console.log('✓ multilingual live-build routes, canonical and hreflang verified');
