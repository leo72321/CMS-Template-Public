import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { planStorageConfiguration } from './lib/storage-config';
import type { StorageForm } from '../src/lib/storage-providers';
import { mediaBase } from '../src/lib/settings';

if (process.env.GITHUB_REPOSITORY === 'leo72321/CMS-Template-Public') {
  throw new Error('請先用公版建立自己的私人倉庫，不能直接覆寫公開模板的圖床設定。');
}
const get = (field: string) => (process.env['STORAGE_' + field] ?? '').trim();
const raw = JSON.parse(readFileSync('site.config.json', 'utf8'));
const previousText = readFileSync('site.config.json', 'utf8');
const manifestFile = 'content/media/manifest.json';
if (!existsSync(manifestFile)) throw new Error('找不到媒體清單：' + manifestFile);
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { uploads?: unknown[] };
if (!Array.isArray(manifest.uploads)) throw new Error('媒體清單格式不正確，拒絕更改設定。');
const form: StorageForm = {
  provider: get('PROVIDER') as StorageForm['provider'],
  endpoint: get('ENDPOINT'),
  region: get('REGION'),
  accountId: get('ACCOUNT_ID'),
  bucket: get('BUCKET'),
  cdnUrl: get('CDN_URL'),
};
const next = planStorageConfiguration(raw, form, manifest.uploads.length);
writeFileSync('site.config.json', JSON.stringify(next, null, 2) + '\n');
const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/reports.ts'], { stdio: 'inherit' });
if (child.status !== 0) {
  writeFileSync('site.config.json', previousText);
  throw new Error('網站結構報表產生失敗；網站設定已還原，未提交 Git。');
}
console.log('✓ S3 儲存設定已驗證：' + next.storage?.provider);
console.log('✓ API Endpoint：' + next.storage?.endpoint);
console.log('✓ Region：' + next.storage?.region);
console.log('✓ Bucket：' + next.media.bucket);
console.log('✓ CDN 公開前綴：' + next.media.cdnBase);
console.log('✓ 測試檔 URL 範例：' + mediaBase(next) + '.cms-healthcheck/example.txt');
console.log('提醒：此精靈只寫入公開設定，不會讀取、寫入或印出任何 S3 API 金鑰。請在 Secrets 設定金鑰並另跑「圖床連線測試」。');
