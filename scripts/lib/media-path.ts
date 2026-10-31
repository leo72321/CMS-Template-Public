// One bucket can host several sites. CMS uploads get a dedicated namespace
// beneath their own domain, separate from legacy WordPress uploads and
// older generated CMS WebP assets.
const segment = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
export function cmsMediaPath(kind: string, uid: string): string {
  if (![kind, uid].every(value => segment.test(value) && value === value.normalize('NFC'))) {
    throw new Error('CMS 媒體目錄必須使用合法的內容類型與 UID。');
  }
  return `/cms/${kind}/${uid}/`;
}
export function assertCmsMediaPath(value: string): string {
  const match = /^\/?cms\/([^/]+)\/([^/]+)\/?$/u.exec(value);
  if (!match || ![match[1], match[2]].every(s => segment.test(s) && s === s.normalize('NFC'))) {
    throw new Error('新媒體必須存放在本站的 cms/內容類型/UID/ 專用目錄，禁止沿用 WordPress uploads。');
  }
  return `cms/${match[1]}/${match[2]}`;
}
