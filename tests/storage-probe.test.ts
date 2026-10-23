import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetBucketAclCommand, GetObjectCommand, ListBucketsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { probeS3Storage } from '../scripts/lib/storage-probe';

const params = () => ({
  endpoint: 'https://s3.us-west-002.backblazeb2.com',
  region: 'us-west-002',
  domain: 'example.com',
  cdnBase: 'https://cdn.example.com/file/media/',
  accessKeyId: 'mock-access-id',
  secretAccessKey: 'mock-secret',
});
function mock(opts: { listDenied?: boolean; buckets?: string[]; publicAcl?: boolean; cdn?: boolean } = {}) {
  const seen: string[] = [];
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
      if (command instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => bytes } };
      throw new Error('Unknown mock command');
    },
  } as unknown as S3Client;
  const fetcher = (async () => new Response(opts.cdn === false ? 'Forbidden' : bytes, {
    status: opts.cdn === false ? 403 : 200,
  })) as typeof fetch;
  return { client, fetcher, seen };
}

test('能列桶時自動選唯一 Bucket，並實際上傳、S3 下載、CDN 讀回', async () => {
  const mocked = mock({ publicAcl: true });
  let planned = '';
  const result = await probeS3Storage({ ...params(), onBucketSelected: bucket => { planned = bucket; } }, mocked);
  assert.equal(result.bucket, 'media');
  assert.equal(planned, 'media');
  assert.equal(result.bucketAccess, 'public-acl');
  assert.equal(result.s3Read, true);
  assert.equal(result.cdnRead, true);
  assert.match(result.testUrl, /^https:\/\/cdn\.example\.com\/file\/media\/example\.com\/\.cms-healthcheck\//);
  assert.deepEqual(mocked.seen, ['ListBucketsCommand', 'GetBucketAclCommand', 'PutObjectCommand', 'GetObjectCommand']);
});

test('B2 單桶權限不能 ListBuckets 也能在指定 Bucket 上傳與下載', async () => {
  const mocked = mock({ listDenied: true, cdn: false });
  const result = await probeS3Storage({ ...params(), bucket: 'one-bucket' }, mocked);
  assert.equal(result.listedBuckets, null);
  assert.equal(result.bucket, 'one-bucket');
  assert.equal(result.bucketAccess, 'private-acl');
  assert.equal(result.s3Read, true);
  assert.equal(result.cdnRead, false);
});

test('多個 Bucket 不隨機選擇，已存在媒體的遷移禁令必須先於 PutObject', async () => {
  const many = mock({ buckets: ['one', 'two'] });
  await assert.rejects(probeS3Storage(params(), many), /多個 Bucket/);
  assert.equal(many.seen.includes('PutObjectCommand'), false);
  const protectedSite = mock();
  await assert.rejects(probeS3Storage({ ...params(), onBucketSelected: () => {
    throw new Error('已有媒體收據，拒絕遷移');
  } }, protectedSite), /拒絕遷移/);
  assert.equal(protectedSite.seen.includes('PutObjectCommand'), false);
});
