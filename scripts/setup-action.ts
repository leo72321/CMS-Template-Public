import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { siteSchema } from '../src/lib/schema';
import { isValidDomain } from '../src/lib/storage-providers';

if (process.env.GITHUB_REPOSITORY === 'leo72321/CMS-Template-Public') {
  throw new Error('請先使用公開模板建立自己的私人倉庫，再執行初始化。');
}
const input = (key: string) => (process.env['INIT_' + key] ?? '').trim();
const domain = input('DOMAIN').toLowerCase();
if (!isValidDomain(domain)) {
  throw new Error('正式網站網域格式錯誤。');
}
const previousText = readFileSync('site.config.json','utf8');
const raw = JSON.parse(previousText);
if (raw.domain !== 'example.com' && raw.domain !== domain) {
  throw new Error('已初始化網站不可直接改變正式網域；請使用正式網域遷移流程。');
}
const manifest = JSON.parse(readFileSync('content/media/manifest.json','utf8')) as { uploads?: unknown[] };
if (!Array.isArray(manifest.uploads)) throw new Error('媒體清單格式不正確。');
if (manifest.uploads.length && raw.domain !== domain) {
  throw new Error('已有媒體收據時禁止直接更換網站網域，避免 CDN 物件路徑失效。');
}
const next = siteSchema.parse({
  ...raw, domain, title: input('TITLE'), description: input('DESCRIPTION'), author: input('AUTHOR'),
});
writeFileSync('site.config.json', JSON.stringify(next,null,2)+'\n');
const result=spawnSync(process.execPath,['--import','tsx','scripts/reports.ts'],{stdio:'inherit'});
if(result.status!==0){
  writeFileSync('site.config.json',previousText);
  throw new Error('網站報表更新失敗；設定已還原，未提交 Git。');
}
console.log('✓ 已建立網站基本資訊：'+next.domain);
console.log('下一步：Actions → 圖床設定｜S3 一站式驗證與套用；選供應商＋機房、Bucket 和 CDN，先設定 Secrets，Run 會驗證 S3 與 CDN 後才儲存。');
