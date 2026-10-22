import { encodePath, type Route } from './model';

export type SitemapKind = 'posts' | 'pages' | 'categories' | 'tags';
export type SitemapPart = { kind: SitemapKind; filename: string; routes: Route[] };
const kinds: SitemapKind[] = ['posts', 'pages', 'categories', 'tags'];
const xmlStart = '<?xml version="1.0" encoding="UTF-8"?>';
const namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const maximumBytes = 50 * 1024 * 1024;

const escapeXML = (value: string) => value.replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function ensureXMLSize(xml: string, label: string) {
  if (Buffer.byteLength(xml, 'utf8') > maximumBytes) {
    throw new Error(label + ' 超過單份 50 MiB XML 容量限制，請降低 sitemap.maxUrls。');
  }
  return xml;
}

export function buildSitemapParts(routes: readonly Route[], maxUrls = 200): SitemapPart[] {
  if (!Number.isInteger(maxUrls) || maxUrls < 1 || maxUrls > 50000) {
    throw new Error('sitemap.maxUrls 必須介於 1–50000。');
  }
  const grouped: Record<SitemapKind, Route[]> = { posts: [], pages: [], categories: [], tags: [] };
  for (const route of routes) {
    if (route.noindex) continue;
    // 首頁、Blog 彙整及正式 PAGE 一起屬於 pages；不建立沒有網址的空白 Sitemap。
    const kind: SitemapKind = route.kind === 'post' ? 'posts'
      : route.kind === 'category' ? 'categories'
      : route.kind === 'tag' ? 'tags' : 'pages';
    grouped[kind].push(route);
  }
  const parts: SitemapPart[] = [];
  for (const kind of kinds) {
    // 明確排序，避免模型輸入順序變化造成完全不同的 Sitemap 內容。
    const ordered = grouped[kind].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    for (let i = 0; i < ordered.length; i += maxUrls) {
      const number = Math.floor(i / maxUrls) + 1;
      parts.push({ kind, filename: kind + '-' + String(number).padStart(3, '0') + '.xml',
        routes: ordered.slice(i, i + maxUrls) });
    }
  }
  if (parts.length > 50000) throw new Error('Sitemap Index 超過 50,000 份子 Sitemap，上限不足，請增加 sitemap.maxUrls。');
  return parts;
}

// 公版預設 noindex 或 Cloudflare preview 沒有任何可索引網址時，輸出空 urlset，
// 不發布指向不存在的子 Sitemap 的索引；開啟收錄後自動切換為 sitemapindex。
export function renderSitemapIndex(parts: readonly SitemapPart[], domain: string): string {
  if (!parts.length) return xmlStart + '<urlset xmlns="' + namespace + '"></urlset>';
  const entries = parts.map(part => '<sitemap><loc>'
    + escapeXML('https://' + domain + '/' + part.filename) + '</loc></sitemap>').join('');
  return ensureXMLSize(xmlStart + '<sitemapindex xmlns="' + namespace + '">' + entries + '</sitemapindex>', 'Sitemap Index');
}

export function renderSitemapPart(part: SitemapPart, domain: string): string {
  if (!part.routes.length) throw new Error('拒絕輸出沒有網址的 Sitemap：' + part.filename);
  if (part.routes.length > 50000) throw new Error('單份 Sitemap 超過 50,000 個網址。');
  const entries = part.routes.map(route => {
    const url = escapeXML('https://' + domain + encodePath(route.path));
    const date = route.document?.kind === 'post' ? route.document.data : undefined;
    // 只使用真實發布／更新日期；PAGE／分類／TAG 不偽造每次建置的 lastmod。
    const lastmod = date ? '<lastmod>' + escapeXML(date.updatedAt ?? date.publishedAt) + '</lastmod>' : '';
    return '<url><loc>' + url + '</loc>' + lastmod + '</url>';
  }).join('');
  return ensureXMLSize(xmlStart + '<urlset xmlns="' + namespace + '">' + entries + '</urlset>', part.filename);
}
