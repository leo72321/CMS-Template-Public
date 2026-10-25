import type { Root, RootContent } from 'mdast';
import { readInput } from './content';
import { postPath, normalizePath } from '../../src/lib/model';
import { contentLocale, localizedPath } from '../../src/lib/i18n';
import { loadSite } from '../../src/lib/settings';

// 兼容前一版 /blog/文章/ 與 blogLegacyPaths 內連，以及多語言同 slug 分流；正式 HTML 必須直連分類文章網址。
export function canonicalPostLinks() {
  const site = loadSite();
  const input = readInput();
  const defaultLocale = site.i18n.enabled ? site.i18n.defaultLocale : site.language;
  const bySlug = new Map<string, string>();
  const ambiguous = new Set<string>();
  const byLocaleSlug = new Map<string, string>();
  const ambiguousLocale = new Set<string>();
  for (const post of input.posts) {
    const slug = post.data.slug;
    const locale = contentLocale(post.data, site);
    const categories = site.i18n.enabled
      ? input.categories.filter(c => contentLocale(c, site) === locale)
      : input.categories;
    const url = localizedPath(locale, postPath(post, categories), site);
    const localeKey = `${locale}:${slug}`;
    if (byLocaleSlug.has(localeKey) && byLocaleSlug.get(localeKey) !== url) ambiguousLocale.add(localeKey);
    else byLocaleSlug.set(localeKey, url);
    if (bySlug.has(slug) && bySlug.get(slug) !== url) ambiguous.add(slug);
    else bySlug.set(slug, url);
  }
  for (const key of ambiguousLocale) byLocaleSlug.delete(key);
  for (const slug of ambiguous) bySlug.delete(slug);

  const domain = site.domain;
  const legacyBases = new Set(['/blog/', ...site.blogLegacyPaths.map(normalizePath)]);
  const localeByPrefix = new Map<string, string>();
  if (site.i18n.enabled) {
    for (const loc of site.i18n.locales) {
      if (loc !== site.i18n.defaultLocale) localeByPrefix.set('/' + loc.toLowerCase(), loc);
    }
  }

  const rewrite = (raw: string) => {
    let value = raw;
    let origin = '';
    if (raw.startsWith('https://')) {
      const prefix = `https://${domain}`;
      if (!raw.startsWith(prefix + '/')) return raw;
      origin = prefix;
      value = raw.slice(prefix.length);
    }
    if (!value.startsWith('/')) return raw;
    let matchedLocale: string | undefined;
    let pathPart = value;
    for (const [pref, loc] of localeByPrefix) {
      if (pathPart.startsWith(pref + '/')) {
        matchedLocale = loc;
        pathPart = pathPart.slice(pref.length);
        break;
      }
    }
    const qIndex = pathPart.search(/[?#]/);
    const suffix = qIndex >= 0 ? pathPart.slice(qIndex) : '';
    const pathname = qIndex >= 0 ? pathPart.slice(0, qIndex) : pathPart;
    let decodedPath: string;
    try { decodedPath = decodeURIComponent(pathname); } catch { return raw; }
    for (const base of legacyBases) {
      if (matchedLocale && base !== '/blog/') continue;
      if (!decodedPath.startsWith(base)) continue;
      const rest = decodedPath.slice(base.length).replace(/\/$/, '');
      if (!rest || rest.includes('/')) continue;
      const targetLocale = matchedLocale ?? defaultLocale;
      const canonical = byLocaleSlug.get(`${targetLocale}:${rest}`) ?? (!matchedLocale ? bySlug.get(rest) : undefined);
      if (canonical) return origin + canonical + suffix;
    }
    return raw;
  };
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if ((node.type === 'link' || node.type === 'definition') && typeof node.url === 'string') node.url = rewrite(node.url);
      if (node.type === 'html') node.value = node.value.replace(/\bhref=(['"])([^'"]+)\1/g, (s, q, url) => `href=${q}${rewrite(url)}${q}`);
      if ('children' in node) node.children.forEach(visit);
    };
    visit(tree);
  };
}
