import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { postSchema, pageSchema, cptSchema, taxonomySchema, topicSchema } from './lib/schema';
// 檔名作為內部 ID；網址由資料中的 slug 決定。
const loader = (base: string, extension: string) => glob({ base, pattern: `**/*.${extension}`, generateId: ({ entry }) => entry.replace(/\.[^.]+$/, '') });
export const collections = {
  posts: defineCollection({ loader: loader('./content/posts', 'md'), schema: postSchema }),
  pages: defineCollection({ loader: loader('./content/pages', 'md'), schema: pageSchema }),
  cpt: defineCollection({ loader: loader('./content/cpt', 'md'), schema: cptSchema }),
  categories: defineCollection({ loader: loader('./content/categories', 'json'), schema: taxonomySchema }),
  tags: defineCollection({ loader: loader('./content/tags', 'json'), schema: taxonomySchema }),
  topics: defineCollection({ loader: loader('./content/topics', 'json'), schema: topicSchema }),
};
