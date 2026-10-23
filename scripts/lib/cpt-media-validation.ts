import { existsSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Cpt } from '../../src/lib/model';
import type { ContentTypeDefinition } from '../../src/lib/schema';
import type { MediaEntry } from './media-index';

// CPT 的圖片、相簿與附件不能只填入看似有效的 HTTPS URL。
// 遷移舊 WP/CDN 資產時，必須先產生有真實校驗依據的媒體收據；此函式不建立假收據。
export function validateCptMediaAssets(
  doc: Cpt,
  type: ContentTypeDefinition,
  receipts: Map<string, MediaEntry>,
  publicRoot = resolve('public'),
): void {
  const root = resolve(publicRoot);
  for (const field of type.fields) {
    if (!['image', 'gallery', 'file'].includes(field.type)) continue;
    const raw = doc.data.fields[field.id];
    const urls = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [];
    for (const url of urls) {
      const label = doc.file + '：CPT ' + type.id + ' 的「' + field.label + '」';
      if (url.startsWith('/')) {
        let path: string;
        try { path = resolve(root, '.' + decodeURIComponent(url)); }
        catch { throw new Error(label + '：本機檔案 URL 編碼無效：' + url); }
        if (!path.startsWith(root + sep) || !existsSync(path) || !statSync(path).isFile()) {
          throw new Error(label + '：本機檔案不存在或超出 public 目錄：' + url);
        }
        continue;
      }
      const receipt = receipts.get(url);
      if (!receipt || !/^[a-f0-9]{40}$/i.test(receipt.sha1 || '')
          || !receipt.verifiedAt || !Number.isFinite(Date.parse(receipt.verifiedAt))) {
        throw new Error(label + '：遠端媒體缺少有效校驗收據：' + url);
      }
      if (field.type !== 'file' && (!Number.isInteger(receipt.width) || (receipt.width ?? 0) <= 0
          || !Number.isInteger(receipt.height) || (receipt.height ?? 0) <= 0)) {
        throw new Error(label + '：圖片媒體收據缺少真實寬高：' + url);
      }
    }
  }
}
