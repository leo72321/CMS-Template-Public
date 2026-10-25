import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const paths=['dist/i18n-fixture/index.html','dist/en/i18n-english/index.html','dist/es/i18n-espanol/index.html',
  'dist/ja/nihongo/index.html','dist/fr/bonjour/index.html','dist/pt-br/video-em-portugues/index.html',
  'dist/en/index.html','dist/es/index.html','dist/ja/index.html','dist/fr/index.html','dist/pt-br/index.html'];
for(const p of paths) assert.ok(existsSync(p),'Missing '+p);
const root=readFileSync(paths[0],'utf8');
const en=readFileSync(paths[1],'utf8');
const es=readFileSync(paths[2],'utf8');
const ja=readFileSync(paths[3],'utf8');
const fr=readFileSync(paths[4],'utf8');
const pt=readFileSync(paths[5],'utf8');
assert.match(root,/<html lang="zh-TW">/);
assert.match(en,/<html lang="en">/);
assert.match(es,/<html lang="es">/);
assert.match(ja,/<html lang="ja">/);
assert.match(fr,/<html lang="fr">/);
assert.match(pt,/<html lang="pt-BR">/);
for(const text of [root,en,es,ja,fr,pt]){
  assert.match(text,/hreflang="zh-TW"/);
  assert.match(text,/hreflang="en"/);
  assert.match(text,/hreflang="es"/);
  assert.match(text,/hreflang="ja"/);
  assert.match(text,/hreflang="fr"/);
  assert.match(text,/hreflang="pt-BR"/);
  assert.match(text,/data-locale-link="en"/);
  assert.match(text,/data-locale-link="es"/);
  assert.match(text,/data-locale-link="ja"/);
  assert.match(text,/data-locale-link="pt-BR"/);
}
assert.match(root,/href="https:\/\/i18n-test.example.org\/i18n-fixture\/"/);
assert.match(en,/href="https:\/\/i18n-test.example.org\/en\/i18n-english\/"/);
assert.match(es,/href="https:\/\/i18n-test.example.org\/es\/i18n-espanol\/"/);
assert.match(ja,/ホーム/);
assert.match(ja,/日本語サイト/);
assert.match(pt,/Site em português/);
assert.match(pt,/href="https:\\/\\/i18n-test.example.org\\/pt-br\\/video-em-portugues\\/"/);
const sitemap=readFileSync('dist/sitemap.xml','utf8');
assert.match(sitemap,/sitemapindex/);
console.log('✓ 6-language live-build routes, localized UI, canonical and hreflang verified');
