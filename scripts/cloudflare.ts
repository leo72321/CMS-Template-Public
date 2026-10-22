import { writeFileSync } from 'node:fs';
import { readModel, run } from './lib/content';
import { encodePath } from '../src/lib/model';
run(() => {
  const model = readModel();
  // Astro 會忽略底線開頭的路由，所以部署規則在建置前寫入 public。
  writeFileSync('public/_headers', `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n${model.canIndex ? '' : '  X-Robots-Tag: noindex, follow\n'}/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
  writeFileSync('public/_redirects', [...model.redirects].map(([from, to]) => `${encodePath(from)} ${encodePath(to)} 301`).join('\n') + '\n');
  const state = model.redirectState;
  if (model.redirects.size > model.site.redirectManagement.maxActive) throw new Error('301 規則超額，禁止輸出。');
  for (const notice of state.notices) console.log('::warning::' + notice.message);
  if (state.retired.length) console.log('::warning::已自動退役 ' + state.retired.length + ' 條舊 301（容量／建立日期清理），詳見 redirect-ledger.json。');
  console.log('✓ Cloudflare 301：候選 ' + state.candidates + ' 條，實際輸出 ' + model.redirects.size + ' 條；上限 ' + model.site.redirectManagement.maxActive + '。');
  console.log('✓ Cloudflare 索引標頭及永久轉址規則已產生。');
});
