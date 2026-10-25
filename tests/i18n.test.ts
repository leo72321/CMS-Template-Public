import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeModel, type Input, type Post, type Page } from '../src/lib/model';
import { postSchema, pageSchema, taxonomySchema, siteSchema } from '../src/lib/schema';
import { localePrefix, languageEnabled, t } from '../src/lib/i18n';
const config = (enabled: boolean) => siteSchema.parse({ domain: 'unit.example.org', title: '站名',
  description: '說明', author: '作者', language: 'zh-TW', media: { bucket: 'media' },
  indexable: true, i18n: { enabled, defaultLocale: 'zh-TW', locales: ['zh-TW', 'en', 'es'] } });
const post = (uid: string, extra: Record<string,unknown> = {}): Post => ({
  kind: 'post', file: uid + '.md', body: 'text', data: postSchema.parse({
    uid, title: uid, description: 'Description', slug: uid, category: 'zh', draft: false, publishedAt: '2026-01-01', ...extra,
  }),
});
const page = (uid: string, extra: Record<string,unknown> = {}): Page => ({
  kind: 'page', file: uid + '.md', body: 'text', data: pageSchema.parse({
    uid, title: uid, description: 'Description', slug: uid, draft: false, ...extra,
  }),
});
const taxonomy = (id: string, locale?: string) => taxonomySchema.parse({
  id, locale, translationKey: 'general', slug: id, name: id, indexable: true,
  description: 'Description',
});
function input(): Input { return {
  posts: [post('broken', { category: 'zh' }), post('broken-en', { locale: 'en', translationKey: 'broken',
    category: 'english', slug: 'damaged-video' }), post('broken-es', { locale: 'es',
    translationKey: 'broken', category: 'espanol', slug: 'video-danado' })],
  pages: [page('about'), page('acerca', { locale:'es',translationKey:'about' })],
  cpts: [], categories: [taxonomy('zh'), taxonomy('english','en'), taxonomy('espanol','es')],
  tags: [], topics: [],
}; }
test('disabled settings keep original URL semantics and no locale UI', () => {
  const site = siteSchema.parse({ domain:'unit.example.org', title:'Website', description:'Text',
    author:'Editor', media:{bucket:'media'} });
  assert.equal(site.i18n.enabled, false);
  assert.equal(languageEnabled(site), false);
  assert.equal(localePrefix('en', site), '');
  const m = makeModel({ ...input(), posts:[post('broken')], pages:[] }, site);
  assert.ok(m.byPath.has('/zh/broken/'));
  assert.ok(!m.byPath.has('/en/'));
});
test('default URLs remain, translations and alternate URLs are generated', () => {
  const site = config(true);
  const m = makeModel(input(), site);
  assert.equal(m.byPath.get('/zh/broken/')?.kind,'post');
  assert.equal(m.byPath.get('/en/english/damaged-video/')?.locale,'en');
  assert.equal(m.byPath.get('/es/espanol/video-danado/')?.locale,'es');
  assert.equal(m.byPath.get('/en/')?.kind,'home');
  assert.deepEqual(m.byPath.get('/zh/broken/')?.alternates, {
    'zh-TW':'/zh/broken/', en:'/en/english/damaged-video/', es:'/es/espanol/video-danado/',
  });
  assert.equal(m.byPath.get('/about/')?.alternates?.en, undefined);
  assert.equal(m.byPath.get('/about/')?.alternates?.es, '/es/acerca/');
  assert.equal(languageEnabled(site), true);
});
test('bad source groups, disabled locales and duplicate translations fail closed', () => {
  const i = input();
  assert.throws(() => makeModel({...i, pages:[page('orphan',{ locale:'en',translationKey:'missing' })]},config(true)), /原稿/);
  assert.throws(() => makeModel({...i, pages:[...i.pages, page('bad',{locale:'en'})]},config(true)), /translationKey/);
  assert.throws(() => makeModel({...i, pages:[...i.pages, page('duplicate',{locale:'es',translationKey:'about'})]},config(true)), /語言重複/);
  assert.throws(() => makeModel({...i, posts:[...i.posts, post('other',{locale:'fr' as any})]},config(true)));
});
test('invalid locale configuration rejected; translations have their own identifiers', () => {
  assert.throws(()=>siteSchema.parse({ ...config(true), i18n:{enabled:true,locales:['en']} }),/預設語言/);
  assert.throws(()=>siteSchema.parse({ ...config(true), i18n:{enabled:true,locales:['zh-TW','en','en']} }),/不可重複/);
  assert.equal(t('es','switch',{language:'Español'}),'Cambiar a Español');
});
