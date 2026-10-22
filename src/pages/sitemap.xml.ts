import { getModel } from '../lib/content';
import { buildSitemapParts, renderSitemapIndex } from '../lib/sitemap';

export async function GET() {
  const model = await getModel();
  const parts = buildSitemapParts(model.routes, model.site.sitemap.maxUrls);
  return new Response(renderSitemapIndex(parts, model.site.domain), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
