import { checkMediaHead } from './media-head';
import type { MediaEntry } from './media-index';

export type VerifyMode = { kind: 'changed' | 'full' | 'batch'; batchSize?: number };
const validSha1 = /^[a-f0-9]{40}$/;

export function planMediaVerification(
  used: Set<string>,
  current: Map<string, MediaEntry>,
  previous: Map<string, MediaEntry> | undefined,
  mode: VerifyMode = { kind: 'changed' },
  now = new Date(),
): { selected: MediaEntry[]; totalUsed: number; batch: number | undefined } {
  const all = [...used].sort().filter(url => !url.startsWith('/')).map(url => {
    const receipt = current.get(url);
    if (!receipt) throw new Error('引用的遠端圖片沒有媒體上傳驗證紀錄：' + url);
    if (!validSha1.test(receipt.sha1 || '') ||
        !receipt.verifiedAt || !Number.isFinite(Date.parse(receipt.verifiedAt)) ||
        !Number.isInteger(receipt.width) || receipt.width <= 0 ||
        !Number.isInteger(receipt.height) || receipt.height <= 0) {
      throw new Error('媒體索引缺少有效雜湊、尺寸或上傳驗證時間：' + url);
    }
    return receipt;
  });
  if (mode.kind === 'full') return { selected: all, totalUsed: all.length, batch: undefined };
  if (mode.kind === 'changed') {
    return {
      selected: all.filter(item => {
        const old = previous?.get(item.url);
        return !old || old.sha1 !== item.sha1 || old.verifiedAt !== item.verifiedAt
          || old.width !== item.width || old.height !== item.height;
      }),
      totalUsed: all.length,
      batch: undefined,
    };
  }
  const size = mode.batchSize ?? 200;
  if (!Number.isInteger(size) || size < 1 || size > 5000) throw new Error('媒體巡檢批次數量必須為 1–5000。');
  const batches = Math.max(1, Math.ceil(all.length / size));
  // 使用週序號決定檢查哪個批次：不同執行重複該週不會額外掃到更多檔案。
  const week = Math.floor(now.getTime() / (7 * 86400000));
  const batch = week % batches;
  return { selected: all.slice(batch * size, (batch + 1) * size), totalUsed: all.length, batch };
}

// 手動診斷用：只 HEAD 檢查 URL 是否 2xx、圖片類型正確，不讀取任何媒體本文。
export async function verifyRemoteMedia(
  records: MediaEntry[],
  fetcher: typeof fetch = fetch,
  concurrency = 4,
): Promise<number> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('圖片連結檢查併發數不得超過 8。');
  let cursor = 0;
  const worker = async () => {
    while (cursor < records.length) {
      const item = records[cursor++];
      try {
        await checkMediaHead(item.url, item.contentType || 'image/webp', fetcher);
      } catch (error) {
        throw new Error('圖片 CDN 連結檢查失敗：' + item.url + '（' + String(error) + '）');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, records.length) }, worker));
  return records.length;
}
