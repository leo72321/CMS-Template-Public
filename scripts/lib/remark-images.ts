import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { join } from 'node:path';
import type { Root, RootContent } from 'mdast';
type Node = Root | RootContent;
// 建置時加入內文圖片尺寸，不需訪客端 JavaScript，也不在 CI 下載遠端圖片。
export function mediaImages() {
  return async (tree: Node) => {
    const manifest = JSON.parse(readFileSync('content/media/manifest.json', 'utf8')) as { uploads: { url: string; width: number; height: number; variants?: { url: string; width: number }[] }[] };
    const visit = async (node: Node): Promise<void> => {
      if (node.type === 'image' && node.url) {
        if (!node.alt?.trim()) throw new Error(`圖片缺少 alt（替代文字）：${node.url}`);
        let image = manifest.uploads.find(i => i.url === node.url);
        if (!image && node.url.startsWith('/') && !node.url.startsWith('//') && !node.url.includes('..')) {
          const meta = await sharp(join(process.cwd(), 'public', decodeURIComponent(node.url))).metadata();
          image = { url: node.url, width: meta.width!, height: meta.height! };
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
