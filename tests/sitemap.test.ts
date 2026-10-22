import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSitemapParts, renderSitemapIndex, renderSitemapPart } from '../src/lib/sitemap';
import { postSchema, siteSchema } from '../src/lib/schema';
import type { Route } from '../src/lib/model';

const route = (kind: Route['kind'], path: string, noindex = false): Route => ({
  kind, path, title: path, description: '測試', noindex,
});
const base = siteSchema.parse({ domain: 'unit.example.org', title: '站', description: '說明',
  author: '作者', media: { bucket: 'media' } });

test('Sitemap 預設每份 200 URL，允許自訂 1–50000，不影響前台 pageSize', () => {
  assert.equal(base.sitemap.maxUrls, 200);
  assert.equal(siteSchema.parse({ ...base, sitemap: { maxUrls: 500 } }).sitemap.maxUrls, 500);
  assert.throws(() => siteSchema.parse({ ...base, sitemap: { maxUrls: 0 } }));
  assert.throws(() => siteSchema.parse({ ...base, sitemap: { maxUrls: 50001 } }));
  assert.throws(() => siteSchema.parse({ ...base, sitemap: { maxUrls: 1.5 } }));
  assert.equal(base.pageSize, 12);
});

test('5,000 篇 POST 自动分成 25 份，每份最多 200；PAGE／分類／TAG 不混在 POST', () => {
  const posts = Array.from({ length: 5000 }, (_, i) => route('post', '/iso/article-' + String(i).padStart(5, '0') + '/'));
  const paths = [...posts, route('home', '/'), route('page', '/about/'), route('blog', '/blog/'),
    route('category', '/iso/'), route('tag', '/tag/example/')];
  const parts = buildSitemapParts(paths, 200);
  const postParts = parts.filter(p => p.kind === 'posts');
  assert.equal(postParts.length, 25);
  assert.ok(postParts.every(p => p.routes.length === 200));
  assert.equal(postParts[0].filename, 'posts-001.xml');
  assert.equal(postParts[24].filename, 'posts-025.xml');
  assert.deepEqual(parts.filter(p => p.kind === 'pages').flatMap(p => p.routes.map(r => r.path)), ['/', '/about/', '/blog/']);
  assert.deepEqual(parts.filter(p => p.kind === 'categories').flatMap(p => p.routes.map(r => r.path)), ['/iso/']);
  assert.deepEqual(parts.filter(p => p.kind === 'tags').flatMap(p => p.routes.map(r => r.path)), ['/tag/example/']);
  const index = renderSitemapIndex(parts, 'unit.example.org');
  assert.match(index, /<sitemapindex/);
  assert.equal((index.match(/<sitemap><loc>/g) ?? []).length, 28);
  assert.match(index, /https:\/\/unit.example.org\/sitemaps\/posts-025.xml/);
});

test('201 篇只新增第二份子 Sitemap；排序與內容固定，不產生空白檔案', () => {
  const routes = Array.from({ length: 201 }, (_, i) => route('post', '/post-' + String(201-i).padStart(4, '0') + '/'));
  const parts = buildSitemapParts(routes, 200);
  assert.deepEqual(parts.map(x => x.routes.length), [200, 1]);
  assert.equal(parts[0].routes[0].path, '/post-0001/');
  assert.equal(parts[1].routes[0].path, '/post-0201/');
  assert.equal(buildSitemapParts([], 200).length, 0);
});

test('草稿／preview／noindex 路由不洩漏至 Sitemap，無可索引內容時輸出空 urlset', () => {
  const parts = buildSitemapParts([route('post','/hidden/', true), route('page','/secret/', true)]);
  assert.equal(parts.length, 0);
  assert.equal(renderSitemapIndex(parts,'unit.example.org'),
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
});

test('POST 真正更新日 lastmod、中文 URL 只編碼一次，PAGE 不偽造日期', () => {
  const post: Route = { ...route('post', '/文章/個資法/'),
    document: { kind: 'post', file: 'x.md', body: 'text', data: postSchema.parse({
      uid:'id', title:'文章', description:'說明', category:'測試', slug:'個資法',
      publishedAt:'2026-01-01', updatedAt:'2026-10-20', draft: false
    }) } };
  const parts = buildSitemapParts([post,route('page','/about/')]);
  const xml = renderSitemapPart(parts.find(p=>p.kind==='posts')!, 'unit.example.org');
  assert.match(xml, /%E6%96%87%E7%AB%A0/);
  assert.match(xml, /<lastmod>2026-10-20<\/lastmod>/);
  assert.doesNotMatch(xml, /%25E6/);
  assert.doesNotMatch(renderSitemapPart(parts.find(p=>p.kind==='pages')!, 'unit.example.org'), /lastmod/);
});

test('超過 XML 網址數量與 Sitemap Index 份數必須阻擋，不默默漏資料', () => {
  assert.throws(() => buildSitemapParts([route('post','/one/')], 50001), /50000/);
  const tooMany = Array.from({ length: 50001 }, (_, i) => route('post','/a' + i + '/'));
  assert.throws(() => buildSitemapParts(tooMany, 1), /50,000 份/);
});
