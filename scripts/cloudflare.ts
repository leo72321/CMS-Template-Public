import { writeFileSync } from 'node:fs';
import { readModel, run } from './lib/content';
import { encodePath } from '../src/lib/model';
run(() => {
  const model = readModel();
  // Astro 會忽略底線開頭的路由，所以部署規則在建置前寫入 public。
  writeFileSync('public/_headers', `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n${model.canIndex ? '' : '  X-Robots-Tag: noindex, follow\n'}/_astro/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
  writeFileSync('public/_redirects', [...model.redirects].map(([from, to]) => `${encodePath(from)} ${encodePath(to)} 301`).join('\n') + '\n');
  console.log('✓ Cloudflare 索引標頭及永久轉址規則已產生。');
});
