import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { Site } from '../../src/lib/schema';
import type { Upload } from './b2';
import { mediaBase } from '../../src/lib/settings';
export async function prepareMedia(file: string | Buffer, site: Site, path: string, name: string, cover: boolean): Promise<Upload[]> {
  const source = await sharp(file, { animated: false }).rotate().toBuffer();
  const metadata = await sharp(source).metadata();
  if (!['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif'].includes(metadata.format ?? '') || !metadata.width || !metadata.height) throw new Error('請提供 JPG、PNG、WebP、AVIF、TIFF 或 GIF 圖片。GIF 只保留第一格。');
  // 單尺寸 WebP（最大 1440，絕不放大小圖）；封面另外產生一張 OG JPEG。
  const widths = [Math.min(1440, metadata.width!)];
  const items: Upload[] = [];
  const add = async (bytes: Buffer, suffix: string, contentType: string) => {
    const meta = await sharp(bytes).metadata();
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const relative = `${path.replace(/^\/+|\/+$/g, '')}/${name}-${suffix}-${hash}.${contentType === 'image/jpeg' ? 'jpg' : 'webp'}`;
    items.push({ bytes, objectName: `${site.domain}/${relative}`, contentType, width: meta.width!, height: meta.height!, url: mediaBase(site) + relative.split('/').map(encodeURIComponent).join('/') });
  };
  for (const width of widths) await add(await sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality: 80, effort: 5 }).toBuffer(), `${width}w`, 'image/webp');
  if (cover) await add(await sharp(source).resize(1200, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer(), 'og', 'image/jpeg');
  return items;
}
