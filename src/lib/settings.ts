import { readFileSync } from 'node:fs';
import { siteSchema } from './schema';
export function loadSite(root = process.cwd()) {
  return siteSchema.parse(JSON.parse(readFileSync(`${root}/site.config.json`, 'utf8')));
}
export function isPreview(env = process.env, productionBranch = 'main') {
  return env.SITE_PREVIEW === '1' || (env.CF_PAGES === '1' && env.CF_PAGES_BRANCH !== productionBranch);
}
// S3 物件 key 是「網域/文章路徑/圖片」，公開 CDN URL 必須和 key 對應。
// 舊 B2 Native 網站沿用舊版 cdnBase 路徑語意，不破壞既有圖片。
export const mediaBase = (site: ReturnType<typeof loadSite>) => site.storage
  ? `${site.media.cdnBase.replace(/\/+$/, '')}/${site.domain}/`
  : site.media.cdnBase
    ? site.media.cdnBase.replace(/\/+$/, '') + '/'
    : `https://cdn.${site.domain}/file/${site.media.bucket}/${site.domain}/`;
