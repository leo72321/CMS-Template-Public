// 只檢查公開連結是否能顯示圖片：HEAD 不讀取檔案本文、不重算雜湊。
// 若 CDN 不支援 HEAD，回報需調整 CDN；不偷偷退回下載整張圖。
export async function checkMediaHead(
  url: string,
  expectedType = '',
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!url.startsWith('https://')) throw new Error('媒體 URL 必須是 HTTPS。');
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'HEAD',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch (cause) {
    throw new Error('CDN 圖片連結 HEAD 檢查失敗：' + url, { cause });
  }
  if (!response.ok) {
    throw new Error('CDN 圖片連結無法讀取（HTTP ' + response.status + '）：' + url);
  }
  const receivedType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (expectedType.startsWith('image/') && receivedType && !receivedType.startsWith('image/')) {
    throw new Error('CDN 回應不是圖片（Content-Type: ' + receivedType + '）：' + url);
  }
  if (expectedType.startsWith('text/plain') && receivedType === 'text/html') {
    throw new Error('CDN 測試檔被導向 HTML 網頁，不是實際物件：' + url);
  }
  if (response.headers.get('content-length') === '0') {
    throw new Error('CDN 回應空檔案（Content-Length: 0）：' + url);
  }
}
