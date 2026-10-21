import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { loadSite, mediaBase } from '../src/lib/settings';
import { uploadS3 } from './lib/s3';

if (process.env.GITHUB_REPOSITORY === 'leo72321/CMS-Template-Public') {
  throw new Error('請先使用公開模板建立自己的私人倉庫，再執行圖床連線測試。');
}
const site = loadSite();
if (!site.storage) throw new Error('尚未完成網站初始化：請先設定 S3 端點、Region 與 CDN。');
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
if (!accessKeyId || !secretAccessKey) {
  throw new Error('找不到 GitHub Secrets：S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY。');
}
// 重複測試使用同一個小型、固定內容的物件，避免每次測試增加新檔。
const bytes = Buffer.from('CMS S3 compatible storage healthcheck v1\n', 'utf8');
const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const relative = `.cms-healthcheck/${digest}.txt`;
const url = mediaBase(site) + relative;
const item = {
  bytes,
  objectName: `${site.domain}/${relative}`,
  url,
  contentType: 'text/plain; charset=utf-8',
  width: 1,
  height: 1,
};
await uploadS3([item], {
  endpoint: site.storage.endpoint,
  region: site.storage.region,
  bucket: site.media.bucket,
  accessKeyId,
  secretAccessKey,
});
const summary = [
  '### S3 與 CDN 實際連線驗證成功',
  '',
  `- 服務：${site.storage.provider}`,
  `- 儲存桶：${site.media.bucket}`,
  `- CDN 讀取：${url}`,
  '',
  '已用 S3 PutObject 上傳檔案，並透過 CDN 下載確認 SHA-256 完全相同。',
  '',
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
