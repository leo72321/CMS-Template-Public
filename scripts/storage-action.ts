import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { storageFormFromEndpointPreset } from '../src/lib/storage-endpoint-presets';
import { normalizeCdnPrefix, resolveStorageConnection } from '../src/lib/storage-providers';
import { planStorageConfiguration } from './lib/storage-config';
import { probeS3Storage, type StorageProbeResult } from './lib/storage-probe';
import type { Site } from '../src/lib/schema';

if (process.env.GITHUB_REPOSITORY === 'leo72321/CMS-Template-Public') {
  throw new Error('公開模板不可直接設定私人圖床，請先複製成自己的私人網站倉庫。');
}
const get = (field: string) => (process.env['STORAGE_' + field] ?? '').trim();
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
if (!accessKeyId || !secretAccessKey) {
  throw new Error('請先在私人倉庫 Actions Secrets 建立 S3_ACCESS_KEY_ID 和 S3_SECRET_ACCESS_KEY；不要填在表單。');
}
const previousText = readFileSync('site.config.json', 'utf8');
const raw = JSON.parse(previousText);
const manifestFile = 'content/media/manifest.json';
if (!existsSync(manifestFile)) throw new Error('找不到媒體清單：' + manifestFile);
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { uploads?: unknown[] };
if (!Array.isArray(manifest.uploads)) throw new Error('媒體清單格式不正確，拒絕更改設定。');

const form = storageFormFromEndpointPreset({
  preset: get('ENDPOINT_PRESET'),
  customProvider: get('CUSTOM_PROVIDER') || 'other-s3',
  endpoint: get('ENDPOINT'),
  region: get('REGION'),
  accountId: get('ACCOUNT_ID'),
  bucket: get('BUCKET'),
  cdnUrl: get('CDN_URL'),
});
const connection = resolveStorageConnection(form);
const cdnBase = normalizeCdnPrefix(form.cdnUrl);
let next: Site | undefined;
let result: StorageProbeResult;
try {
  result = await probeS3Storage({
    ...connection,
    bucket: form.bucket,
    preferredBucket: raw.media?.bucket,
    domain: raw.domain,
    cdnBase,
    accessKeyId,
    secretAccessKey,
    onBucketSelected: bucket => {
      // 驗證既有圖片安全約束，必須早於 S3 PutObject。
      next = planStorageConfiguration(raw, { ...form, bucket }, manifest.uploads!.length);
    },
  });
} catch (error) {
  console.error('圖床驗證失敗，未修改網站設定，也未向 GitHub 提交任何設定。');
  throw error;
}
const acl = result.bucketAccess === 'public-acl' ? 'ACL 顯示公開'
  : result.bucketAccess === 'private-acl' ? 'ACL 顯示私有'
    : '無法判定（服務商可能不支援 ACL 或金鑰無查詢權限）';
const summary = [
  '## 圖床連線實測結果',
  '',
  '- S3 供應商：' + connection.provider,
  '- S3 Endpoint：' + connection.endpoint,
  '- Bucket：' + result.bucket,
  '- 列桶結果：' + (result.listedBuckets === null ? '無列桶權限或服務不支援；已改為直接驗證指定桶'
    : result.listedBuckets.length + ' 個可列出的 Bucket'),
  '- Bucket 權限：' + acl + '（僅 ACL 資訊，不等於最終網際網路可見性）',
  '- S3 真實上傳：成功',
  '- CDN 圖片連結 HEAD：' + (result.cdnReachable ? '成功（不下載內容）' : '失敗'),
  '',
  '測試 URL：' + result.testUrl,
  '',
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
if (!result.cdnReachable) {
  throw new Error('S3 上傳成功，但 CDN 的 HEAD 連結檢查未通過。'
    + ' 若是私有 Bucket，需先設置有權限的 CDN／Worker 讀取代理；'
    + ' 若內容本身也需保密，現有靜態文章圖片模式不適用。已拒絕儲存設定。');
}
if (!next) throw new Error('內部錯誤：尚未確認可套用的儲存設定。');
writeFileSync('site.config.json', JSON.stringify(next, null, 2) + '\n');
const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/reports.ts'], { stdio: 'inherit' });
if (child.status !== 0) {
  writeFileSync('site.config.json', previousText);
  throw new Error('網站結構報表產生失敗，站台設定已還原，未提交 Git。');
}
console.log('✓ S3 上傳與 CDN HEAD 連結檢查成功；不下載檔案內容。接著跑網站驗收，成功才會提交設定。');
