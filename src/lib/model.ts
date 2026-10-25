import type { Site, PostData, PageData, CptData, ContentTypeDefinition, Taxonomy, Topic } from './schema';
import { validateCptFields } from './cpt';
import { contentLocale, localizedPath, localePrefix, translationGroup, t } from './i18n';
import { manageRedirects, type RedirectHistory } from './redirect-manager';

export type Post = { data: PostData; body: string; file: string; kind: 'post' };
export type Page = { data: PageData; body: string; file: string; kind: 'page' };
export type Cpt = { data: CptData; body: string; file: string; kind: 'cpt' };
export type Document = Post | Page | Cpt;
export type Route = {
  path: string; title: string; description: string; locale?: string; alternates?: Record<string,string>;
  kind: 'home' | 'blog' | 'post' | 'page' | 'category' | 'tag' | 'cpt' | 'cpt-index';
  noindex: boolean; document?: Document; posts?: Post[]; cpts?: Cpt[]; contentType?: ContentTypeDefinition; taxonomy?: Taxonomy;
  page?: number; totalPages?: number; base?: string;
};
export type Input = { posts: Post[]; pages: Page[]; cpts?: Cpt[]; categories: Taxonomy[]; tags: Taxonomy[]; topics: Topic[] };
export const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export const normalizePath = (path: string) => {
  const decoded = decodeURIComponent(path).normalize('NFC');
  if (!decoded.startsWith('/') || /[\\?#\s]/.test(decoded) || decoded.includes('//') || decoded.split('/').some(s => s === '.' || s === '..')) {
    throw new Error(`無效的站內路徑：${path}`);
  }
  return decoded === '/' ? '/' : `${decoded.replace(/\/+$/, '')}/`;
};
// 文章固定 /{分類 slug}/{文章 slug}/；/blog/ 僅作全部文章總覽。
export const postPath = (p: Post, categories: Taxonomy[]) => {
  const category = categories.find(c => c.id === p.data.category);
  if (!category) throw new Error(`${p.file}：分類 ${p.data.category} 不存在。`);
  return `/${category.slug}/${p.data.slug}/`;
};
export const pathFor = (d: Document, categories: Taxonomy[]) => d.kind === 'post' ? postPath(d, categories) : d.kind === 'cpt' ? `/${d.data.type}/${d.data.slug}/` : `/${d.data.slug}/`;
export const todayTaipei = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
export function makeModel(input: Input, site: Site, now = new Date(), preview = false, redirectHistory?: RedirectHistory) {
  if (site.i18n.enabled) return makeI18nModel(input, site, now, preview, redirectHistory);
  return makeSingleModel(input, site, now, preview, redirectHistory);
}
function makeSingleModel(input: Input, site: Site, now = new Date(), preview = false, redirectHistory?: RedirectHistory) {
  const errors: string[] = [];
  const unique = (list: { id: string }[], label: string) => {
    const seen = new Set<string>();
    for (const x of list) { if (seen.has(x.id)) errors.push(`${label} ID 重複：${x.id}`); seen.add(x.id); }
  };
  unique(input.categories, '分類'); unique(input.tags, '標籤'); unique(input.topics, '主題');
  const legacyBlogPaths = [...new Set(site.blogLegacyPaths.map(normalizePath))];
  if (legacyBlogPaths.length !== site.blogLegacyPaths.length) errors.push('blogLegacyPaths 不可重複填寫同一舊網址。');
  const all: Document[] = [...input.posts, ...input.pages, ...(input.cpts ?? [])];
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
  for (const d of input.cpts ?? []) {
    const type = site.contentTypes.find(t => t.id === d.data.type);
    if (!type) errors.push(d.file + '：沒有註冊 CPT 類型 ' + d.data.type);
    else {
      try { validateCptFields(d.data, type); }
      catch (error) { errors.push(d.file + '：' + String(error)); }
    }
    if (!d.file.replaceAll('\\', '/').startsWith('content/cpt/' + d.data.type + '/')) {
      errors.push(d.file + '：CPT 內容檔案必須位於 content/cpt/' + d.data.type + '/');
    }
  }
  const published = (d: Document) => !d.data.draft && (d.kind === 'post' ? d.data.publishedAt <= todayTaipei(now)
    : d.kind === 'cpt' ? !d.data.publishedAt || d.data.publishedAt <= todayTaipei(now) : true);
  const posts = input.posts.filter(published).sort((a, b) => b.data.publishedAt.localeCompare(a.data.publishedAt) || a.data.uid.localeCompare(b.data.uid));
  const pages = input.pages.filter(published);
  const cpts = (input.cpts ?? []).filter(published).sort((a, b) => (b.data.publishedAt ?? '').localeCompare(a.data.publishedAt ?? '') || a.data.uid.localeCompare(b.data.uid));
  const visible: Document[] = [...posts, ...pages, ...cpts];
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
  for (const t of site.contentTypes) claim(`/${t.id}/`, `CPT ${t.name}`);
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
  for (const d of visible) add({ path: pathFor(d, input.categories), title: d.data.title, description: d.data.description,
    kind: d.kind, document: d, noindex: !canIndex || !eligible(d) || (d.kind === 'cpt' && !site.contentTypes.find(t => t.id === d.data.type)?.indexable) }, true);
  for (const type of site.contentTypes) {
    const members = cpts.filter(c => c.data.type === type.id);
    const totalPages = Math.max(1, Math.ceil(members.length / site.pageSize));
    const base = '/' + type.id + '/';
    for (let n = 1; n <= totalPages; n++) add({
      kind: 'cpt-index', path: n === 1 ? base : base + 'page/' + n + '/',
      base, title: n === 1 ? type.name : type.name + '・第 ' + n + ' 頁',
      description: type.description || '瀏覽' + type.name + '。',
      noindex: !canIndex || !type.indexable || n > 1 || !members.some(eligible),
      contentType: type, cpts: members.slice((n - 1) * site.pageSize, n * site.pageSize),
      page: n, totalPages,
    }, n === 1);
  }
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
  const publishedSlugCounts = new Map<string, number>();
  for (const p of posts) publishedSlugCounts.set(p.data.slug, (publishedSlugCounts.get(p.data.slug) ?? 0) + 1);
  // Historical redirects have precedence over auto-generated compatibility aliases.
  // Newly published posts should not consume the limited _redirects budget indefinitely.
  const autoAliases: Array<{ from: string; to: string; recorded: boolean }> = [];
  for (const p of posts) {
    if ((publishedSlugCounts.get(p.data.slug) ?? 0) !== 1) continue;
    const canonical = postPath(p, input.categories);
    for (const base of new Set(['/blog/', ...legacyBlogPaths])) {
      const from = `${base}${p.data.slug}/`;
      if (from !== canonical && !p.data.aliases.includes(from))
        autoAliases.push({ from, to: canonical, recorded: !!redirectHistory?.entries[from] });
    }
  }
  const recordedFirst = autoAliases.sort((a, b) => Number(b.recorded) - Number(a.recorded));
  const remainingAutoSlots = Math.max(0, site.redirectManagement.maxActive - redirects.size - legacyBlogPaths.length);
  const recordedActiveCount = autoAliases.filter(a => a.recorded && !redirectHistory?.entries[a.from]?.retiredAt && !redirectClaims.has(a.from.toLowerCase())).length;
  if (recordedActiveCount > remainingAutoSlots) errors.push('既有歷史 301 轉址超過容量，不可自動刪除舊網址；請先調整轉址保護策略。');
  for (const alias of recordedFirst.slice(0, remainingAutoSlots)) {
    if (!redirectClaims.has(alias.from.toLowerCase())) redirect(alias.from, alias.to);
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
  // XML Sitemap 已依種類自動分片，不再以單檔 49,999 URL 限制整站頁數。
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
  const redirectState = manageRedirects(redirects, redirectHistory, site.redirectManagement, now);
  return { ...input, posts, pages, cpts, routes, byPath, redirects: redirectState.redirects, redirectState, canIndex, related, site };
}

/**
 * Keep the original single-language builder as the authority for each locale.
 * The default locale retains its exact existing routes and URL-lock identities.
 * Translated entries have different immutable uid/id values and a shared translationKey.
 */
function makeI18nModel(input: Input, site: Site, now: Date, preview: boolean, redirectHistory?: RedirectHistory) {
  const def = site.i18n.defaultLocale;
  const languages = site.i18n.locales;
  const documents = [...input.posts, ...input.pages, ...(input.cpts ?? [])];
  const taxonomies = [...input.categories, ...input.tags, ...input.topics];
  for (const item of [...documents, ...taxonomies]) {
    const locale = contentLocale(item.data ? item.data : item, site);
    if (!languages.includes(locale as typeof languages[number])) throw new Error('未啟用的內容語言：' + locale);
    if (locale !== def && !(item.data ? item.data.translationKey : item.translationKey)) {
      throw new Error('翻譯內容須指定 translationKey：' + ('file' in item ? item.file : item.id));
    }
  }
  const names = new Set<string>();
  for (const d of documents) {
    if (names.has(d.data.uid)) throw new Error('內容 uid 重複：' + d.data.uid);
    names.add(d.data.uid);
  }
  const translationIndex = new Map<string, Set<string>>();
  for (const d of documents) {
    const group = d.kind + ':' + translationGroup(d.data);
    const locales = translationIndex.get(group) ?? new Set<string>();
    const locale = contentLocale(d.data, site);
    if (locales.has(locale)) throw new Error('同一翻譯群組的語言重複：' + group + ':' + locale);
    locales.add(locale); translationIndex.set(group, locales);
  }
  // A translated page must be the same content kind as its source.
  const sourceGroups = new Set(documents.filter(d => contentLocale(d.data, site) === def).map(d => d.kind + ':' + translationGroup(d.data)));
  for (const d of documents.filter(d => contentLocale(d.data, site) !== def)) {
    if (!sourceGroups.has(d.kind + ':' + translationGroup(d.data))) throw new Error('譯文找不到預設語言原稿：' + d.file);
  }
  const taxFor = (items: Input['categories'], locale: string) =>
    items.filter(x => contentLocale(x, site) === locale);
  const slice = (locale: string): Input => ({
    posts: input.posts.filter(x => contentLocale(x.data, site) === locale),
    pages: input.pages.filter(x => contentLocale(x.data, site) === locale),
    cpts: (input.cpts ?? []).filter(x => contentLocale(x.data, site) === locale),
    categories: taxFor(input.categories, locale), tags: taxFor(input.tags, locale),
    topics: taxFor(input.topics, locale),
  });
  const localizedSite = (locale: string): Site => ({
    ...site, language: locale as Site['language'], i18n: { ...site.i18n, enabled: false },
    // Legacy aliases and their root redirects belong exclusively to the default language.
    blogLegacyPaths: locale === def ? site.blogLegacyPaths : [],
  });
  const primary = makeSingleModel(slice(def), localizedSite(def), now, preview, redirectHistory);
  const views = new Map<string, typeof primary>([[def, primary]]);
  for (const lang of languages.filter(x => x !== def)) views.set(lang,
    makeSingleModel(slice(lang), localizedSite(lang), now, preview));
  const routes: Route[] = [];
  const byPath = new Map<string, Route>();
  const translationRoutes = new Map<string, Record<string,string>>();
  const fingerprints = new Map<string, string>();
  for (const lang of languages) {
    const view = views.get(lang)!;
    for (const route of view.routes) {
      const path = localizedPath(lang, route.path, site);
      if (byPath.has(path)) throw new Error('多語言網址衝突：' + path);
      const localized: Route = { ...route, path, locale: lang };
      routes.push(localized); byPath.set(path, localized);
      if (route.document) {
        const key = route.document.kind + ':' + translationGroup(route.document.data);
        const versions = translationRoutes.get(key) ?? {};
        versions[lang] = path; translationRoutes.set(key, versions);
        fingerprints.set(path, key);
      }
    }
  }
  // Link article translations to one another; home and blog have equivalents as well.
  for (const route of routes) {
    const key = fingerprints.get(route.path);
    if (key) route.alternates = { ...translationRoutes.get(key) };
    else if (route.kind === 'home' || route.kind === 'blog') {
      route.alternates = Object.fromEntries(languages.map(lang =>
        [lang, localizedPath(lang, route.kind === 'home' ? '/' : '/blog/', site)]));
    }
  }
  const redirects = new Map<string,string>(primary.redirects);
  for (const lang of languages.filter(x => x !== def)) {
    const view = views.get(lang)!;
    for (const [from,to] of view.redirects) {
      const source = localizedPath(lang, from, site);
      const target = localizedPath(lang, to, site);
      if (redirects.has(source) || byPath.has(source)) throw new Error('多語言轉址衝突：' + source);
      redirects.set(source,target);
    }
  }
  for (const [from,to] of redirects) {
    if (byPath.has(from) || !byPath.has(to)) throw new Error('多語言轉址來源或目標不正確：' + from + ' → ' + to);
  }
  if (redirects.size > site.redirectManagement.maxActive) throw new Error('多語言 301 超過容量：' + redirects.size);
  return {
    ...primary, site, routes, byPath, redirects, views,
    localizedPosts: new Map(languages.map(lang => [lang, views.get(lang)!.posts])),
    localizedPages: new Map(languages.map(lang => [lang, views.get(lang)!.pages])),
    localizedCategories: new Map(languages.map(lang => [lang, views.get(lang)!.categories])),
    localizedTags: new Map(languages.map(lang => [lang, views.get(lang)!.tags])),
    localizedCpts: new Map(languages.map(lang => [lang, views.get(lang)!.cpts])),
    languages,
    related: (post: Post, limit?: number, exclude?: Set<string>) => {
      const lang = contentLocale(post.data, site);
      return views.get(lang)!.related(post, limit, exclude);
    },
  };
}
export type Model = ReturnType<typeof makeModel>;

