import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { saveGithubContent } from '../scripts/lib/github-contents';

const oldFile = 'old config\n';
const newFile = 'new config\n';
const remote = (text: string) => ({ sha: 'old-sha-123', encoding: 'base64', content: Buffer.from(text).toString('base64') });

test('相同內容不會產生重複 commit，使用 Actions GitHub Token 只讀一次', async () => {
  const calls: { url: string; method: string }[] = [];
  const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), method: options?.method ?? 'GET' });
    return Response.json(remote(oldFile));
  }) as typeof fetch;
  const result = await saveGithubContent({
    repo: 'leo72321/holeboom.com', path: 'site.config.json',
    content: oldFile, token: 'example-token', fetcher,
  });
  assert.equal(result, 'unchanged');
  assert.deepEqual(calls.map(x => x.method), ['GET']);
  assert.match(calls[0].url, /contents\/site\.config\.json\?ref=main$/);
});

test('以讀回的 SHA+內建憑證更新 GitHub 內容，而不是本機 git config/push', async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options: options! });
    if (options?.method === 'GET') return Response.json(remote(oldFile));
    return Response.json({ content: { sha: 'new-sha' }, commit: { sha: 'commit-sha' } });
  }) as typeof fetch;
  const status = await saveGithubContent({
    repo:'leo72321/holeboom.com', token:'token-is-from-actions', path:'site.config.json',
    content:newFile, fetcher,
  });
  assert.equal(status,'updated');
  assert.equal(calls.length,2);
  const payload = JSON.parse(String(calls[1].options.body));
  assert.equal(payload.branch,'main');
  assert.equal(payload.sha,'old-sha-123');
  assert.equal(Buffer.from(payload.content,'base64').toString('utf8'),newFile);
  assert.match(payload.message, /storage/);
  assert.equal(calls[1].options.method,'PUT');
  assert.match(JSON.stringify(calls[1].options.headers), /Bearer token-is-from-actions/);
  assert.equal(calls[1].options.redirect, 'error');
});

test('SHA 衝突、非法路徑、缺少 token 不繞過安全限制', async () => {
  const fetcher = (async (_url: string | URL | Request, options?: RequestInit) => {
    if (options?.method === 'GET') return Response.json(remote(oldFile));
    return new Response(null,{status:409});
  }) as typeof fetch;
  await assert.rejects(saveGithubContent({
    repo:'leo72321/holeboom.com',token:'safe',path:'site.config.json',content:newFile,fetcher,
  }),/HTTP 409/);
  await assert.rejects(saveGithubContent({
    repo:'leo72321/holeboom.com',token:'safe',path:'../secrets.env',content:newFile,fetcher,
  }),/不可修改指定路徑/);
  await assert.rejects(saveGithubContent({
    repo:'leo72321/holeboom.com',token:'',path:'site.config.json',content:newFile,fetcher,
  }),/GITHUB_TOKEN 未提供/);
  await assert.rejects(saveGithubContent({
    repo:'leo72321/holeboom.com',token:'safe',branch:'feature',path:'site.config.json',content:newFile,fetcher,
  }),/main/);
});
