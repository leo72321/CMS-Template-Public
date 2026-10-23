import { checkMediaHead } from './media-head';
import { getB2DownloadPrefix } from './b2-download-url';
import { normalizeCdnPrefix } from '../../src/lib/storage-providers';
import {
  GetBucketAclCommand, ListBucketsCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';

export type StorageProbeInput = {
  endpoint: string;
  region: string;
  bucket?: string;
  preferredBucket?: string;
  domain: string;
  cdnBase?: string; // 自訂 CDN 優先，空白時只有明確啟用 B2 公開連結才可替代
  useB2PublicUrl?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  onBucketSelected?: (bucket: string, cdnBase: string) => void;
};
export type StorageProbeResult = {
  bucket: string;
  cdnBase: string;
  listedBuckets: string[] | null;
  bucketAccess: 'public-acl' | 'private-acl' | 'unknown';
  cdnReachable: boolean;
  testUrl: string;
};

// 流程：列桶（可選）→ 選定桶 → 防遷移檢查 → 上傳 → CDN 一次 HEAD，不下載內容。
// 不會列桶不代表不能上傳；B2 的單桶金鑰可能沒有 listAllBucketNames。
export async function probeS3Storage(
  input: StorageProbeInput,
  options: { client?: S3Client; fetcher?: typeof fetch; b2Prefix?: (key: string, secret: string, bucket: string) => Promise<string> } = {},
): Promise<StorageProbeResult> {
  const client = options.client ?? new S3Client({
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: true,
    credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey },
    maxAttempts: 3,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const fetcher = options.fetcher ?? fetch;
  try {
    let listedBuckets: string[] | null = null;
    try {
      const listed = await client.send(new ListBucketsCommand({}));
      listedBuckets = (listed.Buckets ?? []).map(b => b.Name ?? '').filter(Boolean).sort();
    } catch {
      // 無列桶權限，仍可對指定桶做實際 S3 讀寫驗證。
    }

    let bucket = (input.bucket ?? '').trim();
    if (!bucket) {
      if (listedBuckets?.length === 1) bucket = listedBuckets[0];
      else if (input.preferredBucket && listedBuckets?.includes(input.preferredBucket)) bucket = input.preferredBucket;
      else if (listedBuckets === null && input.preferredBucket) bucket = input.preferredBucket;
      else {
        const reason = listedBuckets?.length
          ? '找到多個 Bucket：' + listedBuckets.join('、')
          : '無法自動列出可用 Bucket（可能是金鑰未授權列桶）';
        throw new Error(reason + '。請在設定表單明確填寫 Bucket 名稱，不能隨機挑選。');
      }
    }
    if (!/^[A-Za-z0-9.-]{3,63}$/.test(bucket) || bucket.includes('..')) {
      throw new Error('Bucket 名稱不合法，請確認儲存商後台名稱。');
    }
    // 自訂 CDN 是第一優先；沒有自訂時，只在明確勾選才使用 B2 官方公開網址。
    const customCdn = (input.cdnBase ?? '').trim();
    let cdnBase: string;
    if (customCdn) cdnBase = normalizeCdnPrefix(customCdn);
    else if (input.useB2PublicUrl) {
      if (!input.endpoint.endsWith('.backblazeb2.com')) {
        throw new Error('只有 B2 端點才能開啟原生公開下載網址；其他供應商請填自訂 CDN。');
      }
      const native = options.b2Prefix ?? ((key: string, secret: string, name: string) =>
        getB2DownloadPrefix(key, secret, name, fetcher));
      cdnBase = normalizeCdnPrefix(await native(input.accessKeyId, input.secretAccessKey, bucket));
    } else {
      throw new Error('請優先填自訂 CDN URL；若沒有自訂 CDN，請手動將「B2 原生公開網址」選為開啟。');
    }
    // 既有圖片的來源及公開網址變更防呆，必須先於任何 PutObject。
    input.onBucketSelected?.(bucket, cdnBase);

    let bucketAccess: StorageProbeResult['bucketAccess'] = 'unknown';
    try {
      const acl = await client.send(new GetBucketAclCommand({ Bucket: bucket }));
      const publicGrant = (acl.Grants ?? []).some(grant =>
        grant.Grantee?.URI?.endsWith('/AllUsers') && ['READ', 'FULL_CONTROL'].includes(grant.Permission ?? ''));
      bucketAccess = publicGrant ? 'public-acl' : 'private-acl';
    } catch {
      // 某些 S3 相容服務未實作 GetBucketAcl，或金鑰無查看 ACL 的權限。
    }

    // 固定小檔案僅用於確認 Bucket 可寫、CDN 連結不死；不下載內容。
    const bytes = Buffer.from('CMS S3 connectivity check v3\n', 'utf8');
    const relative = '.cms-healthcheck/link-check-v3.txt';
    const key = input.domain + '/' + relative;
    const url = cdnBase.replace(/\/+$/, '') + '/' + key.split('/').map(encodeURIComponent).join('/');
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.length,
      ContentType: 'text/plain; charset=utf-8',
      CacheControl: 'public, max-age=3600',
    }));
    let cdnReachable = false;
    try {
      await checkMediaHead(url, 'text/plain', fetcher);
      cdnReachable = true;
    } catch {
      // 公開連結不通時不寫入設定，並由呼叫端提供清楚的 CDN/私桶說明。
    }
    return { bucket, cdnBase, listedBuckets, bucketAccess, cdnReachable, testUrl: url };
  } finally {
    if (!options.client) client.destroy();
  }
}
