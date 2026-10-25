import { validateCptMediaAssets } from './lib/cpt-media-validation';
import { existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { loadMediaIndex } from './lib/media-index';
import { readModel, run } from './lib/content';
import { verifyURLLock } from './urls';
run(() => {
  const model = readModel();
  verifyURLLock(model);
  const { byUrl } = loadMediaIndex();
  const publicRoot = resolve('public');
  const checkLocalAsset = (url: string, file: string) => {
    let path: string;
    try { path = resolve(publicRoot, '.' + decodeURIComponent(url)); }
    catch { throw new Error(`${file}：本機圖片 URL 編碼無效：${url}`); }
    if (!path.startsWith(publicRoot + sep) || !existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`${file}：找不到本機圖片 ${url}`);
    }
  };
  for (const doc of model.cpts) {
    const type = model.site.contentTypes.find(t => t.id === doc.data.type);
    if (!type) throw new Error(doc.file + '：找不到 CPT 定義：' + doc.data.type);
    validateCptMediaAssets(doc, type, byUrl, publicRoot);
  }
  for (const d of [...model.posts, ...model.pages, ...model.cpts]) {
    if (!d.body.trim()) throw new Error(`${d.file}：內容為空。`);
    for (const match of d.body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)) {
      const inlineUrl = match[1];
      const receipt = byUrl.get(inlineUrl);
      if (!receipt?.verifiedAt || !Number.isFinite(Date.parse(receipt.verifiedAt)) || !/^[a-f0-9]{40}$/i.test(receipt.sha1 ?? '')) {
        throw new Error(`${d.file}：內文圖片缺少成功上傳及 CDN 驗證紀錄，請執行 media:add：${inlineUrl}`);
      }
    }
    const cover = d.data.cover;
    if (!cover) continue;
    for (const url of [cover.url, cover.ogUrl, ...cover.variants.map(v => v.url)].filter(Boolean) as string[]) {
      if (url.startsWith('/')) {
        checkLocalAsset(url, d.file);
      } else {
        const receipt = byUrl.get(url);
        if (!receipt?.verifiedAt || !/^[a-f0-9]{40}$/.test(receipt.sha1)) throw new Error(`${d.file}：圖片缺少成功上傳及 CDN 驗證紀錄，請執行 media:add：${url}`);
        if (url === cover.url && (receipt.width !== cover.width || receipt.height !== cover.height)) throw new Error(`${d.file}：封面尺寸與上傳紀錄不一致。`);
      }
    }
  }
  console.log(`✓ 內容驗證通過：${model.posts.length} 篇公開文章、${model.pages.length} 個獨立頁面、${model.cpts.length} 個公開 CPT 項目、${model.routes.length} 個網址。`);
});
