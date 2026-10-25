import { z } from 'zod';
import { normalizeCdnPrefix, normalizeHttpsEndpoint, storageProviderIds, isValidDomain } from './storage-providers';
z.config(z.locales.zhTW());

// uid 是永久內容識別碼；slug 是網址名稱。標題改字不會自動變更網址。
export const segment = z.string().min(1).max(100).refine(
  (s) => /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(s) && s === s.normalize('NFC'),
  '請使用中文、英數字、底線或連字號，不能放斜線、空白、百分比或點號。',
);
const date = z.preprocess(
  (v) => v instanceof Date ? v.toISOString().slice(0, 10) : v,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  }, '日期無效，請使用 YYYY-MM-DD。'),
);
const imageURL = z.string().refine((s) => {
  if (s.startsWith('/') && !s.startsWith('//') && !/[?#]/.test(s)) {
    try {
      const decoded = decodeURIComponent(s);
      return !decoded.includes('..') && !decoded.includes('\\');
    } catch { return false; }
  }
  try { return new URL(s).protocol === 'https:'; } catch { return false; }
}, '圖片須使用站內絕對路徑或 HTTPS 網址。');
export const imageSchema = z.object({
  url: imageURL,
  alt: z.string().trim().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  variants: z.array(z.object({ url: imageURL, width: z.number().int().positive() }).strict()).default([]),
  ogUrl: imageURL.optional(),
}).strict();
// Accept any well-formed BCP 47 language tag (ja, fr, pt-BR, zh-Hant-TW...).
// Canonicalize at the schema boundary so the model, routes and hreflang agree.
export const localeCode = z.string().trim().min(2).max(35).refine(value => {
  if (!/^[A-Za-z0-9-]+$/.test(value)) return false;
  try { return Intl.getCanonicalLocales(value).length === 1; }
  catch { return false; }
}, '請使用有效的 BCP 47 語言代碼，例如 zh-TW、en、ja、fr、pt-BR。')
  .transform(value => Intl.getCanonicalLocales(value)[0]);
const base = {
  locale: localeCode.optional(),
  translationKey: segment.optional(),
  uid: segment,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(300),
  slug: segment,
  draft: z.boolean().default(true),
  noindex: z.boolean().default(false),
  sample: z.boolean().default(false),
  cover: imageSchema.optional(),
  aliases: z.array(z.string().regex(/^\/(?:[^\s?#]+\/)?$/)).default([]),
};
export const postSchema = z.object({
  ...base,
  category: segment,
  tags: z.array(segment).default([]),
  topic: segment.optional(),
  publishedAt: date,
  updatedAt: date.optional(),
}).strict().refine((p) => !p.updatedAt || p.updatedAt >= p.publishedAt, '更新日期不可早於發布日期。');
export const pageSchema = z.object(base).strict();
// CPT（自訂文章類型）是資料驅動的內容集合，不為 cars/houses/products 個別開發 CMS。
const cptId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, '類型代碼限小寫英數與連字號，如 cars、houses。');
const cptFieldId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, '自訂欄位 ID 限小寫英數與底線。');
export const cptFieldSchema = z.object({
  id: cptFieldId,
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'number', 'price', 'boolean', 'select', 'date', 'url', 'image', 'gallery', 'file']),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1)).max(100).optional(),
  showOnList: z.boolean().default(false),
}).strict().superRefine((field, ctx) => {
  if (field.type === 'select' && !field.options?.length) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '選單欄位必須提供至少一個選項。' });
  }
  if (field.type !== 'select' && field.options?.length) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '只有 select 欄位可設定 options。' });
  }
  if (field.options && new Set(field.options).size !== field.options.length) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '選單值不可重複。' });
  }
});
export const contentTypeSchema = z.object({
  id: cptId,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  indexable: z.boolean().default(true),
  fields: z.array(cptFieldSchema).max(40).default([]),
}).strict().superRefine((type, ctx) => {
  const ids = new Set<string>();
  for (const [i, field] of type.fields.entries()) {
    if (ids.has(field.id)) ctx.addIssue({ code: 'custom', path: ['fields', i, 'id'], message: 'CPT 欄位 ID 重複。' });
    ids.add(field.id);
  }
});
const cptValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export const cptSchema = z.object({
  ...base,
  type: cptId,
  fields: z.record(cptFieldId, cptValue).default({}),
  publishedAt: date.optional(),
  updatedAt: date.optional(),
}).strict().refine(p => !p.updatedAt || !p.publishedAt || p.updatedAt >= p.publishedAt,
  '更新日期不可早於發布日期。');


export const taxonomySchema = z.object({
  locale: localeCode.optional(),
  translationKey: segment.optional(),
  id: segment,
  slug: segment,
  name: z.string().trim().min(1),
  description: z.string().default(''),
  indexable: z.boolean().default(false),
  aliases: z.array(z.string().regex(/^\/(?:[^\s?#]+\/)?$/)).optional(),
}).strict();
export const topicSchema = z.object({
  locale: localeCode.optional(),
  translationKey: segment.optional(),
  id: segment,
  name: z.string().trim().min(1),
  description: z.string().default(''),
  hub: segment,
}).strict();

const footerLink = z.string().refine(value => !value ||
  (/^\/(?:[\p{L}\p{N}_-]+\/)+$/u.test(value)) ||
  (() => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } })(),
  '自訂連結必須是完整站內路徑（例如 /about/）或 HTTPS 網址。');
const postFooterSchema = z.object({
  tags: z.boolean().default(true),
  author: z.object({
    enabled: z.boolean().default(false),
    name: z.string().trim().max(100).default(''),
    role: z.string().trim().max(100).default(''),
    bio: z.string().trim().max(600).default(''),
    photo: z.union([imageURL, z.literal('')]).default(''),
    page: z.string().refine(v => !v || /^\/(?:[\p{L}\p{N}_-]+\/)+$/u.test(v), '作者連結請填站內 PAGE 路徑，如 /about/。').default(''),
    linkText: z.string().trim().max(100).default('認識作者'),
  }).strict().prefault({ enabled: false }),
  blocks: z.array(z.object({
    id: segment,
    enabled: z.boolean().default(false),
    title: z.string().trim().max(100).default(''),
    text: z.string().trim().max(1500).default(''),
    href: footerLink.default(''),
    linkText: z.string().trim().max(100).default(''),
  }).strict()).max(20).default([]),
}).strict().superRefine((footer, ctx) => {
  const ids = new Set<string>();
  for (const [i, block] of footer.blocks.entries()) {
    if (ids.has(block.id)) ctx.addIssue({ code: 'custom', path: ['blocks', i, 'id'], message: '自訂區塊 ID 不可重複。' });
    ids.add(block.id);
    if (block.enabled && block.href && !block.linkText) ctx.addIssue({ code: 'custom', path: ['blocks', i, 'linkText'], message: '啟用帶連結的區塊時，請填寫連結文字。' });
  }
});

export const siteSchema = z.object({
  $schema: z.string().optional(),
  _說明: z.string().optional(),
  domain: z.string().refine((s) => {
    return isValidDomain(s);
  }, '網域請填 example.com，不含 https://、路徑或連接埠。'),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  author: z.string().trim().min(1),
  language: localeCode.default('zh-TW'),
  // Missing i18n configuration intentionally preserves every pre-existing single-language URL.
  i18n: z.object({
    enabled: z.boolean().default(false),
    defaultLocale: localeCode.default('zh-TW'),
    locales: z.array(localeCode).min(1).default(['zh-TW']),
    languageSuggestion: z.boolean().default(true),
    metadata: z.record(z.string(), z.object({
      title: z.string().trim().min(1), description: z.string().trim().min(1),
      author: z.string().trim().min(1).optional(),
      label: z.string().trim().min(1).max(80).optional(),
    }).strict()).default({}),
    // Optional UI strings for any custom locale. No code changes are needed to add languages.
    messages: z.record(z.string(), z.record(z.string(), z.string().trim().min(1))).default({}),
  }).strict().prefault({ enabled: false }),
  indexable: z.boolean().default(false),
  productionBranch: z.string().default('main'),
  gtmId: z.string().regex(/^(GTM-[A-Z0-9]+)?$/).default(''),
  pageSize: z.number().int().min(1).max(50).default(12),
  // Google XML Sitemap：POST／PAGE／分類／TAG 各自分片。200 參照 Rank Math 的易管理預設，不是 Google 的必要上限。
  sitemap: z.object({ maxUrls: z.number().int().min(1).max(50000).default(200) }).strict().prefault({ maxUrls: 200 }),
  minArchiveItems: z.number().int().min(2).default(2),
  blogIndexable: z.boolean().default(true),
  contentTypes: z.array(contentTypeSchema).max(30).default([]),
  headerNavPages: z.array(segment).max(20).default(['about']),
  // 曾經被拿來當主分類的 Blog 入口；新版只負責 301 歷史轉址，不是分類。
  blogLegacyPaths: z.array(z.string().regex(/^\/[\p{L}\p{N}_-]+\/$/u)).default([]),
  // 建置時計算推薦。正文已有內部連結時會佔用名額，不會重複推薦。
  // 全站所有 POST 共用的頁尾配置，個別區塊可停用後重新啟用。
  postFooter: postFooterSchema.prefault({ tags: true, author: { enabled: false }, blocks: [] }),
  // Cloudflare Pages _redirects 容量保護。依首次記錄日期淘汰，非實際最後造訪時間。
  redirectManagement: z.object({
    maxActive: z.number().int().min(1).max(2000).default(1950),
    overflowAutoPrune: z.boolean().default(true),
    agePrune: z.object({
      enabled: z.boolean().default(false),
      days: z.number().int().min(1).max(36500).default(90),
    }).strict().prefault({ enabled: false, days: 90 }),
  }).strict().prefault({ maxActive: 1950, overflowAutoPrune: true, agePrune: { enabled: false, days: 90 } }),
  relatedArticles: z.object({
    enabled: z.boolean().default(true),
    maxItems: z.number().int().min(0).max(12).default(4),
  }).strict().default({ enabled: true, maxItems: 4 }),
  storage: z.object({
    provider: z.enum(storageProviderIds),
    endpoint: z.string().refine(value => {
      try { normalizeHttpsEndpoint(value); return true; } catch { return false; }
    }, 'S3 端點必須為公開 HTTPS 根網址，不得帶帳密、查詢參數或路徑。'),
    region: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  }).strict().optional(),
  media: z.object({
    _說明: z.string().optional(),
    bucket: z.string().refine(b => /^[A-Za-z0-9.-]{3,63}$/.test(b) && !b.includes('..') && !/^[.-]|[.-]$/.test(b), 'Bucket 名稱須為 3–63 字元，可包含合法的點號、英數字及連字號。'),
    cdnBase: z.string().refine((s) => !s || (s.startsWith('https://') && !/[?#]/.test(s))).default(''),
  }).strict(),
}).strict().superRefine((site, ctx) => {
  if (site.i18n.enabled) {
    const { locales, defaultLocale } = site.i18n;
    if (!locales.includes(defaultLocale)) ctx.addIssue({ code: 'custom', path: ['i18n', 'locales'], message: '多語言列表必須包含預設語言。' });
    if (new Set(locales).size !== locales.length) ctx.addIssue({ code: 'custom', path: ['i18n', 'locales'], message: '多語言列表不可重複。' });
    const reservedLanguagePrefixes = new Set(['blog', 'tag', 'tags', 'site', 'page', 'pages', 'post', 'posts',
      'category', 'categories', 'topics', 'sitemap', '404', 'assets', '_astro', 'robots.txt']);
    for (const locale of locales.filter(lang => lang !== defaultLocale)) {
      if (reservedLanguagePrefixes.has(locale.toLowerCase()))
        ctx.addIssue({ code: 'custom', path: ['i18n','locales'], message: '語言前綴與系統網址保留字衝突：' + locale });
      if (site.contentTypes.some(type => type.id === locale.toLowerCase()))
        ctx.addIssue({ code: 'custom', path: ['i18n','locales'], message: '語言前綴與 CPT 類型衝突：' + locale });
    }
    for (const [field, record] of [['metadata', site.i18n.metadata], ['messages', site.i18n.messages]] as const) {
      for (const lang of Object.keys(record)) {
        const parsed = localeCode.safeParse(lang);
        if (!parsed.success || parsed.data !== lang || !locales.includes(lang))
          ctx.addIssue({ code: 'custom', path: ['i18n', field, lang], message: '語言代碼必須為已啟用的標準 BCP 47 格式。' });
      }
    }
    if (site.language !== defaultLocale) ctx.addIssue({ code: 'custom', path: ['language'], message: 'language 必須與 i18n.defaultLocale 一致。' });
  }
  const reserved = new Set(['blog','site','post','posts','page','pages','tag','tags','category','categories','topics','sitemap','404','assets']);
  const typeIds = new Set<string>();
  for (const [i, type] of site.contentTypes.entries()) {
    if (reserved.has(type.id)) ctx.addIssue({ code: 'custom', path: ['contentTypes', i, 'id'], message: 'CPT 類型代碼與系統保留字衝突。' });
    if (typeIds.has(type.id)) ctx.addIssue({ code: 'custom', path: ['contentTypes', i, 'id'], message: 'CPT 類型代碼不可重複。' });
    typeIds.add(type.id);
  }
  if (site.storage && !site.media.cdnBase) {
    ctx.addIssue({ code: 'custom', path: ['media', 'cdnBase'], message: '使用 S3 儲存時必須設定圖片 CDN 網址。' });
  } else if (site.storage) {
    try { normalizeCdnPrefix(site.media.cdnBase); }
    catch { ctx.addIssue({ code: 'custom', path: ['media', 'cdnBase'], message: 'CDN URL 必須是安全的公開 HTTPS 前綴，可以包含 /file/儲存桶/ 路徑。' }); }
  }
});
export type Site = z.infer<typeof siteSchema>;
export type PostData = z.infer<typeof postSchema>;
export type PageData = z.infer<typeof pageSchema>;
export type CptData = z.infer<typeof cptSchema>;
export type ContentTypeDefinition = z.infer<typeof contentTypeSchema>;
export type Taxonomy = z.infer<typeof taxonomySchema>;
export type Topic = z.infer<typeof topicSchema>;
export type Cover = z.infer<typeof imageSchema>;
