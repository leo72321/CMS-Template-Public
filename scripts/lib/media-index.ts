import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type MediaEntry = {
  url: string;
  sha1: string;
  verifiedAt: string;
  width: number;
  height: number;
  bytes?: number;
  contentType?: string;
  objectName?: string;
  fileId?: string;
  variants?: { url: string; width: number }[];
};
export type MediaManifest = { _說明?: string; uploads: MediaEntry[] };
export type MediaIndex = { manifest: MediaManifest; byUrl: Map<string, MediaEntry> };
export type MediaDocument = {
  body: string;
  data: { cover?: { url: string; ogUrl?: string; variants: { url: string; width: number }[] }; fields?: Record<string, unknown> };
};

// Astro 每篇文章都會執行 Markdown 處理器；用 mtime/大小偵測變更，避免每張圖片都重新讀 JSON + 線性搜尋。
// Map 查詢 O(1)；本機 dev 修改 manifest 後，下次讀取會自動更新。
let cache: { file: string; version: string; value: MediaIndex } | undefined;
export function loadMediaIndex(root = process.cwd()): MediaIndex {
  const file = join(root, 'content', 'media', 'manifest.json');
  const stat = statSync(file);
  const version = [stat.mtimeMs, stat.ctimeMs, stat.size].join(':');
  if (cache?.file === file && cache.version === version) return cache.value;
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as MediaManifest;
  if (!Array.isArray(manifest.uploads)) throw new Error('媒體 manifest.json 必須包含 uploads 陣列。');
  const byUrl = new Map<string, MediaEntry>();
  for (const item of manifest.uploads) {
    if (!item || typeof item.url !== 'string' || !item.url.startsWith('https://')) {
      throw new Error('媒體 manifest 含有無效 URL。');
    }
    if (byUrl.has(item.url)) throw new Error('媒體 manifest 重複記錄圖片：' + item.url);
    byUrl.set(item.url, item);
  }
  const value = { manifest, byUrl };
  cache = { file, version, value };
  return value;
}

// 逐篇 Markdown 線性掃描 URL，不再對每篇文章依序比對所有 5 萬張圖片。
// 這裡保留已引用封面、OG 和 srcset 全尺寸，且涵蓋 Markdown 與內嵌 HTML 的完整 HTTPS URL。
// 本地 /assets 圖片不是遠端儲存物件，留給 HTML 產物驗收處理。
export function collectUsedMedia(docs: Iterable<MediaDocument>, byUrl: Map<string, MediaEntry>): Set<string> {
  const used = new Set<string>();
  const include = (url: string | undefined) => {
    if (!url || url.startsWith('/')) return;
    used.add(url);
    const image = byUrl.get(url);
    for (const variant of image?.variants ?? []) used.add(variant.url);
  };
  for (const doc of docs) {
    const cover = doc.data.cover;
    if (cover) {
      include(cover.url);
      include(cover.ogUrl);
      for (const variant of cover.variants ?? []) include(variant.url);
    }
    // CPT 自訂圖片、相簿、附件也計入引用，不把車輛相簿誤認為孤兒檔。
    for (const value of Object.values(doc.data.fields ?? {})) {
      if (typeof value === 'string' && byUrl.has(value)) include(value);
      if (Array.isArray(value)) for (const url of value) if (typeof url === 'string' && byUrl.has(url)) include(url);
    }
    for (const match of doc.body.matchAll(/https?:\/\/[^\s<>"'()]+/g)) {
      const url = match[0].replace(/[.,;!?]+$/, '');
      if (byUrl.has(url)) include(url);
    }
  }
  return used;
}
