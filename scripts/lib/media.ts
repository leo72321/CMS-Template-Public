import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { Site } from '../../src/lib/schema';
import type { ImageUpload } from './b2';
import { mediaBase } from '../../src/lib/settings';

// Preserve the exact source bytes and dimensions. Never generate WebP, resized
// copies or a second OG asset; the original also serves as the share image.
export async function prepareMedia(file: string | Buffer, site: Site, path: string, name: string, cover: boolean): Promise<ImageUpload[]> {
  void cover;
  const bytes = typeof file === 'string' ? readFileSync(file) : file;
  if (!bytes.length) throw new Error('圖片不能是空檔案。');
  const metadata = await sharp(bytes, { animated: false }).metadata();
  const formats: Record<string, { extension: string; contentType: string }> = {
    jpeg: { extension: 'jpg', contentType: 'image/jpeg' },
    png: { extension: 'png', contentType: 'image/png' },
    webp: { extension: 'webp', contentType: 'image/webp' },
    avif: { extension: 'avif', contentType: 'image/avif' },
    gif: { extension: 'gif', contentType: 'image/gif' },
  };
  const format = formats[metadata.format ?? ''];
  if (!format || !metadata.width || !metadata.height) {
    throw new Error('原檔格式不適合直接在網頁顯示；請使用 JPG、PNG、WebP、AVIF 或 GIF。TIFF/HEIF 不會暗中轉檔。');
  }
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const relative = `${path.replace(/^\/+|\/+$/g, '')}/${name}-${hash}.${format.extension}`;
  return [{
    bytes,
    objectName: `${site.domain}/${relative}`,
    contentType: format.contentType,
    width: metadata.width,
    height: metadata.height,
    url: mediaBase(site) + relative.split('/').map(encodeURIComponent).join('/'),
  }];
}
