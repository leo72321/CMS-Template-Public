import type { APIRoute, GetStaticPaths } from 'astro';
import { getModel } from '../../lib/content';
import { buildSitemapParts, renderSitemapPart, type SitemapPart } from '../../lib/sitemap';

export const getStaticPaths = (async () => {
  const model = await getModel();
  const parts = buildSitemapParts(model.routes, model.site.sitemap.maxUrls);
  return parts.map(part => ({
    params: { filename: part.filename.slice(0, -4) },
    props: { part, domain: model.site.domain },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => {
  const part = props.part as SitemapPart;
  const domain = props.domain as string;
  return new Response(renderSitemapPart(part, domain), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
