import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getB2DownloadPrefix } from '../scripts/lib/b2-download-url';

test('使用 B2 官方授權回應的 downloadUrl，不能從 S3 端點猜 f002', async () => {
  const calls: { url: string; headers: HeadersInit | undefined }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers });
    return Response.json({ apiInfo: { storageApi: { downloadUrl: 'https://f002.backblazeb2.com' } } });
  }) as typeof fetch;
  const result = await getB2DownloadPrefix('id', 'secret', 'wordpress-cdn', fetcher);
  assert.equal(result, 'https://f002.backblazeb2.com/file/wordpress-cdn/');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/b2api\/v4\/b2_authorize_account$/);
  assert.ok(JSON.stringify(calls[0].headers).includes('Basic'));
});

test('B2 未提供正確 downloadUrl 或授權失敗時不猜下載機房', async () => {
  await assert.rejects(getB2DownloadPrefix('id','key','bucket', (async()=>new Response(null,{status:403})) as typeof fetch), /HTTP 403/);
  await assert.rejects(getB2DownloadPrefix('id','key','bucket', (async()=>Response.json({apiInfo:{storageApi:{downloadUrl:'https://evil.example/'}}})) as typeof fetch), /可信任/);
  await assert.rejects(getB2DownloadPrefix('id','key','bucket', (async()=>Response.json({apiInfo:{storageApi:{}}})) as typeof fetch), /未提供有效/);
});
