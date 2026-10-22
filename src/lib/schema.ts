import { z } from 'zod';
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
  if (s.startsWith('/') && !s.startsWith('//') && !s.includes('..')) return true;
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
const base = {
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
export const taxonomySchema = z.object({
  id: segment,
  slug: segment,
  name: z.string().trim().min(1),
  description: z.string().default(''),
  indexable: z.boolean().default(false),
  aliases: z.array(z.string().regex(/^\/(?:[^\s?#]+\/)?$/)).optional(),
}).strict();
export const topicSchema = z.object({
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
    try { const u = new URL(`https://${s}`); return u.host === s && u.pathname === '/' && s.includes('.') && !u.port; }
    catch { return false; }
  }, '網域請填 example.com，不含 https://、路徑或連接埠。'),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  author: z.string().trim().min(1),
  language: z.literal('zh-TW').default('zh-TW'),
  indexable: z.boolean().default(false),
  productionBranch: z.string().default('main'),
  gtmId: z.string().regex(/^(GTM-[A-Z0-9]+)?$/).default(''),
  pageSize: z.number().int().min(1).max(50).default(12),
  // Google XML Sitemap：POST／PAGE／分類／TAG 各自分片。200 參照 Rank Math 的易管理預設，不是 Google 的必要上限。
  sitemap: z.object({ maxUrls: z.number().int().min(1).max(50000).default(200) }).strict().prefault({ maxUrls: 200 }),
  minArchiveItems: z.number().int().min(2).default(2),
  blogIndexable: z.boolean().default(true),
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
    provider: z.enum(['b2', 'r2', 'aws-s3', 'other-s3']),
    endpoint: z.string().refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password &&
          !url.search && !url.hash && url.pathname === '/' &&
          url.hostname.includes('.') && url.hostname !== 'localhost';
      } catch { return false; }
    }, 'S3 端點必須為 HTTPS 根網址，不得帶帳密、查詢參數或路徑。'),
    region: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  }).strict().optional(),
  media: z.object({
    _說明: z.string().optional(),
    bucket: z.string().regex(/^[A-Za-z0-9-]+$/),
    cdnBase: z.string().refine((s) => !s || (s.startsWith('https://') && !/[?#]/.test(s))).default(''),
  }).strict(),
}).strict().superRefine((site, ctx) => {
  if (site.storage && !site.media.cdnBase) {
    ctx.addIssue({ code: 'custom', path: ['media', 'cdnBase'], message: '使用 S3 儲存時必須設定圖片 CDN 網址。' });
  }
});
export type Site = z.infer<typeof siteSchema>;
export type PostData = z.infer<typeof postSchema>;
export type PageData = z.infer<typeof pageSchema>;
export type Taxonomy = z.infer<typeof taxonomySchema>;
export type Topic = z.infer<typeof topicSchema>;
export type Cover = z.infer<typeof imageSchema>;
