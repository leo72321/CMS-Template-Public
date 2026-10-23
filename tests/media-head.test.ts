import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMediaHead } from '../scripts/lib/media-head';

test('圖片連結只送 HEAD，不會 GET 或讀取任何圖片本文', async () => {
  const methods: string[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method ?? 'GET');
    return new Response(null, { status: 200, headers: { 'content-type': 'image/webp', 'content-length': '1250' } });
  }) as typeof fetch;
  await checkMediaHead('https://cdn.example.com/image.webp', 'image/webp', fetcher);
  assert.deepEqual(methods, ['HEAD']);
});

test('HEAD 404、HTML 假圖片、零長度、405 都阻擋死圖', async () => {
  const link = 'https://cdn.example.com/photo.webp';
  const res = (status: number, headers: Record<string, string> = {}) =>
    (async () => new Response(null, { status, headers })) as typeof fetch;
  await assert.rejects(checkMediaHead(link, 'image/webp', res(404)), /HTTP 404/);
  await assert.rejects(checkMediaHead(link, 'image/webp', res(405)), /HTTP 405/);
  await assert.rejects(checkMediaHead(link, 'image/webp', res(200, { 'content-type': 'text/html' })), /不是圖片/);
  await assert.rejects(checkMediaHead(link, 'image/webp', res(200, { 'content-length': '0' })), /空檔案/);
});

test('公開測試檔 HEAD 200 可用，導向 HTML 網頁則不算物件連通', async () => {
  const url = 'https://cdn.example.com/.cms-healthcheck/link-check.txt';
  await checkMediaHead(url, 'text/plain', (async () => new Response(null, { status: 200, headers: { 'content-type': 'text/plain' } })) as typeof fetch);
  await assert.rejects(checkMediaHead(url, 'text/plain',
    (async () => new Response(null, { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch), /被導向 HTML/);
});
