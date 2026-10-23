import { createHash } from 'node:crypto';
import {
  GetBucketAclCommand, GetObjectCommand, ListBucketsCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';

export type StorageProbeInput = {
  endpoint: string;
  region: string;
  bucket?: string;
  preferredBucket?: string;
  domain: string;
  cdnBase: string;
  accessKeyId: string;
  secretAccessKey: string;
  onBucketSelected?: (bucket: string) => void;
};
export type StorageProbeResult = {
  bucket: string;
  listedBuckets: string[] | null;
  bucketAccess: 'public-acl' | 'private-acl' | 'unknown';
  s3Read: boolean;
  cdnRead: boolean;
  testUrl: string;
};

// 流程：列桶（可選）→ 選定桶 → 防遷移檢查 → 上傳 → S3 授權讀回 → CDN 匿名讀回。
// 不會列桶不代表不能上傳；B2 的單桶金鑰可能沒有 listAllBucketNames。
export async function probeS3Storage(
  input: StorageProbeInput,
  options: { client?: S3Client; fetcher?: typeof fetch } = {},
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
    // 必須在任何遠端寫入前檢查既有媒體是否允許切換儲存來源。
    input.onBucketSelected?.(bucket);

    let bucketAccess: StorageProbeResult['bucketAccess'] = 'unknown';
    try {
      const acl = await client.send(new GetBucketAclCommand({ Bucket: bucket }));
      const publicGrant = (acl.Grants ?? []).some(grant =>
        grant.Grantee?.URI?.endsWith('/AllUsers') && ['READ', 'FULL_CONTROL'].includes(grant.Permission ?? ''));
      bucketAccess = publicGrant ? 'public-acl' : 'private-acl';
    } catch {
      // 某些 S3 相容服務未實作 GetBucketAcl，或金鑰無查看 ACL 的權限。
    }

    const bytes = Buffer.from('CMS storage connectivity check v2\n', 'utf8');
    const expected = createHash('sha256').update(bytes).digest('hex');
    const relative = '.cms-healthcheck/' + expected.slice(0, 16) + '.txt';
    const key = input.domain + '/' + relative;
    const url = input.cdnBase.replace(/\/+$/, '') + '/' + key.split('/').map(encodeURIComponent).join('/');
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.length,
      ContentType: 'text/plain; charset=utf-8',
      CacheControl: 'public, max-age=3600',
    }));
    const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!downloaded.Body) throw new Error('S3 上傳成功但授權下載回傳空內容。');
    const s3Bytes = Buffer.from(await downloaded.Body.transformToByteArray());
    if (createHash('sha256').update(s3Bytes).digest('hex') !== expected) {
      throw new Error('S3 下載內容 SHA-256 與上傳檔案不一致。');
    }

    let cdnRead = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetcher(url, {
          redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
        });
        if (response.ok) {
          const data = Buffer.from(await response.arrayBuffer());
          cdnRead = createHash('sha256').update(data).digest('hex') === expected;
        }
      } catch { /* CDN 尚未傳播或權限阻擋，稍後重試。 */ }
      if (cdnRead) break;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1200));
    }
    return { bucket, listedBuckets, bucketAccess, s3Read: true, cdnRead, testUrl: url };
  } finally {
    if (!options.client) client.destroy();
  }
}
