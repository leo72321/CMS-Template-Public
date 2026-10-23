import { loadMediaIndex, collectUsedMedia } from './lib/media-index';
import { planMediaVerification, verifyRemoteMedia, type VerifyMode } from './lib/media-verification';
import { readInput, run } from './lib/content';

// 僅供手動診斷：HEAD 看圖片連結有無死圖，不下載圖片內容，也不依賴 Git 比較基準。
run(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('手動檢查媒體連結：npm run media:verify（全部 HEAD）或 --batch-size 1000（指定分批）；只驗連結狀態，不下載檔案。');
    return;
  }
  const full = args.includes('--full');
  const batchIndex = args.indexOf('--batch-size');
  if (full && batchIndex !== -1) throw new Error('請選擇 --full 或 --batch-size，不可混用。');
  if (args.some(a => a.startsWith('--') && !['--full', '--batch-size'].includes(a))) throw new Error('未知的媒體檢查選項。');
  if (batchIndex !== -1 && !args[batchIndex + 1]) throw new Error('--batch-size 後必須填批次數。');
  const batch = batchIndex !== -1 ? Number(args[batchIndex + 1]) : undefined;
  const mode: VerifyMode = batch !== undefined ? { kind: 'batch', batchSize: batch } : { kind: 'full' };
  const { byUrl } = loadMediaIndex();
  const input = readInput(); // 草稿引用也納入，避免漏掉。
  const used = collectUsedMedia([...input.posts, ...input.pages], byUrl);
  const { selected, totalUsed, batch: batchNumber } = planMediaVerification(used, byUrl, undefined, mode);
  const count = await verifyRemoteMedia(selected);
  const label = mode.kind === 'batch' ? '分批第 ' + ((batchNumber ?? 0) + 1) + ' 批' : '全部';
  console.log('✓ 媒體索引引用 ' + totalUsed + ' 個遠端檔案；手動' + label + ' HEAD 檢查 ' + count + ' 個連結，沒有下載任何圖片內容。');
});
