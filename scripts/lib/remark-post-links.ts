import type { Root, RootContent } from 'mdast';
import { readInput } from './content';
import { postPath } from '../../src/lib/model';
import { loadSite } from '../../src/lib/settings';

// 兼容前一版 /blog/文章/ 內連，但正式 HTML 必須直連分類文章網址。
export function canonicalPostLinks() {
  const input = readInput();
  const bySlug = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const post of input.posts) {
    const slug = post.data.slug;
    const url = postPath(post, input.categories);
    if (bySlug.has(slug) && bySlug.get(slug) !== url) ambiguous.add(slug);
    else bySlug.set(slug, url);
  }
  for (const slug of ambiguous) bySlug.delete(slug);
  const domain = loadSite().domain;
  const rewrite = (raw: string) => {
    let value = raw;
    let origin = '';
    if (raw.startsWith('https://')) {
      const prefix = `https://${domain}`;
      if (!raw.startsWith(prefix + '/')) return raw;
      origin = prefix;
      value = raw.slice(prefix.length);
    }
    const match = /^\/blog\/([^/?#]+)\/?([?#].*)?$/.exec(value);
    if (!match) return raw;
    let slug: string;
    try { slug = decodeURIComponent(match[1]); } catch { return raw; }
    const canonical = bySlug.get(slug);
    return canonical ? origin + canonical + (match[2] ?? '') : raw;
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
