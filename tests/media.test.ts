import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { prepareMedia } from '../scripts/lib/media';
import { uploadB2, type Upload } from '../scripts/lib/b2';
import { siteSchema } from '../src/lib/schema';
const site = siteSchema.parse({ domain: 'site.example.org', title: '測試', description: '說明', author: '作者', media: { bucket: 'wordpress-cdn' } });
test('圖片會產生三種 WebP 尺寸與分享圖片，中文路徑只編碼一次', async () => {
  const image = await sharp({ create: { width: 1600, height: 900, channels: 4, background: '#287655' } }).png().toBuffer();
  const output = await prepareMedia(image, site, '/分類/文章/', 'cover', true);
  assert.deepEqual(output.filter(o => o.contentType === 'image/webp').map(o => o.width), [480, 960, 1440]);
  assert.equal(output.at(-1)!.width, 1200); assert.equal(output.at(-1)!.height, 630);
  assert.ok(output[0].objectName.startsWith('site.example.org/分類/文章/'));
  assert.ok(output[0].url.startsWith('https://cdn.site.example.org/file/wordpress-cdn/site.example.org/%E5%88%86%E9%A1%9E/'));
  assert.deepEqual((await prepareMedia(image, site, '/分類/文章/', 'cover', true)).map(o => o.url), output.map(o => o.url));
});
test('小圖不放大，內容雜湊會隨圖片內容變更', async () => {
  const image = (background: string) => sharp({ create: { width: 300, height: 200, channels: 3, background } }).png().toBuffer();
  const a = await prepareMedia(await image('#ffffff'), site, '/分類/文章/', '圖', false);
  const b = await prepareMedia(await image('#000000'), site, '/分類/文章/', '圖', false);
  assert.equal(a.length, 1); assert.equal(a[0].width, 300); assert.notEqual(a[0].url, b[0].url);
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
