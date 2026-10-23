import { createHash } from 'node:crypto';
import { checkMediaHead } from './media-head';
export type Upload = { objectName: string; bytes: Buffer; contentType: string; width: number; height: number; url: string };
export type Receipt = { objectName: string; url: string; fileId: string; bytes: number; sha1: string; width: number; height: number; verifiedAt: string; contentType: string };
const sha1 = (bytes: Buffer) => createHash('sha1').update(bytes).digest('hex');
function endpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !(url.hostname === 'api.backblazeb2.com' || url.hostname.endsWith('.backblazeb2.com')) || url.username || url.password) throw new Error('B2 回傳了不受信任的 API 位址。');
  return value;
}
export async function uploadB2(items: Upload[], credentials: { keyId: string; key: string; bucketId: string }, fetcher: typeof fetch = fetch): Promise<Receipt[]> {
  const request = async (url: string, init: RequestInit) => {
    const res = await fetcher(endpoint(url), { ...init, signal: AbortSignal.timeout(60000), redirect: 'error' });
    if (!res.ok) throw new Error(`B2 請求失敗（HTTP ${res.status}）。請檢查金鑰權限、儲存桶及網路。`);
    return res.json();
  };
  // 使用 v4 授權格式，支援單桶及多桶應用程式金鑰。
  const auth = await request('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', { headers: { Authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.key}`).toString('base64')}` } });
  const storage = auth.apiInfo?.storageApi;
  if (!storage?.apiUrl || !auth.authorizationToken) throw new Error('B2 授權回應格式不完整。');
  const allowed = storage.allowed;
  if (!allowed?.capabilities?.includes('writeFiles')) throw new Error('這組 B2 金鑰沒有 writeFiles（上傳檔案）權限。');
  if (allowed.buckets?.length && !allowed.buckets.some((b: { id: string }) => b.id === credentials.bucketId)) throw new Error('這組 B2 金鑰沒有指定儲存桶的權限。');
  if (allowed.namePrefix && items.some(i => !i.objectName.startsWith(allowed.namePrefix))) throw new Error('圖片路徑超出 B2 金鑰允許的前綴。');
  const receipt: Receipt[] = [];
  for (const item of items) {
    const upload = await request(`${storage.apiUrl}/b2api/v4/b2_get_upload_url`, { method: 'POST', headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ bucketId: credentials.bucketId }) });
    const digest = sha1(item.bytes);
    const uploaded = await request(upload.uploadUrl, { method: 'POST', headers: {
      Authorization: upload.authorizationToken,
      'X-Bz-File-Name': item.objectName.split('/').map(encodeURIComponent).join('/'),
      'Content-Type': item.contentType, 'Content-Length': String(item.bytes.length), 'X-Bz-Content-Sha1': digest,
      'X-Bz-Info-b2-cache-control': 'public, max-age=31536000, immutable',
    }, body: new Uint8Array(item.bytes) });
    if (uploaded.contentSha1 !== digest || uploaded.fileName !== item.objectName || Number(uploaded.contentLength) !== item.bytes.length || !uploaded.fileId) throw new Error('B2 回傳的檔案名稱、大小或校驗碼不一致，文章未更新。');
    // B2 已回傳上傳成功；HEAD 只確認連結不死圖，絕不下載整張檔案。
    await checkMediaHead(item.url, item.contentType, fetcher);
    receipt.push({ objectName: item.objectName, url: item.url, fileId: uploaded.fileId, bytes: item.bytes.length, sha1: digest, width: item.width, height: item.height, contentType: item.contentType, verifiedAt: new Date().toISOString() });
  }
  return receipt;
}
