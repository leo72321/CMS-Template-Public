import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStorageConnection, resolveStorageForm, normalizeCdnPrefix } from '../src/lib/storage-providers';
import { planStorageConfiguration } from '../scripts/lib/storage-config';
import { siteSchema } from '../src/lib/schema';
import { mediaBase } from '../src/lib/settings';

const raw = () => ({ domain: 'holeboom.com', title: '站名', description: '說明',
  author: '作者', indexable: true, media: { bucket: 'wordpress-cdn', cdnBase: '' } });
const form = (changes: Record<string,string> = {}) => ({
  provider: 'b2' as const,
  region: 'us-west-004',
  bucket: 'wordpress-cdn',
  cdnUrl: 'https://cdn.holeboom.com/file/wordpress-cdn/',
  ...changes,
});

test('九種 S3 選擇共用相容 API，主要供應商依 Region 預填 Endpoint', () => {
  for (const [provider, region, endpoint] of [
    ['b2','us-west-004','https://s3.us-west-004.backblazeb2.com'],
    ['aws-s3','ap-east-1','https://s3.ap-east-1.amazonaws.com'],
    ['aws-s3','cn-north-1','https://s3.cn-north-1.amazonaws.com.cn'],
    ['wasabi','eu-central-1','https://s3.eu-central-1.wasabisys.com'],
    ['digitalocean','sgp1','https://sgp1.digitaloceanspaces.com'],
    ['hetzner','fsn1','https://fsn1.your-objectstorage.com'],
    ['scaleway','fr-par','https://s3.fr-par.scw.cloud'],
  ] as const) {
    assert.equal(resolveStorageConnection({ provider, region }).endpoint, endpoint, provider);
  }
  assert.equal(resolveStorageConnection({ provider: 'r2', accountId: 'a'.repeat(32) }).endpoint,
    'https://' + 'a'.repeat(32) + '.r2.cloudflarestorage.com');
  assert.equal(resolveStorageConnection({ provider: 'r2', endpoint:'https://abc.r2.cloudflarestorage.com' }).region, 'auto');
  assert.equal(resolveStorageConnection({ provider:'akamai',region:'us-lax',endpoint:'https://us-lax-4.linodeobjects.com' }).endpoint,
    'https://us-lax-4.linodeobjects.com');
  assert.equal(resolveStorageConnection({ provider:'other-s3',region:'us-east-1',endpoint:'https://s3.example.com' }).endpoint,
    'https://s3.example.com');
});

test('CDN 完整 HTTPS 前綴含 /file/桶名/，且新 S3 圖片路徑與舊 B2 URL 完全一致', () => {
  const legacy = siteSchema.parse(raw());
  assert.equal(mediaBase(legacy), 'https://cdn.holeboom.com/file/wordpress-cdn/holeboom.com/');
  const next = planStorageConfiguration(raw(), form(), 0);
  assert.equal(next.media.cdnBase, 'https://cdn.holeboom.com/file/wordpress-cdn/');
  assert.equal(mediaBase(next), mediaBase(legacy));
  assert.equal(resolveStorageForm(form(), 'holeboom.com').samplePublicUrl,
    'https://cdn.holeboom.com/file/wordpress-cdn/holeboom.com/.cms-healthcheck/sample.txt');
  assert.equal(normalizeCdnPrefix('https://cdn.example.com'), 'https://cdn.example.com/');
  assert.equal(normalizeCdnPrefix('https://bucket.sgp1.cdn.digitaloceanspaces.com/assets'),
    'https://bucket.sgp1.cdn.digitaloceanspaces.com/assets/');
});

test('已有媒體仍可在相同 B2 Bucket／CDN URL 下切換 Native 到 S3；不能偷換 Bucket/CDN/供應商', () => {
  const original = raw();
  const migrated = planStorageConfiguration(original, form(), 30);
  assert.equal(migrated.storage?.provider, 'b2');
  assert.throws(() => planStorageConfiguration(original, form({bucket:'wrong-bucket'}), 30), /已有媒體收據/);
  assert.throws(() => planStorageConfiguration(original, form({cdnUrl:'https://cdn.newsite.com/'}), 30), /已有媒體收據/);
  assert.throws(() => planStorageConfiguration(original,
    form({provider:'r2',region:'auto',accountId:'b'.repeat(32)}),30), /已有媒體收據/);
  assert.doesNotThrow(() => planStorageConfiguration(migrated, form(), 30));
  assert.throws(() => planStorageConfiguration(migrated, form({region:'us-east-005'}), 30), /已有媒體收據/);
});

test('CDN URL 錯誤時拒絕，不能把 Secrets、query、內網或惡意路徑帶進圖片公開 URL', () => {
  const urls = [
    'http://cdn.example.com/', 'https://user:password@cdn.example.com/',
    'https://cdn.example.com/?secret=abc', 'https://cdn.example.com/#frag',
    'https://localhost/', 'https://192.168.1.5/bucket/',
    'https://cdn.example.com/%2e%2e/private',
    'https://cdn.example.com/../private',
    'https://cdn.example.com//file/bucket/',
  ];
  for (const url of urls) assert.throws(() => normalizeCdnPrefix(url), /CDN URL/);
  assert.throws(() => planStorageConfiguration(raw(), form({cdnUrl:''}),0), /CDN URL/);
  assert.throws(() => planStorageConfiguration(raw(), form({endpoint:'https://evil.com/private'}),0), /S3 Endpoint/);
  assert.throws(() => planStorageConfiguration(raw(), form({endpoint:'https://user:pass@s3.example.com'}),0), /S3 Endpoint/);
  assert.throws(() => planStorageConfiguration(raw(), form({provider:'other-s3',endpoint:''}),0), /S3 Endpoint/);
  assert.throws(() => planStorageConfiguration(raw(), form({provider:'r2',region:'auto',accountId:'notid'}),0), /R2 Account ID/);
  assert.throws(() => planStorageConfiguration(raw(), form({provider:'r2',region:'auto',accountId:''}),0), /Account ID/);
});

test('S3 切換只能改圖床設定，不影響站台 SEO／既有收錄／301；敏感金鑰絕不能寫入站台設定', () => {
  const source = raw();
  const next = planStorageConfiguration(source, form(), 0);
  assert.equal(next.indexable, true);
  assert.equal(next.sitemap.maxUrls, 200);
  assert.equal(next.redirectManagement.maxActive, 1950);
  assert.equal(next.domain,source.domain);
  assert.ok(!JSON.stringify(next).includes('S3_SECRET_ACCESS_KEY'));
});
