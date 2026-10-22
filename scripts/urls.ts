import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathFor, type Model } from '../src/lib/model';
import { readModel, run } from './lib/content';
import { basename } from 'node:path';
type Lock = { urls: Record<string, string>; redirects: Record<string, string> };
export function checkURLs(model: Model, previous: Lock) {
  const current = Object.fromEntries([
    ...[...model.posts, ...model.pages].map(d => [d.data.uid, pathFor(d, model.categories)]),
    ...model.routes.filter(r => r.taxonomy && r.page === 1).map(r => [`${r.kind}:${r.taxonomy!.id}`, r.path]),
  ]);
  const errors: string[] = [];
  for (const [uid, oldPath] of Object.entries(previous.urls)) {
    if (current[uid] === oldPath) continue;
    const redirect = model.redirects.get(oldPath);
    if (!redirect || !model.byPath.has(redirect) || (current[uid] && redirect !== current[uid])) errors.push(`既有網址 ${oldPath}（${uid}）已變更或刪除，請在目標內容的 aliases 加上舊網址。`);
  }
  for (const [from, oldTarget] of Object.entries(previous.redirects)) {
    if (model.redirects.has(from)) continue;
    // 先前的「分類文章 -> /blog/文章」如今升格為正式路由，不可再輸出反向 301。
    const previousUid = Object.entries(previous.urls).find(([, url]) => url === oldTarget)?.[0];
    const route = model.byPath.get(from);
    if (previousUid && route?.kind === 'post' && route.document?.data.uid === previousUid && current[previousUid] === from) continue;
    errors.push(`既有 301 轉址不可遺失：${from}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { urls: current, redirects: Object.fromEntries(model.redirects) };
}
export function verifyURLLock(model = readModel(), root = process.cwd()) {
  const path = `${root}/content/url-lock.json`;
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Lock : { urls: {}, redirects: {} };
  return checkURLs(model, previous);
}
if (basename(process.argv[1] ?? '') === 'urls.ts') run(() => {
  const next = verifyURLLock();
  if (process.argv.includes('--update')) writeFileSync('content/url-lock.json', JSON.stringify(next, null, 2) + '\n');
  console.log('✓ 既有網址與永久轉址檢查通過。');
});
