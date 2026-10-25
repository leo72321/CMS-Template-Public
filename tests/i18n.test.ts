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

test('translated SEO metadata and changed translation URLs are protected', () => {
  const cfg = siteSchema.parse({
    ...config(true),
    i18n: { enabled:true, defaultLocale:'zh-TW', locales:['zh-TW','en','es'],
      metadata: { en: {title:'English brand',description:'English homepage'}, es: {title:'Marca',description:'Página principal'} } }
  });
  const m = makeModel(input(),cfg);
  assert.equal(m.byPath.get('/en/')?.title,'English brand');
  assert.equal(m.byPath.get('/en/')?.description,'English homepage');
  assert.equal(m.byPath.get('/en/')?.siteTitle,'English brand');
  const prior = {urls:{'broken-en':'/en/english/old-path/'},redirects:{}};
  const current = Object.fromEntries(m.routes.filter(r=>r.document).map(r=>[r.document!.data.uid,r.path]));
  assert.equal(current['broken-en'],'/en/english/damaged-video/');
  assert.notEqual(current['broken-en'], prior.urls['broken-en']);
  const es = m.byPath.get('/es/espanol/video-danado/');
  assert.equal(es?.alternates?.en,'/en/english/damaged-video/');
});


test('CMS locales are user-configurable, including regions, scripts and custom UI messages', () => {
  const cfg = siteSchema.parse({ ...config(true), i18n: {
    enabled: true, defaultLocale:'zh-TW',
    locales:['zh-TW','en','es','ja','fr','de','pt-br','zh-Hant-TW'],
    metadata:{ ja:{title:'日本のサイト', description:'日本語の紹介', label:'日本語'} },
    messages:{ja:{home:'ホーム', blog:'記事一覧'}},
  }});
  assert.deepEqual(cfg.i18n.locales, ['zh-TW','en','es','ja','fr','de','pt-BR','zh-Hant-TW']);
  assert.equal(localePrefix('ja',cfg),'/ja');
  assert.equal(localePrefix('pt-BR',cfg),'/pt-br');
  assert.equal(localePrefix('zh-Hant-TW',cfg),'/zh-hant-tw');
  assert.equal(t('ja','home',{},cfg),'ホーム');
  assert.equal(t('ja','blog',{},cfg),'記事一覧');
  assert.equal(t('fr','home',{},cfg),'Home');
  assert.equal(t('pt-BR','blog',{},cfg),'All articles');
  const i = input();
  i.pages.push(page('about-ja', {locale:'ja',translationKey:'about',title:'会社紹介',slug:'kaisha'}));
  i.pages.push(page('about-fr', {locale:'fr',translationKey:'about',title:'Présentation',slug:'presentation'}));
  i.pages.push(page('about-pt', {locale:'pt-BR',translationKey:'about',title:'Apresentação',slug:'apresentacao'}));
  const model = makeModel(i, cfg);
  assert.ok(model.byPath.has('/ja/kaisha/'));
  assert.ok(model.byPath.has('/fr/presentation/'));
  assert.ok(model.byPath.has('/pt-br/apresentacao/'));
  assert.equal(model.byPath.get('/ja/')?.siteTitle, '日本のサイト');
  assert.equal(model.byPath.get('/about/')?.alternates?.['pt-BR'], '/pt-br/apresentacao/');
});

test('invalid language identifiers and reserved prefixes reject without silently generating broken routes', () => {
  assert.throws(() => siteSchema.parse({
    ...config(true), i18n:{enabled:true,defaultLocale:'zh-TW',locales:['zh-TW','en_US']}
  }));
  assert.throws(() => siteSchema.parse({
    ...config(true), i18n:{enabled:true,defaultLocale:'zh-TW',locales:['zh-TW','blog']}
  }),/保留字/);
  assert.throws(() => siteSchema.parse({
    ...config(true), i18n:{enabled:true,defaultLocale:'zh-TW',locales:['zh-TW','pt-BR'],
      metadata:{'pt-br':{title:'Erro',description:'Erro'}}}
  }),/標準 BCP 47/);
  assert.throws(() => siteSchema.parse({
    ...config(true), i18n:{enabled:true,defaultLocale:'zh-TW',locales:['zh-TW','en','en']}
  }),/不可重複/);
});

test('new locale codes are valid even when the website is still single-language', () => {
  const cfg = siteSchema.parse({ domain:'unit.example.org', title:'Un sitio',
    description:'Descripción', author:'Autor',language:'pt-BR',media:{bucket:'media'},
  });
  assert.equal(cfg.language,'pt-BR');
  assert.equal(cfg.i18n.enabled,false);
  assert.equal(languageEnabled(cfg),false);
});
