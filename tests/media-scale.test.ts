import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMediaIndex, collectUsedMedia, type MediaEntry } from '../scripts/lib/media-index';
import { planMediaVerification, verifyRemoteMedia } from '../scripts/lib/media-verification';

const payload = Buffer.from('verified-media-bytes');
const sha1 = createHash('sha1').update(payload).digest('hex');
const row = (name: string, digest = sha1): MediaEntry => ({
  url: 'https://cdn.example.com/img/' + name + '.webp',
  sha1: digest, verifiedAt: '2026-10-22T00:00:00Z', width: 640, height: 360,
});

test('媒體索引 Map 可重用，且 manifest 變動後不會用到舊的快取', () => {
  const root = mkdtempSync(join(tmpdir(), 'media-index-unit-'));
  try {
    mkdirSync(join(root, 'content/media'), { recursive: true });
    const path = join(root, 'content/media/manifest.json');
    writeFileSync(path, JSON.stringify({ uploads: [row('a')] }));
    const a = loadMediaIndex(root);
    assert.strictEqual(loadMediaIndex(root), a);
    writeFileSync(path, JSON.stringify({ uploads: [row('a'), row('b')] }));
    const b = loadMediaIndex(root);
    assert.notStrictEqual(a, b);
    assert.equal(b.byUrl.size, 2);
    assert.equal(b.byUrl.get(row('b').url)?.width, 640);
    writeFileSync(path, JSON.stringify({ uploads: [row('a'), row('a')] }));
    assert.throws(() => loadMediaIndex(root), /重複記錄/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Markdown 一次掃描解析遠端 URL，封面與 srcset 尺寸皆納入，不重複請求', () => {
  const big = new Map<string, MediaEntry>();
  for (let i = 0; i < 50000; i++) {
    const item = row(String(i).padStart(5, '0'));
    big.set(item.url, item);
  }
  const main = row('hero');
  main.variants = [{ url: row('sml').url, width: 480 }, { url: main.url, width: 1440 }];
  big.set(main.url, main);
  big.set(row('sml').url, row('sml'));
  const docs = Array.from({ length: 5000 }, (_, i) => ({
    data: { cover: i === 0 ? { url: main.url, ogUrl: row('00000').url, variants: main.variants! } : undefined },
    body: '說明 ![封面](' + row(String(i).padStart(5, '0')).url + ') '
      + '<img src="' + row(String(i).padStart(5, '0')).url + '"> ![連結](https://other.example.com/not-cms.webp)',
  }));
  const used = collectUsedMedia(docs, big);
  assert.equal(used.size, 5002);
  assert.ok(used.has(main.url));
  assert.ok(used.has(row('sml').url));
  assert.ok(used.has(row('00000').url));
  assert.ok(!used.has('https://other.example.com/not-cms.webp'));
});

test('增量模式只重新下載新收據與內容已變的檔案；舊圖不需要再付一次網路成本', async () => {
  const a = row('a'), b = row('b'), c = row('c');
  const current = new Map([[a.url, a], [b.url, b], [c.url, c]]);
  const previous = new Map([[a.url, { ...a }], [b.url, { ...b, sha1: '0'.repeat(40) }]]);
  const plan = planMediaVerification(new Set(current.keys()), current, previous, { kind: 'changed' });
  assert.deepEqual(plan.selected.map(x => x.url), [b.url, c.url]);
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response(payload, { status: 200 }); }) as typeof fetch;
  assert.equal(await verifyRemoteMedia(plan.selected, fetcher), 2);
  assert.equal(calls, 2);
  const repeat = planMediaVerification(new Set(current.keys()), current, current, { kind: 'changed' });
  assert.equal(repeat.selected.length, 0);
  assert.equal(await verifyRemoteMedia(repeat.selected, fetcher), 0);
  assert.equal(calls, 2);
});

test('完整與輪替批次仍可獨立執行，預設驗證 metadata 並保留 fail-closed', () => {
  const receipts = new Map(Array.from({ length: 5 }, (_, i) => { const r = row(String(i)); return [r.url, r] as const; }));
  const used = new Set(receipts.keys());
  assert.equal(planMediaVerification(used, receipts, receipts, { kind: 'full' }).selected.length, 5);
  const batch = planMediaVerification(used, receipts, receipts, { kind: 'batch', batchSize: 2 });
  assert.ok(batch.selected.length > 0 && batch.selected.length <= 2);
  assert.throws(() => planMediaVerification(used, receipts, receipts, { kind: 'batch', batchSize: 0 }), /1–5000/);
  assert.throws(() => planMediaVerification(new Set(['https://cdn.example.com/lost.webp']), receipts, receipts), /沒有媒體上傳驗證紀錄/);
  const wrong = new Map(receipts);
  wrong.set(row('0').url, { ...row('0'), sha1: '' });
  assert.throws(() => planMediaVerification(used, wrong, receipts), /缺少有效雜湊/);
});

test('CDN 不可讀或檔案內容遭替換時停止發佈，併發固定有界', async () => {
  const two = [row('0'), row('1'), row('2'), row('3'), row('4')];
  let active = 0, high = 0;
  const fetcher = (async () => {
    active++; high = Math.max(high, active);
    await Promise.resolve();
    active--;
    return new Response(payload, { status: 200 });
  }) as typeof fetch;
  await verifyRemoteMedia(two, fetcher, 2);
  assert.ok(high <= 2);
  await assert.rejects(verifyRemoteMedia([row('a')], async () => new Response('tampered', { status: 200 })), /校驗失敗/);
  await assert.rejects(verifyRemoteMedia([row('a')], async () => new Response('', { status: 404 })), /校驗失敗/);
  await assert.rejects(verifyRemoteMedia(two, fetcher, 9), /不得超過 8/);
});
