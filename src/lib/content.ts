import { getCollection } from 'astro:content';
import { makeModel, type Post, type Page } from './model';
import { loadSite, isPreview } from './settings';
export async function getModel() {
  const [postEntries, pageEntries, categories, tags, topics] = await Promise.all([
    getCollection('posts'), getCollection('pages'), getCollection('categories'), getCollection('tags'), getCollection('topics'),
  ]);
  const site = loadSite();
  return makeModel({
    posts: postEntries.map(e => ({ data: e.data, body: e.body ?? '', file: e.filePath ?? '', kind: 'post' })) as Post[],
    pages: pageEntries.map(e => ({ data: e.data, body: e.body ?? '', file: e.filePath ?? '', kind: 'page' })) as Page[],
    categories: categories.map(e => e.data), tags: tags.map(e => e.data), topics: topics.map(e => e.data),
  }, site, new Date(), isPreview(process.env, site.productionBranch));
}
