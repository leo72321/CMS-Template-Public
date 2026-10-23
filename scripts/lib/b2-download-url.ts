// 僅在使用者主動選擇 B2 原生公開連結時才向 B2 查詢下載主機。
// 此動作不會建立 Bucket，也不會更改公私權限。
export async function getB2DownloadPrefix(
  keyId: string,
  applicationKey: string,
  bucket: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: { Authorization: 'Basic ' + Buffer.from(keyId + ':' + applicationKey).toString('base64') },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('無法取得 B2 原生下載網址（HTTP ' + response.status + '）；請改填自訂 CDN URL，或檢查 B2 金鑰權限。');
  const auth = await response.json() as { apiInfo?: { storageApi?: { downloadUrl?: string } } };
  const base = (auth.apiInfo?.storageApi?.downloadUrl ?? '').trim();
  let url: URL;
  try { url = new URL(base); } catch { throw new Error('B2 未提供有效的原生下載網址，請填自訂 CDN URL。'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.backblazeb2.com')
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('B2 原生下載端點不是可信任的 HTTPS 主機。');
  }
  return url.origin + '/file/' + encodeURIComponent(bucket) + '/';
}
