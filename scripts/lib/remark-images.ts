import { loadMediaIndex } from './media-index';
import sharp from 'sharp';
import { resolve, sep } from 'node:path';
import type { Root, RootContent } from 'mdast';
type Node = Root | RootContent;
// 建置時加入內文圖片尺寸，不需訪客端 JavaScript，也不在 CI 下載遠端圖片。
export function mediaImages() {
  return async (tree: Node) => {
    const { byUrl } = loadMediaIndex();
    const visit = async (node: Node): Promise<void> => {
      if (node.type === 'image' && node.url) {
        if (!node.alt?.trim()) throw new Error(`圖片缺少 alt（替代文字）：${node.url}`);
        let image: { url: string; sha1?: string; verifiedAt?: string; width?: number; height?: number; variants?: { url: string; width: number }[] } | undefined = byUrl.get(node.url);
        if (!image && node.url.startsWith('/') && !node.url.startsWith('//')) {
          const root = resolve(process.cwd(), 'public');
          const decoded = decodeURIComponent(node.url);
          const path = resolve(root, '.' + decoded);
          if (!path.startsWith(root + sep)) throw new Error(`圖片路徑不可超出 public：${node.url}`);
          const meta = await sharp(path).metadata();
          image = { url: node.url, width: meta.width!, height: meta.height! };
        }
        if (!node.url.startsWith('/') && (!image?.verifiedAt || !Number.isFinite(Date.parse(image.verifiedAt)) || !/^[a-f0-9]{40}$/i.test(image.sha1 ?? ''))) {
          throw new Error(`內文圖片缺少有效上傳與 CDN 驗證紀錄，請執行 media:add：${node.url}`);
        }
        if (!image?.width || !image?.height) throw new Error(`內文圖片尚未經過 media:add，或找不到尺寸：${node.url}`);
        node.data = { ...node.data, hProperties: {
          width: image.width, height: image.height, loading: 'lazy', decoding: 'async',
          ...(image.variants?.length ? { srcSet: image.variants.map(i => `${i.url} ${i.width}w`).join(', '), sizes: '(max-width: 760px) 100vw, 760px' } : {}),
        } };
      }
      if ('children' in node) for (const child of node.children) await visit(child);
    };
    await visit(tree);
  };
}
