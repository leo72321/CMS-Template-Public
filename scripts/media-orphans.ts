import { mkdirSync, writeFileSync } from 'node:fs';
import { loadSite } from '../src/lib/settings';
import { readInput, run } from './lib/content';
import { collectUsedMedia, loadMediaIndex } from './lib/media-index';

run(() => {
  const { manifest, byUrl } = loadMediaIndex();
  const input = readInput();
  const site = loadSite();
  const used = collectUsedMedia([...input.posts, ...input.pages], byUrl);
  // 有些圖片沒有寫在 Markdown，但仍被全站設定或 SEO 分享圖引用。
  for (const url of [(site as typeof site & { defaultOgImage?: string }).defaultOgImage, site.postFooter.author.photo]) {
    if (url?.startsWith('https://')) used.add(url);
  }
  const unused = manifest.uploads.filter(item => !used.has(item.url));
  const bytes = unused.reduce((n, item) => n + (item.bytes ?? 0), 0);
  mkdirSync('.reports', { recursive: true });
  writeFileSync('.reports/MEDIA_UNUSED.json', JSON.stringify({
    total: manifest.uploads.length,
    used: manifest.uploads.length - unused.length,
    candidates: unused.length,
    candidateBytes: bytes,
    files: unused.map(x => ({ url: x.url, objectName: x.objectName, bytes: x.bytes })),
  }, null, 2) + '\n');
  writeFileSync('.reports/MEDIA_UNUSED.md', [
    '# 可能未引用的媒體（只列報表，不自動刪除）', '',
    '媒體總數：' + manifest.uploads.length,
    '目前內容或已知設定引用：' + (manifest.uploads.length - unused.length),
    '可能未引用：' + unused.length + '（共 ' + (bytes / 1048576).toFixed(2) + ' MiB）', '',
    '> 注意：外部網站直接引用、歷史文章版本、Git 回滾及非 Markdown 的動態使用都無法由此報表完整辨識。請人工確認，勿依本報表直接刪除 B2／S3 檔案。', '',
    ...unused.slice(0, 150).map(x => '- ' + x.url),
    ...(unused.length > 150 ? ['- 其餘請看 MEDIA_UNUSED.json。'] : []),
  ].join('\n') + '\n');
  console.log('✓ 媒體索引 ' + manifest.uploads.length + ' 個；疑似未使用 ' + unused.length + ' 個，報表在 .reports/MEDIA_UNUSED.md（未刪除任何遠端物件）。');
});
