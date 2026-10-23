import { parseArgs } from 'node:util';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { siteSchema } from '../src/lib/schema';
import { run } from './lib/content';
import { spawnSync } from 'node:child_process';
run(() => {
  const { values } = parseArgs({ options: { domain: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, author: { type: 'string' }, gtm: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('用法：npm run site:init -- --domain 你的網域 [--title 站名] [--description 網站簡介] [--author 作者名稱] [--gtm GTM-XXXX]\n設定網域與選填資料；不會自動開啟索引，也不會清除既有文章。'); return; }
  if (!values.domain) throw new Error('請提供 --domain，例如 npm run site:init -- --domain example.org');
  const old = JSON.parse(readFileSync('site.config.json', 'utf8'));
  if (old.domain !== 'example.com' && old.domain !== values.domain && existsSync('content/media/manifest.json') && JSON.parse(readFileSync('content/media/manifest.json', 'utf8')).uploads.length) throw new Error('已有圖片的網站需要另做網域遷移，避免舊 CDN 和圖片路徑失聯。');
  const next = siteSchema.parse({ ...old, domain: values.domain, ...(values.title ? { title: values.title } : {}), ...(values.description ? { description: values.description } : {}), ...(values.author ? { author: values.author } : {}), ...(values.gtm !== undefined ? { gtmId: values.gtm } : {}) });
  writeFileSync('site.config.json', JSON.stringify(next, null, 2) + '\n');
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/reports.ts'], { stdio: 'inherit' });
  if (child.status !== 0) throw new Error('設定已儲存，但結構報表更新失敗，請執行 npm run docs:update。');
  console.log(`✓ 網域已設為 ${next.domain}，圖片預設使用 cdn.${next.domain}。索引保持原設定，正式發布前請檢查 indexable。`);
});
