import { execFileSync } from 'node:child_process';
import { loadMediaIndex, collectUsedMedia, type MediaEntry, type MediaManifest } from './lib/media-index';
import { planMediaVerification, verifyRemoteMedia, type VerifyMode } from './lib/media-verification';
import { readInput, run } from './lib/content';

// 預設只下載本次新上傳或變更的圖片；--full 手動全掃；--batch-size 200 按週輪流巡檢。
function previousManifest(): Map<string, MediaEntry> | undefined {
  const envSha = process.env.MEDIA_BASE_SHA;
  const ref = envSha && !/^0+$/.test(envSha) ? envSha : envSha ? undefined : 'HEAD^';
  if (!ref) return undefined;
  if (ref !== 'HEAD^' && !/^[0-9a-f]{40}$/i.test(ref)) {
    throw new Error('MEDIA_BASE_SHA 必須是 40 位 Git Commit SHA。');
  }
  try {
    const result = execFileSync('git', ['show', ref + ':content/media/manifest.json'], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const data = JSON.parse(result) as MediaManifest;
    if (!Array.isArray(data.uploads)) throw new Error('Git 基準版媒體索引格式不正確。');
    return new Map(data.uploads.map(item => [item.url, item]));
  } catch (error) {
    if (envSha && !/^0+$/.test(envSha)) {
      throw new Error('無法讀取 Git 比較基準 ' + envSha + ' 的媒體紀錄；為避免漏驗圖片，停止本次校驗。請在 CI 先 fetch 該 Commit。' + String(error));
    }
    throw new Error('找不到前一次 Git 媒體索引，為避免不知情下載全站媒體，增量驗證已停止。請取得足夠 Git 歷史，或明確執行 npm run media:verify -- --full。');
  }
}

run(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('media:verify 預設只檢查相對於 Git 基準新增或變更的圖片。選項：--full 全部 CDN 校驗；--batch-size 200 每週輪換 200 張。');
    return;
  }
  const full = args.includes('--full');
  const batchIndex = args.indexOf('--batch-size');
  if (full && batchIndex !== -1) throw new Error('請選擇 --full 或 --batch-size，不可混用。');
  if (args.some((a, i) => a.startsWith('--') && !['--full', '--batch-size'].includes(a))) throw new Error('未知的媒體校驗選項。');
  if (batchIndex !== -1 && !args[batchIndex + 1]) throw new Error('--batch-size 後必須填批次數。');
  const batch = batchIndex !== -1 ? Number(args[batchIndex + 1]) : undefined;
  const mode: VerifyMode = full ? { kind: 'full' } : batch !== undefined ? { kind: 'batch', batchSize: batch } : { kind: 'changed' };
  const { byUrl } = loadMediaIndex();
  const input = readInput(); // 含草稿，避免草稿使用的圖片被忽略。
  const used = collectUsedMedia([...input.posts, ...input.pages], byUrl);
  const previous = mode.kind === 'changed' && used.size ? previousManifest() : undefined;
  const { selected, totalUsed, batch: batchNumber } = planMediaVerification(used, byUrl, previous, mode);
  const count = await verifyRemoteMedia(selected);
  const label = mode.kind === 'full' ? '完整' : mode.kind === 'batch' ? '分批第 ' + ((batchNumber ?? 0) + 1) + ' 批' : '增量';
  console.log('✓ 媒體索引共引用 ' + totalUsed + ' 個遠端檔案；本次' + label + ' CDN 校驗 ' + count + ' 個。未變動媒體不重複下載。');
});
