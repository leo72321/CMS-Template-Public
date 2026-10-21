import { getModel } from '../lib/content';
export async function GET() {
  const model = await getModel();
  return new Response(`User-agent: *\n${model.canIndex ? 'Allow: /' : 'Disallow: /'}\nSitemap: https://${model.site.domain}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
