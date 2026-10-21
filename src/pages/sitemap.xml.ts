import { getModel } from '../lib/content';
import { encodePath } from '../lib/model';
export async function GET() {
  const model = await getModel();
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const urls = model.routes.filter(r => !r.noindex).map(r => {
    const data = r.document?.kind === 'post' ? r.document.data : undefined;
    return `<url><loc>${escape(`https://${model.site.domain}${encodePath(r.path)}`)}</loc>${data ? `<lastmod>${data.updatedAt ?? data.publishedAt}</lastmod>` : ''}</url>`;
  }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
