import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { siteSchema } from '../src/lib/schema';
import { planStorageConfiguration } from './lib/storage-config';
import type { StorageForm } from '../src/lib/storage-providers';

if (process.env.GITHUB_REPOSITORY === 'leo72321/CMS-Template-Public') {
  throw new Error('請先使用公開模板複製成自己的私人倉庫，再執行初始化精靈。');
}
const env = (key: string) => (process.env['INIT_' + key] || '').trim();
const domain = env('DOMAIN').toLowerCase();
if (!/^(?=.{4,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain) ||
    domain.split('.').some(x => x.startsWith('-') || x.endsWith('-'))) {
  throw new Error('正式網站網域格式不正確。');
}
const raw = JSON.parse(readFileSync('site.config.json', 'utf8'));
if (raw.domain !== 'example.com' && raw.domain !== domain) {
  throw new Error('已初始化的網站禁止直接修改網域，請走正式遷移流程。');
}
const manifest = JSON.parse(readFileSync('content/media/manifest.json', 'utf8')) as { uploads?: unknown[] };
if (!Array.isArray(manifest.uploads)) throw new Error('媒體清單格式不正確。');
const basic = siteSchema.parse({ ...raw, domain, title: env('TITLE'), description: env('DESCRIPTION'), author: env('AUTHOR') });
const form: StorageForm = {
  provider: env('STORAGE') as StorageForm['provider'],
  region: env('REGION'),
  endpoint: env('ENDPOINT'),
  accountId: env('ACCOUNT_ID'),
  bucket: env('BUCKET'),
  cdnUrl: env('CDN_URL'),
};
const next = planStorageConfiguration(basic, form, manifest.uploads.length);
writeFileSync('site.config.json', JSON.stringify(next, null, 2) + '\n');
const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/reports.ts'], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('設定已寫入，但網站結構報表產生失敗；CI 將停止提交。');
console.log('✓ 網站初始化成功；圖片儲存服務：' + next.storage?.provider);
console.log('✓ S3 Endpoint：' + next.storage?.endpoint);
console.log('✓ CDN URL 前綴：' + next.media.cdnBase);
console.log('此流程不蒐集任何 S3 金鑰；請在私人倉庫建立 S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY Secrets。');
