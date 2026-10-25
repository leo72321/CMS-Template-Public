export function isValidDomain(domain: string): boolean {
  return /^(?=.{4,253}$)[a-z0-9-]+(?:\\.[a-z0-9-]+)+$/.test(domain)
    && domain.split('.').every(label => label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

// 所有供應商共用 AWS S3 API / SigV4 上傳器；差別只在連線端點、Region 與 CDN。
export const storageProviderIds = [
  'b2', 'r2', 'aws-s3', 'wasabi', 'digitalocean', 'hetzner',
  'scaleway', 'akamai', 'other-s3',
] as const;
export type StorageProvider = typeof storageProviderIds[number];
export type StorageForm = {
  provider: StorageProvider;
  endpoint?: string;
  region?: string;
  accountId?: string;
  bucket: string;
  cdnUrl: string;
};
export type StorageConnection = { provider: StorageProvider; endpoint: string; region: string };

export function normalizeHttpsEndpoint(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('S3 Endpoint 必須是完整 HTTPS 網址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || url.port || url.hostname === 'localhost'
      || !url.hostname.includes('.') || url.hostname.endsWith('.local')
      || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) || url.hostname.startsWith('[')) {
    throw new Error('S3 Endpoint 必須是公開 HTTPS 根網址，不得包含金鑰、私有主機、路徑或參數。');
  }
  return url.origin;
}
export function normalizeCdnPrefix(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('CDN URL 請填完整的 https:// 公開網址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.port || url.hostname === 'localhost' || !url.hostname.includes('.')
      || url.hostname.endsWith('.local') || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
      || url.hostname.startsWith('[') || /%(?:2e|2f)/i.test(value)
      || /\/(?:\.|\.\.)(?:\/|$)/.test(value) || url.pathname.includes('//')) {
    throw new Error('CDN URL 需為公開 HTTPS 網址，可帶 /file/桶名/ 前綴，但不可有帳密、查詢參數或不安全路徑。');
  }
  return url.origin + url.pathname.replace(/\/+$/, '') + '/';
}

export function resolveStorageConnection(form: Pick<StorageForm, 'provider' | 'endpoint' | 'region' | 'accountId'>): StorageConnection {
  const provider = form.provider;
  if (!storageProviderIds.includes(provider)) throw new Error('不支援的儲存服務；請選擇 Other S3 自訂端點。');
  const region = (form.region ?? '').trim() || (provider === 'r2' ? 'auto' : '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(region)) throw new Error('請填服務商實際 Region（R2 可留空，自動使用 auto）。');
  if (provider === 'r2' && region !== 'auto') throw new Error('Cloudflare R2 的 S3 Region 應為 auto。');
  const override = (form.endpoint ?? '').trim();
  let generated = '';
  switch (provider) {
    case 'b2': generated = 'https://s3.' + region + '.backblazeb2.com'; break;
    case 'r2': {
      const accountId = (form.accountId ?? '').trim();
      if (accountId && !/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('R2 Account ID 應為 32 位十六進位字元。');
      if (!override && !accountId) throw new Error('R2 必須提供 Cloudflare Account ID，或自行填完整 S3 Endpoint。');
      generated = accountId ? 'https://' + accountId + '.r2.cloudflarestorage.com' : '';
      break;
    }
    case 'aws-s3': generated = 'https://s3.' + region + (region.startsWith('cn-') ? '.amazonaws.com.cn' : '.amazonaws.com'); break;
    case 'wasabi': generated = 'https://s3.' + region + '.wasabisys.com'; break;
    case 'digitalocean': generated = 'https://' + region + '.digitaloceanspaces.com'; break;
    case 'hetzner': generated = 'https://' + region + '.your-objectstorage.com'; break;
    case 'scaleway': generated = 'https://s3.' + region + '.scw.cloud'; break;
    case 'akamai':
    case 'other-s3':
      if (!override) throw new Error('這家服務的 S3 Endpoint 請從儲存桶後台複製貼上。');
  }
  return { provider, region, endpoint: normalizeHttpsEndpoint(override || generated) };
}

export function resolveStorageForm(form: StorageForm, domain: string) {
  const storage = resolveStorageConnection(form);
  const bucket = form.bucket.trim();
  if (!/^[A-Za-z0-9.-]{3,63}$/.test(bucket) || bucket.includes('..') ||
      bucket.startsWith('.') || bucket.endsWith('.') || bucket.startsWith('-') || bucket.endsWith('-')) {
    throw new Error('Bucket 名稱必須是有效的 3–63 字元儲存桶名稱。');
  }
  const cdnBase = normalizeCdnPrefix(form.cdnUrl);
  if (!isValidDomain(domain)) throw new Error('網站網域格式不正確。');
  // 這個完整網址應能對應 Bucket 物件 key：domain/path/file.webp
  const sampleObjectKey = domain + '/.cms-healthcheck/sample.txt';
  return { storage, bucket, cdnBase, samplePublicUrl: cdnBase + sampleObjectKey };
}
