import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetBucketAclCommand, ListBucketsCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { probeS3Storage } from '../scripts/lib/storage-probe';

const params = () => ({
  endpoint: 'https://s3.us-west-002.backblazeb2.com',
  region: 'us-west-002',
  domain: 'example.com',
  cdnBase: 'https://cdn.example.com/file/media/',
  accessKeyId: 'mock-access-id',
  secretAccessKey: 'mock-secret',
});

function mock(opts: { listDenied?: boolean; buckets?: string[]; publicAcl?: boolean; cdn?: boolean; htmlFallback?: boolean } = {}) {
  const seen: string[] = [];
  const methods: string[] = [];
  const client = {
    async send(command: unknown) {
      seen.push(command?.constructor.name ?? '');
      if (command instanceof ListBucketsCommand) {
        if (opts.listDenied) throw new Error('AccessDenied');
        return { Buckets: (opts.buckets ?? ['media']).map(Name => ({ Name })) };
      }
      if (command instanceof GetBucketAclCommand) return {
        Grants: opts.publicAcl ? [{ Grantee: { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' }, Permission: 'READ' }] : [],
      };
      if (command instanceof PutObjectCommand) return {};
      throw new Error('不可呼叫其他 API（尤其是 GetObject）。');
    },
  } as unknown as S3Client;
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method ?? 'GET');
    return new Response(null, { status: opts.cdn === false ? 403 : 200,
      headers: { 'content-type': opts.htmlFallback ? 'text/html' : 'text/plain' },
    });
  }) as typeof fetch;
  return { client, fetcher, seen, methods };
}

test('找到唯一 Bucket 後只上傳並做一次 CDN HEAD，不 GetObject、不下載', async () => {
  const mocked = mock({ publicAcl: true });
  let selected = '';
  const result = await probeS3Storage({ ...params(), onBucketSelected: bucket => { selected = bucket; } }, mocked);
  assert.equal(result.bucket, 'media');
  assert.equal(selected, 'media');
  assert.equal(result.bucketAccess, 'public-acl');
  assert.equal(result.cdnReachable, true);
  assert.match(result.testUrl, /^https:\/\/cdn\.example\.com\/file\/media\/example\.com\/\.cms-healthcheck\//);
  assert.deepEqual(mocked.seen, ['ListBucketsCommand', 'GetBucketAclCommand', 'PutObjectCommand']);
  assert.deepEqual(mocked.methods, ['HEAD']);
});

test('B2 單桶金鑰即使不能列桶也能檢查指定桶；CDN 403 不允許套用設定', async () => {
  const mocked = mock({ listDenied: true, cdn: false });
  const result = await probeS3Storage({ ...params(), bucket: 'one-bucket' }, mocked);
  assert.equal(result.listedBuckets, null);
  assert.equal(result.bucket, 'one-bucket');
  assert.equal(result.bucketAccess, 'private-acl');
  assert.equal(result.cdnReachable, false);
  assert.deepEqual(mocked.methods, ['HEAD']);
  assert.equal(mocked.seen.includes('PutObjectCommand'), true);
});

test('CDN 200 回傳 HTML 假物件不算連線成功', async () => {
  const result = await probeS3Storage(params(), mock({ htmlFallback: true }));
  assert.equal(result.cdnReachable, false);
});

test('多個 Bucket 不亂選，既有媒體禁止遷移必須早於 PutObject', async () => {
  const many = mock({ buckets: ['one', 'two'] });
  await assert.rejects(probeS3Storage(params(), many), /多個 Bucket/);
  assert.equal(many.seen.includes('PutObjectCommand'), false);
  const guarded = mock();
  await assert.rejects(probeS3Storage({ ...params(), onBucketSelected: () => {
    throw new Error('已有媒體收據，拒絕遷移');
  } }, guarded), /拒絕遷移/);
  assert.equal(guarded.seen.includes('PutObjectCommand'), false);
});


test('B2 自訂 CDN 優先：就算原生模式也啟用，不呼叫 B2 downloadUrl', async () => {
  const mocked = mock();
  let nativeCalled = false;
  const result = await probeS3Storage({ ...params(), useB2PublicUrl: true }, {
    ...mocked, b2Prefix: async () => { nativeCalled = true; return 'https://f002.backblazeb2.com/file/media/'; },
  });
  assert.equal(nativeCalled, false);
  assert.equal(result.cdnBase, params().cdnBase);
  assert.deepEqual(mocked.methods, ['HEAD']);
});

test('沒有自訂 CDN 時需手動開啟 B2 原生公開網址，不會自動改 Bucket ACL', async () => {
  const mocked = mock();
  let downloaded = 0;
  const input = { ...params(), cdnBase: '', useB2PublicUrl: true };
  const result = await probeS3Storage(input, { ...mocked, b2Prefix: async () => {
    downloaded++;
    return 'https://f002.backblazeb2.com/file/media/';
  } });
  assert.equal(downloaded, 1);
  assert.equal(result.cdnBase, 'https://f002.backblazeb2.com/file/media/');
  assert.match(result.testUrl, /^https:\/\/f002\.backblazeb2\.com\/file\/media\/example\.com\//);
  assert.equal(result.cdnReachable, true);
  const blocked = mock();
  await assert.rejects(probeS3Storage({ ...params(), cdnBase: '' }, blocked), /手動.*開啟/);
  assert.equal(blocked.seen.includes('PutObjectCommand'), false);
});
