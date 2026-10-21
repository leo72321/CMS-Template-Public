import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { siteSchema } from '../src/lib/schema';
import { mediaBase } from '../src/lib/settings';
import { uploadS3 } from '../scripts/lib/s3';

const site = (withStorage = true) => siteSchema.parse({
  domain: 'example.com', title: '測試網站', description: '測試說明', author: '測試作者',
  media: { bucket: 'cms-media', cdnBase: withStorage ? 'https://cdn.example.com/' : '' },
  ...(withStorage ? { storage: { provider: 'b2', endpoint: 'https://s3.us-west-004.backblazeb2.com', region: 'us-west-004' } } : {}),
});

test('S3 圖床 CDN 路徑對齊實際物件 key，舊 B2 站不改路徑', () => {
  assert.equal(mediaBase(site()), 'https://cdn.example.com/example.com/');
  assert.equal(mediaBase(site(false)), 'https://cdn.example.com/file/cms-media/example.com/');
});

test('S3 網站沒有 CDN 或含有金鑰的端點不得通過設定驗證', () => {
  const valid = site();
  assert.throws(() => siteSchema.parse({ ...valid, media: { bucket: 'cms-media', cdnBase: '' } }), /CDN/);
  assert.throws(() => siteSchema.parse({ ...valid, storage: { provider: 'b2', endpoint: 'https://user:secret@s3.example.com/', region: 'auto' } }), /S3/);
  assert.throws(() => siteSchema.parse({ ...valid, storage: { provider: 'r2', endpoint: 'https://s3.example.com/path', region: 'auto' } }), /S3/);
});

test('S3 PutObject 上傳後由 CDN 實際校驗下載內容，產生可追溯收據', async () => {
  const bytes = Buffer.from('Hello S3 and B2!');
  const key = 'example.com/blog/article/cover-abc.webp';
  const url = 'https://cdn.example.com/' + key;
  const calls: PutObjectCommand[] = [];
  const client = {
    send: async (command: PutObjectCommand) => { calls.push(command); return { ETag: '"etag"' }; },
  } as unknown as S3Client;
  const requested: string[] = [];
  const fetcher: typeof fetch = async (request) => {
    requested.push(String(request));
    return new Response(bytes, { status: 200 });
  };
  const receipts = await uploadS3([{
    bytes, objectName: key, url, contentType: 'image/webp', width: 100, height: 80,
  }], {
    endpoint: 'https://s3.us-west-004.backblazeb2.com',
    region: 'us-west-004',
    bucket: 'cms-media',
    accessKeyId: 'fake-key',
    secretAccessKey: 'fake-secret',
  }, fetcher, client);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.Bucket, 'cms-media');
  assert.equal(calls[0].input.Key, key);
  assert.equal(calls[0].input.ContentType, 'image/webp');
  assert.equal(calls[0].input.CacheControl, 'public, max-age=31536000, immutable');
  assert.deepEqual(requested, [url]);
  assert.equal(receipts[0].fileId, 'cms-media/' + key);
  assert.equal(receipts[0].bytes, bytes.length);
});

test('不合法的 S3 端點在執行任何上傳前就被拒絕', async () => {
  const client = { send: async () => { throw Error('不應觸發上傳'); } } as unknown as S3Client;
  await assert.rejects(uploadS3([], {
    endpoint: 'https://localhost/private', region: 'auto', bucket: 'media',
    accessKeyId: 'key', secretAccessKey: 'secret',
  }, fetch, client), /S3 端點/);
});
