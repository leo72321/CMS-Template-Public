import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { siteSchema } from '../src/lib/schema';

const env = (key: string) => (process.env['INIT_' + key] || '').trim();
const domain = env('DOMAIN').toLowerCase();
const cdn = env('CDN').toLowerCase();
const endpoint = env('ENDPOINT');
const region = env('REGION');
const bucket = env('BUCKET');
if (!/^(?=.{4,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain) || domain.split('.').some(s => s.startsWith('-') || s.endsWith('-'))) throw Error('正式網域格式不正確');
if (!/^(?=.{4,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(cdn) || cdn === domain || !cdn.endsWith('.' + domain)) throw Error('CDN 必須是正式網域底下的子網域，例如 cdn.' + domain);
const u = new URL(endpoint);
if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('S3 API 端點必須是 HTTPS 主機網址，不可包含金鑰、路徑或查詢參數');
if (!/^[a-zA-Z0-9_-]{1,64}$/.test(region)) throw Error('S3 region 格式錯誤');
if (!/^[a-zA-Z0-9.-]{3,63}$/.test(bucket) || bucket.includes('..')) throw Error('儲存桶名稱格式錯誤');
const old = JSON.parse(readFileSync('site.config.json', 'utf8'));
if (old.domain !== 'example.com' && old.domain !== domain) throw Error('已初始化的網站禁止直接改網域，請走遷移程序');
const manifest = JSON.parse(readFileSync('content/media/manifest.json', 'utf8'));
if (manifest.uploads?.length && (old.media.bucket !== bucket || old.media.cdnBase !== 'https://' + cdn + '/')) throw Error('已有圖片，不可直接更換儲存桶或 CDN，請先進行圖片遷移');
const next = siteSchema.parse({
  ...old, domain, title: env('TITLE'), description: env('DESCRIPTION'), author: env('AUTHOR'),
  media: { ...old.media, bucket, cdnBase: 'https://' + cdn + '/' },
  storage: { provider: env('STORAGE'), endpoint: u.origin, region },
});
writeFileSync('site.config.json', JSON.stringify(next, null, 2) + '\n');
const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/reports.ts'], { stdio: 'inherit' });
if (result.status !== 0) throw Error('設定已寫入，但網站結構報表產生失敗');
console.log('網站設定已產生。注意：CDN DNS、儲存桶權限及 S3 金鑰必須另外設定；此步驟不會上傳圖片。');
