import { readFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import type { Site } from '../../src/lib/schema';
import type { Document } from '../../src/lib/model';
import type { Upload } from './b2';
import { mediaBase } from '../../src/lib/settings';
import { assertCmsMediaPath } from './media-path';

// 明確允許常見文件、壓縮檔與影音附件；不接受可直接執行腳本的 HTML/SVG/JS 等。
// 檔案本體原樣上傳，不讓 Sharp 處理，也不從 CDN 下載回來做雜湊驗證。
export const attachmentTypes: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.rtf': 'application/rtf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};
export const supportedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.gif']);
export const maxAttachmentBytes = 100 * 1024 * 1024; // 100 MiB；避免 Runner 一次讀入過大檔案。

export function isImageFilename(filename: string): boolean {
  return supportedImageExtensions.has(extname(filename).toLowerCase());
}
export function prepareAttachment(file: string, site: Site, objectPath: string, name: string): Upload {
  const extension = extname(file).toLowerCase();
  const contentType = attachmentTypes[extension];
  if (!contentType) throw new Error('不支援此附件副檔名（' + (extension || '無副檔名') + '）。允許：' + Object.keys(attachmentTypes).join('、'));
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,99}$/u.test(name) || name !== name.normalize('NFC')) {
    throw new Error('附件名稱只能使用中文、英數字、底線或連字號，不能包含路徑。');
  }
  const stats = statSync(file);
  if (!stats.isFile() || stats.size === 0) throw new Error('附件必須是非空的一般檔案。');
  if (stats.size > maxAttachmentBytes) throw new Error('附件不得超過 100 MiB，較大的檔案請另外使用分段上傳流程。');
  const bytes = readFileSync(file);
  // 只為避免同名覆蓋與快取污染加本機隨機字尾，不必讀回或比對 CDN 資料。
  const suffix = randomBytes(6).toString('hex');
  const relative = assertCmsMediaPath(objectPath) + '/' + name + '-' + suffix + extension;
  return {
    bytes,
    objectName: site.domain + '/' + relative,
    contentType,
    url: mediaBase(site) + relative.split('/').map(encodeURIComponent).join('/'),
  };
}


export type CptAssetFieldType = 'image' | 'gallery' | 'file';

export function resolveCptAssetField(
  doc: Document,
  site: Site,
  fieldName: string,
  image: boolean,
): CptAssetFieldType {
  if (doc.kind !== 'cpt') throw new Error('--field 只能用在 CPT 內容；Blog／Page 請放內文占位符。');
  const type = site.contentTypes.find(t => t.id === doc.data.type);
  if (!type) throw new Error('尚未註冊 CPT 類型：' + doc.data.type);
  const field = type.fields.find(f => f.id === fieldName);
  if (!field) throw new Error('CPT ' + type.id + ' 沒有欄位：' + fieldName);
  if (image && field.type !== 'image' && field.type !== 'gallery') {
    throw new Error('圖片的 --field 必須是 image 或 gallery 欄位：' + fieldName);
  }
  if (!image && field.type !== 'file') {
    throw new Error('PDF／ZIP 等附件的 --field 必須是 file 欄位：' + fieldName);
  }
  return field.type as CptAssetFieldType;
}

export function applyCptAssetField(
  fields: Record<string, unknown>,
  fieldName: string,
  fieldType: CptAssetFieldType,
  url: string,
): Record<string, unknown> {
  if (fieldType === 'gallery') {
    const previous = fields[fieldName];
    if (previous !== undefined && (!Array.isArray(previous) || previous.some(x => typeof x !== 'string'))) {
      throw new Error('CPT 相簿原本的欄位格式錯誤：' + fieldName);
    }
    const urls = Array.isArray(previous) ? previous : [];
    if (urls.length >= 50) throw new Error('CPT 相簿最多 50 張圖片，請先管理現有照片。');
    return { ...fields, [fieldName]: [...urls, url] };
  }
  return { ...fields, [fieldName]: url };
}

export function insertAttachmentLink(body: string, name: string, label: string, url: string): string {
  const marker = '<!-- 檔案:' + name + ' -->';
  if (body.split(marker).length !== 2) throw new Error('請在內文放入唯一一個 ' + marker + ' 占位符，再執行上傳。');
  // 把顯示名稱轉成安全的 Markdown 連結文字，保留文字但避免連結語法注入。
  const safeLabel = label.replace(/[\[\]\\\r\n]/g, ' ').replace(/[\u0000-\u001f]/g, '').trim();
  if (!safeLabel) throw new Error('下載連結文字不能為空。');
  return body.replace(marker, '[下載 ' + safeLabel + '](' + url + ')');
}
