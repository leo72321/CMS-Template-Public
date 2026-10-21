import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readModel, run } from './lib/content';
run(async () => {
  const model = readModel();
  const manifest = JSON.parse(readFileSync('content/media/manifest.json', 'utf8')) as { uploads: { url: string; sha1: string; variants?: { url: string; width: number }[] }[] };
  const used = new Set<string>();
  for (const doc of [...model.posts, ...model.pages]) {
    const cover = doc.data.cover;
    if (cover) [cover.url, cover.ogUrl, ...cover.variants.map(v => v.url)].filter(Boolean).forEach(u => used.add(u!));
    for (const image of manifest.uploads) if (doc.body.includes(image.url)) {
      used.add(image.url);
      for (const variant of image.variants ?? []) used.add(variant.url);
    }
  }
  let count = 0;
  for (const image of manifest.uploads.filter(i => used.has(i.url))) {
    const response = await fetch(image.url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok || createHash('sha1').update(Buffer.from(await response.arrayBuffer())).digest('hex') !== image.sha1) throw new Error(`圖片無法讀取或內容不一致：${image.url}`);
    count++;
  }
  console.log(`✓ ${count} 張已使用的 CDN 圖片通過實際讀取與校驗。`);
});
