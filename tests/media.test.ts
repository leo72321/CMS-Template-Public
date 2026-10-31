import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { prepareMedia } from '../scripts/lib/media';
import { cmsMediaPath, assertCmsMediaPath } from '../scripts/lib/media-path';
import { uploadB2, type Upload } from '../scripts/lib/b2';
import { siteSchema } from '../src/lib/schema';
const site = siteSchema.parse({ domain: 'site.example.org', title: '測試', description: '說明', author: '作者', media: { bucket: 'wordpress-cdn' } });
test('圖片及 OG 只引用原始檔，不重新編碼、不產生尺寸版本，中文路徑只編碼一次', async () => {
  const image = await sharp({ create: { width: 1600, height: 900, channels: 4, background: '#287655' } }).png().toBuffer();
  const output = await prepareMedia(image, site, '/cms/分類/文章/', 'cover', true);
  assert.equal(output.length, 1);
  assert.equal(output[0].contentType, 'image/png');
  assert.equal(output[0].width, 1600);
  assert.equal(output[0].height, 900);
  assert.ok(output[0].objectName.endsWith('.png'));
  assert.deepEqual(output[0].bytes, image);
  assert.ok(output[0].objectName.startsWith('site.example.org/cms/分類/文章/'));
  assert.ok(output[0].url.startsWith('https://cdn.site.example.org/file/wordpress-cdn/site.example.org/cms/%E5%88%86%E9%A1%9E/'));
  assert.deepEqual((await prepareMedia(image, site, '/cms/分類/文章/', 'cover', true)).map(o => o.url), output.map(o => o.url));
});
test('原始 GIF 不會被截為首格；內容雜湊隨圖片變更', async () => {
  const image = (background: string) => sharp({ create: { width: 300, height: 200, channels: 3, background } }).png().toBuffer();
  const a = await prepareMedia(await image('#ffffff'), site, '/cms/分類/文章/', '圖', false);
  const b = await prepareMedia(await image('#000000'), site, '/cms/分類/文章/', '圖', false);
  assert.equal(a.length, 1); assert.equal(a[0].width, 300); assert.notEqual(a[0].url, b[0].url);
  assert.equal(a[0].contentType, 'image/png');
});
test('新圖片及附件只能使用獨立 cms 目錄，不接受 WordPress uploads 或跨站路徑', async () => {
  assert.equal(cmsMediaPath('cars', 'wp-2885'), '/cms/cars/wp-2885/');
  assert.equal(assertCmsMediaPath('/cms/blog/wp-123/'), 'cms/blog/wp-123');
  assert.throws(() => assertCmsMediaPath('/wp-content/uploads/2023/'), /cms\/|專用目錄/);
  assert.throws(() => assertCmsMediaPath('/cms/blog/../'), /專用目錄/);
  assert.throws(() => assertCmsMediaPath('/another.com/cms/blog/wp-123/'), /專用目錄/);
  const data = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#aabbcc' } }).png().toBuffer();
  await assert.rejects(prepareMedia(data, site, '/blog/wp-123/', 'image', false), /專用目錄/);
});
const bytes = Buffer.from('image-test-data');
const digest = createHash('sha1').update(bytes).digest('hex');
const item: Upload = { bytes, objectName: 'site.example.org/分類/cover.webp', contentType: 'image/webp', width: 800, height: 450, url: 'https://cdn.site.example.org/cover.webp' };
function mock(options: { sha?: string; cdn?: number; capability?: string[]; prefix?: string; api?: string } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url); calls.push({ url: path, init });
    if (path.includes('b2_authorize_account')) return Response.json({ authorizationToken: 'auth-token', apiInfo: { storageApi: { apiUrl: options.api ?? 'https://api001.backblazeb2.com', allowed: { capabilities: options.capability ?? ['writeFiles'], buckets: [{ id: 'bucket', name: 'wordpress-cdn' }], namePrefix: options.prefix } } } });
    if (path.includes('b2_get_upload_url')) return Response.json({ uploadUrl: 'https://pod-001.backblazeb2.com/upload', authorizationToken: 'upload-token' });
    if (path.includes('/upload')) return Response.json({ fileName: item.objectName, contentSha1: options.sha ?? digest, contentLength: bytes.length, fileId: 'file-id' });
    return new Response(null, { status: options.cdn ?? 200, headers: { 'content-type': 'image/webp' } });
  }) as typeof fetch;
  return { fetcher, calls };
}
const credentials = { keyId: 'test-id', key: 'test-secret', bucketId: 'bucket' };
test('B2 v4 上傳成功後只 HEAD 檢查連結，不下載圖片', async () => {
  const { fetcher, calls } = mock();
  const receipts = await uploadB2([item], credentials, fetcher);
  assert.equal(receipts[0].sha1, digest); assert.equal(receipts[0].fileId, 'file-id');
  assert.ok(receipts[0].verifiedAt); assert.equal(calls.length, 4);
  assert.equal(calls.at(-1)?.init?.method, 'HEAD');
  assert.equal((calls[2].init!.headers as Record<string, string>)['X-Bz-File-Name'], 'site.example.org/%E5%88%86%E9%A1%9E/cover.webp');
  assert.equal((calls[2].init!.headers as Record<string, string>)['Content-Length'], String(bytes.length));
  assert.equal(JSON.stringify(receipts).includes('test-secret'), false);
});
test('B2 上傳 API 回傳錯誤或 CDN HEAD 404 時不產生成功收據', async () => {
  await assert.rejects(uploadB2([item], credentials, mock({ sha: 'bad' }).fetcher), /校驗碼不一致/);
  await assert.rejects(uploadB2([item], credentials, mock({ cdn: 404 }).fetcher), /HTTP 404/);
});
test('權限與前綴不足時提前擋下，不洩漏金鑰', async () => {
  await assert.rejects(uploadB2([item], credentials, mock({ capability: [] }).fetcher), /writeFiles/);
  await assert.rejects(uploadB2([item], credentials, mock({ prefix: 'another-site/' }).fetcher), /前綴/);
});
test('B2 回傳非官方 API 位址時拒絕傳送授權資料', async () => {
  const { fetcher, calls } = mock({ api: 'https://attacker.example' });
  await assert.rejects(uploadB2([item], credentials, fetcher), /不受信任/);
  assert.equal(calls.length, 1);
});
