import type { Site, PostData, PageData, Taxonomy, Topic } from './schema';

export type Post = { data: PostData; body: string; file: string; kind: 'post' };
export type Page = { data: PageData; body: string; file: string; kind: 'page' };
export type Document = Post | Page;
export type Route = {
  path: string; title: string; description: string;
  kind: 'home' | 'blog' | 'post' | 'page' | 'category' | 'tag';
  noindex: boolean; document?: Document; posts?: Post[]; taxonomy?: Taxonomy;
  page?: number; totalPages?: number; base?: string;
};
export type Input = { posts: Post[]; pages: Page[]; categories: Taxonomy[]; tags: Taxonomy[]; topics: Topic[] };
export const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export const normalizePath = (path: string) => {
  const decoded = decodeURIComponent(path).normalize('NFC');
  if (!decoded.startsWith('/') || /[\\?#\s]/.test(decoded) || decoded.includes('//') || decoded.split('/').some(s => s === '.' || s === '..')) {
    throw new Error(`無效的站內路徑：${path}`);
  }
  return decoded === '/' ? '/' : `${decoded.replace(/\/+$/, '')}/`;
};
// 所有文章固定 /blog/{slug}/，分類僅作內容分組，不介入永久網址。
export const postPath = (p: Post, categories: Taxonomy[]) => {
  const category = categories.find(c => c.id === p.data.category);
  if (!category) throw new Error(`${p.file}：分類 ${p.data.category} 不存在。`);
  return `/blog/${p.data.slug}/`;
};
export const pathFor = (d: Document, categories: Taxonomy[]) => d.kind === 'post' ? postPath(d as Post, categories) : `/${d.data.slug}/`;
export const todayTaipei = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
export function makeModel(input: Input, site: Site, now = new Date(), preview = false) {
  const errors: string[] = [];
  const unique = (list: { id: string }[], label: string) => {
    const seen = new Set<string>();
    for (const x of list) { if (seen.has(x.id)) errors.push(`${label} ID 重複：${x.id}`); seen.add(x.id); }
  };
  unique(input.categories, '分類'); unique(input.tags, '標籤'); unique(input.topics, '主題');
  const legacyBlogPaths = [...new Set(site.blogLegacyPaths.map(normalizePath))];
  if (legacyBlogPaths.length !== site.blogLegacyPaths.length) errors.push('blogLegacyPaths 不可重複填寫同一舊網址。');
  const all = [...input.posts, ...input.pages];
  const uids = new Set<string>();
  for (const d of all) {
    if (uids.has(d.data.uid)) errors.push(`內容 uid 重複：${d.data.uid}`);
    uids.add(d.data.uid);
  }
  for (const p of input.posts) {
    if (!input.categories.some(c => c.id === p.data.category)) errors.push(`${p.file}：未知分類 ${p.data.category}`);
    if (new Set(p.data.tags).size !== p.data.tags.length) errors.push(`${p.file}：標籤重複。`);
    for (const tag of p.data.tags) if (!input.tags.some(t => t.id === tag)) errors.push(`${p.file}：未知標籤 ${tag}`);
    if (p.data.topic && !input.topics.some(t => t.id === p.data.topic)) errors.push(`${p.file}：未知主題 ${p.data.topic}`);
  }
  const published = (d: Document) => !d.data.draft && (d.kind !== 'post' || (d as Post).data.publishedAt <= todayTaipei(now));
  const posts = input.posts.filter(published).sort((a, b) => b.data.publishedAt.localeCompare(a.data.publishedAt) || a.data.uid.localeCompare(b.data.uid));
  const pages = input.pages.filter(published);
  const visible = [...posts, ...pages];
  for (const topic of input.topics) {
    if (!all.some(d => d.data.uid === topic.hub)) errors.push(`主題 ${topic.name} 的中心頁不存在：${topic.hub}`);
    if (posts.some(p => p.data.topic === topic.id) && !visible.some(d => d.data.uid === topic.hub)) errors.push(`主題 ${topic.name} 已有公開文章，但中心頁仍是草稿或尚未到發布日。`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const canIndex = site.indexable && site.domain !== 'example.com' && !preview;
  const eligible = (d: Document) => !d.data.noindex && !d.data.sample;
  const routes: Route[] = [];
  const byPath = new Map<string, Route>();
  const claims = new Map<string, string>();
  const claim = (path: string, who: string) => {
    const key = normalizePath(path).toLowerCase();
    if (claims.has(key)) errors.push(`網址衝突：${path} 同時屬於 ${claims.get(key)} 與 ${who}`);
    else claims.set(key, who);
  };
  // 系統入口和全部已設定分類預先保留，避免草稿轉正時才產生衝突。
  for (const name of ['/', '/blog/', '/tag/', '/404/', '/sitemap.xml/', '/robots.txt/', '/_headers/', '/_redirects/']) claim(name, '系統路徑');
  for (const c of input.categories) claim(`/${c.slug}/`, `分類 ${c.name}`);
  for (const d of all) claim(pathFor(d, input.categories), d.file);
  const add = (route: Route, claimed = false) => {
    if (!claimed) claim(route.path, route.title);
    const key = normalizePath(route.path);
    if (byPath.has(key)) errors.push(`重複產生頁面：${route.path}`);
    routes.push(route); byPath.set(key, route);
  };
  add({ path: '/', title: site.title, description: site.description, kind: 'home', noindex: !canIndex }, true);
  const archive = (kind: 'blog' | 'category' | 'tag', base: string, title: string, description: string, items: Post[], taxonomy?: Taxonomy) => {
    const totalPages = Math.max(1, Math.ceil(items.length / site.pageSize));
    const indexArchive = !!taxonomy?.indexable && !!description.trim() && items.filter(eligible).length >= site.minArchiveItems;
    for (let n = 1; n <= totalPages; n++) add({
      kind, path: n === 1 ? base : `${base}page/${n}/`, base, title: n === 1 ? title : `${title}・第 ${n} 頁`, description,
      noindex: !canIndex || n > 1 || (kind !== 'blog' && !indexArchive) || (kind === 'blog' && (!site.blogIndexable || !items.some(eligible))),
      posts: items.slice((n - 1) * site.pageSize, n * site.pageSize), taxonomy, page: n, totalPages,
    }, n === 1 && (kind === 'blog' || kind === 'category'));
  };
  archive('blog', '/blog/', '全部文章', `瀏覽${site.title}的文章與分類。`, posts);
  for (const d of visible) add({ path: pathFor(d, input.categories), title: d.data.title, description: d.data.description, kind: d.kind, document: d, noindex: !canIndex || !eligible(d) }, true);
  for (const category of input.categories) {
    const items = posts.filter(p => p.data.category === category.id);
    if (items.length) archive('category', `/${category.slug}/`, category.name, category.description, items, category);
  }
  for (const tag of input.tags) {
    const items = posts.filter(p => p.data.tags.includes(tag.id));
    if (items.length) archive('tag', `/tag/${tag.slug}/`, tag.name, tag.description, items, tag);
  }
  const redirects = new Map<string, string>();
  const redirectClaims = new Set<string>();
  const redirect = (alias: string, to: string) => {
    const from = normalizePath(alias);
    if (claims.has(from.toLowerCase()) || redirectClaims.has(from.toLowerCase())) errors.push(`舊網址與現有網址或其他轉址衝突：${alias}`);
    if (from === '/' || from === to) errors.push(`無效的舊網址：${alias}`);
    redirectClaims.add(from.toLowerCase());
    redirects.set(from, to);
  };
  for (const d of visible) for (const alias of d.data.aliases) redirect(alias, pathFor(d, input.categories));
  // 真正的分類有自己的列表頁，/blog/ 獨立作為全部文章入口。
  // 歷史上誤作主分類的路徑，另外保留原本的 301，不可直接遺失。
  for (const p of posts) {
    const category = input.categories.find(c => c.id === p.data.category)!;
    const canonical = postPath(p, input.categories);
    const legacyBases = new Set([`/${category.slug}/`, ...legacyBlogPaths]);
    for (const base of legacyBases) {
      const legacy = `${base}${p.data.slug}/`;
      if (legacy !== canonical && !p.data.aliases.includes(legacy)) redirect(legacy, canonical);
    }
  }
  for (const base of legacyBlogPaths) redirect(base, '/blog/');
  for (const taxonomy of [...input.categories, ...input.tags]) {
    const route = routes.find(r => r.taxonomy === taxonomy && r.page === 1);
    if (route) for (const alias of taxonomy.aliases ?? []) redirect(alias, route.path);
  }
  const titles = new Map<string, string>();
  for (const d of visible) {
    const title = d.data.title.normalize('NFKC').trim().toLowerCase();
    if (titles.has(title)) errors.push(`標題重複：${d.data.title}（${titles.get(title)}、${d.file}）`);
    titles.set(title, d.file);
  }
  if (routes.length > 49999) errors.push('目前單一 Sitemap 上限為 49,999 頁，請先拆分 Sitemap 再擴充。');
  if (errors.length) throw new Error(errors.join('\n'));
  const related = (p: Post, limit = site.relatedArticles.maxItems, exclude = new Set<string>()) => posts
    .filter(x => x.data.uid !== p.data.uid && !exclude.has(x.data.uid))
    .map(x => ({
      post: x,
      score: (p.data.topic && x.data.topic === p.data.topic ? 8 : 0)
        + x.data.tags.filter(t => p.data.tags.includes(t)).length * 3
        + (x.data.category === p.data.category ? 1 : 0),
    }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.post.data.publishedAt.localeCompare(a.post.data.publishedAt) || a.post.data.uid.localeCompare(b.post.data.uid))
    .slice(0, Math.max(0, limit))
    .map(x => x.post);
  return { ...input, posts, pages, routes, byPath, redirects, canIndex, related, site };
}
export type Model = ReturnType<typeof makeModel>;
