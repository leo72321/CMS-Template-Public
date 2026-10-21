import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeModel, normalizePath, postPath, type Input, type Post, type Page } from '../src/lib/model';
import { postSchema, pageSchema, siteSchema } from '../src/lib/schema';
import { isPreview } from '../src/lib/settings';
import { checkURLs } from '../scripts/urls';
const site = siteSchema.parse({ domain: 'unit.example.org', title: '測試站', description: '網站說明', author: '少爺', indexable: true, media: { bucket: 'wordpress-cdn' } });
const post = (uid: string, extra: Record<string, unknown> = {}): Post => ({ kind: 'post', file: `${uid}.md`, body: '內容', data: postSchema.parse({ uid, title: uid, description: '文章說明', slug: uid, category: '測試', publishedAt: '2026-01-01', draft: false, ...extra }) });
const page = (uid: string, extra: Record<string, unknown> = {}): Page => ({ kind: 'page', file: `${uid}.md`, body: '內容', data: pageSchema.parse({ uid, title: uid, description: '頁面說明', slug: uid, draft: false, ...extra }) });
const input = (posts: Post[] = [], pages: Page[] = []): Input => ({ posts, pages, categories: [{ id: '測試', name: '測試分類', slug: '分類', description: '分類導讀', indexable: true }], tags: [{ id: '重點', name: '重點', slug: '重點', description: '編輯過的導讀', indexable: true }], topics: [] });
const build = (i: Input, options: Partial<typeof site> = {}, preview = false) => makeModel(i, { ...site, ...options }, new Date('2026-10-21T08:00:00Z'), preview);
test('缺少 draft 時保守地當成草稿，欄位拼錯會失敗', () => {
  const data = { uid: '草稿', title: '標題', description: '說明', slug: '網址', category: '測試', publishedAt: '2026-01-01' };
  assert.equal(postSchema.parse(data).draft, true);
  assert.throws(() => postSchema.parse({ ...data, drfat: false }));
});
test('拒絕穿越、百分比和不合法的日期', () => {
  for (const slug of ['../evil', 'aa/bb', 'aa%2Fbb', 'a b', '.']) assert.throws(() => post('a', { slug }));
  assert.throws(() => post('a', { publishedAt: '2026-02-30' }));
  assert.throws(() => post('a', { updatedAt: '2025-01-01' }));
  assert.throws(() => normalizePath('/%2e%2e/secret/'));
});
test('文章永久網址一律 /blog/，改標題或分類不改文章路徑', () => {
  const p = post('第一篇', { title: '改過的標題' });
  const i = input([p]);
  assert.equal(postPath(p, i.categories), '/blog/第一篇/');
  assert.equal(build(i).routes.find(r => r.kind === 'post')!.path, '/blog/第一篇/');
  assert.equal(build(i).redirects.get('/分類/第一篇/'), '/blog/第一篇/');
  i.categories[0].slug = '其他分類';
  assert.equal(postPath(p, i.categories), '/blog/第一篇/');
});
test('主要分類歸併到 /blog/，舊分類頁與文章網址都 301', () => {
  const i = input([post('a'), post('b')]);
  const m = build(i, { primaryBlogCategory: '測試' });
  assert.equal(m.byPath.has('/分類/'), false);
  assert.equal(m.redirects.get('/分類/'), '/blog/');
  assert.equal(m.redirects.get('/分類/a/'), '/blog/a/');
  assert.equal(m.byPath.get('/blog/a/')?.kind, 'post');
  assert.equal(m.byPath.get('/blog/')?.kind, 'blog');
  assert.throws(() => build(i, { primaryBlogCategory: '不存在' }), /找不到文章首頁指定分類/);
  assert.throws(() => build(i, { primaryBlogCategory: '測試', blogIndexable: false }), /blogIndexable|主要分類/);
  assert.equal(build(i, { blogIndexable: false }).byPath.get('/blog/')!.noindex, true);
});
test('不同分類同名 slug 必須攔截，避免 /blog/ 路徑碰撞', () => {
  const i = input([post('a')]);
  i.categories.push({ id: '第二類', name: '其他分類', slug: '其他', description: '其他主題', indexable: true });
  i.posts.push(post('b', { slug: 'a', category: '第二類' }));
  assert.throws(() => build(i), /網址衝突/);
});
test('草稿與未到台灣發布日的文章都不產生路由', () => {
  const model = build(input([post('草稿', { draft: true }), post('明天', { publishedAt: '2026-10-22' }), post('今天', { publishedAt: '2026-10-21' })]));
  assert.deepEqual(model.posts.map(p => p.data.uid), ['今天']);
  assert.equal(model.routes.some(r => r.path.includes('明天')), false);
});
test('台灣日期跨日以 +08:00 計算', () => {
  const i = input([post('跨日', { publishedAt: '2026-10-22' })]);
  assert.equal(makeModel(i, site, new Date('2026-10-21T15:59:00Z')).posts.length, 0);
  assert.equal(makeModel(i, site, new Date('2026-10-21T16:00:00Z')).posts.length, 1);
});
test('獨立頁面不能與分類、系統入口或其他頁面撞網址', () => {
  assert.throws(() => build(input([], [page('撞分類', { slug: '分類' })])), /網址衝突/);
  assert.throws(() => build(input([], [page('撞索引', { slug: 'blog' })])), /網址衝突/);
  assert.throws(() => build(input([post('a'), post('b', { slug: 'a' })])), /網址衝突/);
});
test('未知分類、標籤、主題會讓發布失敗', () => {
  assert.throws(() => build(input([post('a', { category: '亂加' })])), /未知分類/);
  assert.throws(() => build(input([post('a', { tags: ['亂加'] })])), /未知標籤/);
  assert.throws(() => build(input([post('a', { topic: '亂加' })])), /未知主題/);
});
test('範例和 noindex 文章不計入分類標籤的開放索引門檻', () => {
  const i = input([post('a', { tags: ['重點'] }), post('b', { tags: ['重點'], sample: true }), post('c', { tags: ['重點'], noindex: true })]);
  const m = build(i);
  assert.equal(m.byPath.get('/tag/重點/')!.noindex, true);
  assert.equal(m.byPath.get('/分類/')!.noindex, true);
  i.posts.push(post('d', { tags: ['重點'] }));
  assert.equal(build(i).byPath.get('/tag/重點/')!.noindex, false);
});
test('整站開關、範例內容和 Cloudflare 預覽均保護索引', () => {
  assert.ok(build(input([post('a')]), { indexable: false }).routes.every(r => r.noindex));
  assert.ok(build(input([post('a')]), {}, true).routes.every(r => r.noindex));
  assert.equal(build(input([post('a', { sample: true })])).byPath.get('/blog/a/')!.noindex, true);
  assert.equal(isPreview({ CF_PAGES: '1', CF_PAGES_BRANCH: 'feature' }, 'main'), true);
  assert.equal(isPreview({ CF_PAGES: '1' }, 'main'), true);
  assert.equal(isPreview({ CF_PAGES: '1', CF_PAGES_BRANCH: 'main' }, 'main'), false);
});
test('分頁不會把大量文章一次塞進 HTML，後續分頁不索引', () => {
  const m = build(input([post('a'), post('b'), post('c')]), { pageSize: 2 });
  assert.equal(m.byPath.get('/blog/')!.posts!.length, 2);
  assert.equal(m.byPath.get('/blog/page/2/')!.posts!.length, 1);
  assert.equal(m.byPath.get('/blog/page/2/')!.noindex, true);
});
test('新文章加入後，舊文章的相關推薦同步重算，沒有標籤則不亂配', () => {
  const i = input([post('舊', { tags: ['重點'] })]);
  assert.equal(build(i).related(i.posts[0]).length, 0);
  i.posts.push(post('新', { tags: ['重點'], publishedAt: '2026-10-01' }));
  assert.equal(build(i).related(i.posts[0])[0].data.uid, '新');
  assert.equal(build(i).related(i.posts[0]).some(p => p.data.uid === '舊'), false);
});
test('公開的主題子文章必須有公開中心頁', () => {
  const i = input([post('a', { topic: '主題' })], [page('中心', { draft: true })]);
  i.topics = [{ id: '主題', name: '主題', hub: '中心', description: '' }];
  assert.throws(() => build(i), /中心頁仍是草稿/);
  i.pages[0].data.draft = false;
  assert.equal(build(i).posts.length, 1);
});
test('既有網址更動必須有 301，標題改字不需轉址', () => {
  const before = { urls: { a: '/分類/a/' }, redirects: {} };
  assert.throws(() => checkURLs(build(input([post('a', { slug: 'b' })])), before), /aliases/);
  assert.doesNotThrow(() => checkURLs(build(input([post('a', { title: '新標題' })])), before));
  const m = build(input([post('a', { slug: 'b', aliases: ['/分類/a/'] })]));
  assert.equal(checkURLs(m, before).redirects['/分類/a/'], '/blog/b/');
});
test('舊轉址不可刪除，也不能與現有頁面衝突', () => {
  assert.throws(() => checkURLs(build(input([post('a')])), { urls: {}, redirects: { '/old/': '/分類/a/' } }), /不可遺失/);
  assert.throws(() => build(input([post('a', { aliases: ['/blog/'] })])), /轉址衝突/);
});
test('分類彙整頁改網址，也要留下 301', () => {
  const i = input([post('a')]);
  i.categories[0].slug = '新分類';
  const lock = { urls: { 'category:測試': '/分類/' }, redirects: {} };
  assert.throws(() => checkURLs(build(i), lock), /既有網址/);
  i.categories[0].aliases = ['/分類/'];
  assert.equal(checkURLs(build(i), lock).redirects['/分類/'], '/新分類/');
});
