import { existsSync, readFileSync } from 'node:fs';
import { readModel, run } from './lib/content';
import { verifyURLLock } from './urls';
run(() => {
  const model = readModel();
  verifyURLLock(model);
  const manifest = JSON.parse(readFileSync('content/media/manifest.json', 'utf8')) as { uploads: { url: string; width: number; height: number; verifiedAt: string; sha1: string }[] };
  for (const d of [...model.posts, ...model.pages]) {
    if (!d.body.trim()) throw new Error(`${d.file}：內容為空。`);
    const cover = d.data.cover;
    if (!cover) continue;
    for (const url of [cover.url, cover.ogUrl, ...cover.variants.map(v => v.url)].filter(Boolean) as string[]) {
      if (url.startsWith('/')) {
        if (!existsSync(`public${decodeURIComponent(url)}`)) throw new Error(`${d.file}：找不到本機圖片 ${url}`);
      } else {
        const receipt = manifest.uploads.find(r => r.url === url);
        if (!receipt?.verifiedAt || !/^[a-f0-9]{40}$/.test(receipt.sha1)) throw new Error(`${d.file}：圖片缺少成功上傳及 CDN 驗證紀錄，請執行 media:add：${url}`);
        if (url === cover.url && (receipt.width !== cover.width || receipt.height !== cover.height)) throw new Error(`${d.file}：封面尺寸與上傳紀錄不一致。`);
      }
    }
  }
  console.log(`✓ 內容驗證通過：${model.posts.length} 篇公開文章、${model.pages.length} 個獨立頁面、${model.routes.length} 個網址。`);
});
