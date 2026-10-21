import { createHash } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Upload, Receipt } from './b2';

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

// Backblaze B2、Cloudflare R2、AWS S3 共用 path-style S3 API。
// 使用官方 AWS SDK 的簽章與重試行為，避免手刻 SigV4。
export async function uploadS3(
  items: Upload[],
  config: S3Config,
  fetcher: typeof fetch = fetch,
  suppliedClient?: S3Client,
): Promise<Receipt[]> {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || endpoint.pathname !== '/' ||
      !endpoint.hostname.includes('.') || endpoint.hostname === 'localhost') {
    throw new Error('S3 端點必須是公開 HTTPS 主機，不可有帳密、路徑或查詢參數。');
  }
  if (!config.bucket || !config.region || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error('S3 需要 Bucket、Region、Access Key ID 與 Secret Access Key。');
  }
  const client = suppliedClient ?? new S3Client({
    endpoint: endpoint.origin,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 3,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  const results: Receipt[] = [];
  try {
    for (const item of items) {
      if (!item.objectName || item.objectName.startsWith('/') ||
          item.objectName.split('/').some(part => !part || part === '..' || part === '.')) {
        throw new Error('S3 物件名稱無效，已停止上傳。');
      }
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: item.objectName,
        Body: item.bytes,
        ContentLength: item.bytes.length,
        ContentType: item.contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }), { abortSignal: AbortSignal.timeout(60000) });

      // 真正的驗收標準是 CDN 讀回的位元組和上傳的內容一致，不依賴不一定等於 MD5 的 ETag。
      const expected = createHash('sha256').update(item.bytes).digest('hex');
      let verified = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetcher(item.url, {
            signal: AbortSignal.timeout(30000),
            redirect: 'error',
          });
          if (response.ok) {
            const body = Buffer.from(await response.arrayBuffer());
            verified = createHash('sha256').update(body).digest('hex') === expected;
          }
        } catch {
          verified = false;
        }
        if (verified) break;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1200));
      }
      if (!verified) {
        throw new Error(`S3 上傳成功，但 CDN 無法讀回相同檔案：${item.url}。請檢查子網域、公開讀取權限及 Origin 路徑設定。文章不會更新。`);
      }

      results.push({
        objectName: item.objectName,
        url: item.url,
        fileId: `${config.bucket}/${item.objectName}`,
        bytes: item.bytes.length,
        sha1: createHash('sha1').update(item.bytes).digest('hex'),
        width: item.width,
        height: item.height,
        contentType: item.contentType,
        verifiedAt: new Date().toISOString(),
      });
    }
    return results;
  } finally {
    if (!suppliedClient) client.destroy();
  }
}
