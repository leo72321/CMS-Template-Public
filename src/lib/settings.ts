import { readFileSync } from 'node:fs';
import { siteSchema } from './schema';
export function loadSite(root = process.cwd()) {
  return siteSchema.parse(JSON.parse(readFileSync(`${root}/site.config.json`, 'utf8')));
}
export function isPreview(env = process.env, productionBranch = 'main') {
  return env.SITE_PREVIEW === '1' || (env.CF_PAGES === '1' && env.CF_PAGES_BRANCH !== productionBranch);
}
export const mediaBase = (site: ReturnType<typeof loadSite>) => site.media.cdnBase
  ? site.media.cdnBase.replace(/\/+$/, '') + '/'
  : `https://cdn.${site.domain}/file/${site.media.bucket}/${site.domain}/`;
