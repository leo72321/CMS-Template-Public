import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, truncateSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { siteSchema, cptSchema } from '../src/lib/schema';
import { prepareAttachment, isImageFilename, resolveCptAssetField, applyCptAssetField, insertAttachmentLink, maxAttachmentBytes } from '../scripts/lib/attachments';
import { uploadS3 } from '../scripts/lib/s3';
import { uploadB2 } from '../scripts/lib/b2';
import { collectUsedMedia, type MediaEntry } from '../scripts/lib/media-index';
import { planMediaVerification } from '../scripts/lib/media-verification';
import type { Cpt } from '../src/lib/model';

const site = siteSchema.parse({
  domain: 'cars.example.com', title: '中古車', description: '說明', author: '編輯',
  media: { bucket: 'wordpress-cdn', cdnBase: 'https://f002.backblazeb2.com/file/wordpress-cdn/' },
  storage: { provider: 'b2', endpoint: 'https://s3.us-west-002.backblazeb2.com', region: 'us-west-002' },
  contentTypes: [{ id: 'cars', name: '車輛', fields: [
    { id: 'report', label: '車況 PDF', type: 'file' },
    { id: 'photos', label: '車輛相簿', type: 'gallery' },
    { id: 'thumbnail', label: '縮圖', type: 'image' },
    { id: 'brand', label: '廠牌', type: 'text' },
  ] }],
});
const cpt: Cpt = {
  kind: 'cpt', file: 'content/cpt/cars/20261023-abcde.md', body: '測試',
  data: cptSchema.parse({
    uid: '20261023-abcde', type: 'cars', slug: 'toyota',
    title: 'Toyota', description: '中古車', draft: false, fields: {},
  }),
};
function fixture(action: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'cms-attachment-'));
  try { action(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('PDF 與 ZIP 原檔上傳，保持內容與副檔名，不經過圖片轉檔，物件依 CPT/UID 存放', () => {
  fixture(dir => {
    for (const ext of ['pdf', 'zip']) {
      const file = join(dir, 'report.' + ext);
      const bytes = Buffer.from(ext === 'pdf' ? '%PDF-1.7\nhello' : 'PK\x03\x04mock zip');
      writeFileSync(file, bytes);
      const prepared = prepareAttachment(file, site, '/cars/20261023-abcde/', 'report');
      assert.deepEqual(prepared.bytes, bytes);
      assert.equal(prepared.contentType, ext === 'pdf' ? 'application/pdf' : 'application/zip');
      assert.match(prepared.objectName, new RegExp('^cars.example.com/cars/20261023-abcde/report-[a-f0-9]{12}\\.' + ext + '$'));
      assert.ok(prepared.url.startsWith('https://f002.backblazeb2.com/file/wordpress-cdn/cars.example.com/cars/20261023-abcde/'));
      assert.equal(prepared.width, undefined);
      assert.equal(prepared.height, undefined);
    }
  });
});

test('避免非法副檔名、空白附件、過大檔案；圖片仍走 Sharp', () => {
  fixture(dir => {
    const pdf = join(dir, 'report.pdf');
    writeFileSync(pdf, Buffer.alloc(0));
    assert.throws(() => prepareAttachment(pdf, site, '/cars/uid/', 'report'), /非空/);
    writeFileSync(pdf, Buffer.from('ok'));
    const first = prepareAttachment(pdf, site, '/cars/uid/', 'report');
    const second = prepareAttachment(pdf, site, '/cars/uid/', 'report');
    assert.notEqual(first.url, second.url, '多次上傳不能覆蓋既有網址');
    assert.throws(() => prepareAttachment(pdf, site, '/cars/uid/', '../secret'), /名稱/);
    const html = join(dir, 'evil.html'); writeFileSync(html, Buffer.from('<script>'));
    assert.throws(() => prepareAttachment(html, site, '/cars/uid/', 'x'), /不支援/);
    const svg = join(dir, 'evil.svg'); writeFileSync(svg, Buffer.from('<svg/>'));
    assert.throws(() => prepareAttachment(svg, site, '/cars/uid/', 'x'), /不支援/);
    truncateSync(pdf, maxAttachmentBytes + 1);
    assert.throws(() => prepareAttachment(pdf, site, '/cars/uid/', 'report'), /100 MiB/);
    assert.equal(isImageFilename('car.JPG'), true);
    assert.equal(isImageFilename('report.pdf'), false);
  });
});

test('CPT --field 先驗證類型：file 可收 PDF，gallery 只收圖片，誤填不會上傳', () => {
  assert.equal(resolveCptAssetField(cpt, site, 'report', false), 'file');
  assert.equal(resolveCptAssetField(cpt, site, 'photos', true), 'gallery');
  assert.equal(resolveCptAssetField(cpt, site, 'thumbnail', true), 'image');
  assert.throws(() => resolveCptAssetField(cpt, site, 'photos', false), /必須是 file/);
  assert.throws(() => resolveCptAssetField(cpt, site, 'report', true), /必須是 image 或 gallery/);
  assert.throws(() => resolveCptAssetField(cpt, site, 'missing', true), /沒有欄位/);
  assert.throws(() => resolveCptAssetField(cpt, site, 'brand', true), /必須是 image 或 gallery/);
  assert.throws(() => resolveCptAssetField({ ...cpt, kind: 'post' } as never, site, 'report', false), /只能用在 CPT/);
});

test('CPT 相簿追加不覆蓋、檔案欄位更新、容量上限阻擋', () => {
  const url = 'https://cdn.example.com/photo.webp';
  const a = applyCptAssetField({}, 'photos', 'gallery', url);
  assert.deepEqual(a.photos, [url]);
  const b = applyCptAssetField(a, 'photos', 'gallery', 'https://cdn.example.com/two.webp');
  assert.deepEqual(b.photos, [url, 'https://cdn.example.com/two.webp']);
  assert.deepEqual(a.photos, [url], '原陣列不得被意外修改');
  assert.equal(applyCptAssetField({}, 'report', 'file', 'https://cdn.example.com/report.pdf').report, 'https://cdn.example.com/report.pdf');
  assert.throws(() => applyCptAssetField({ photos: Array(50).fill(url) }, 'photos', 'gallery', url), /最多 50/);
  assert.throws(() => applyCptAssetField({ photos: 22 }, 'photos', 'gallery', url), /格式錯誤/);
});

test('一般 Blog / Page 內文能替換檔案占位符為下載連結，不會誤改其他區塊', () => {
  const original = '介紹\n\n<!-- 檔案:report -->\n\n後記';
  assert.equal(insertAttachmentLink(original, 'report', '車況報告.pdf', 'https://cdn.example.com/test.pdf'),
    '介紹\n\n[下載 車況報告.pdf](https://cdn.example.com/test.pdf)\n\n後記');
  assert.throws(() => insertAttachmentLink('無占位符', 'report', '報告', 'https://cdn.example.com/a.pdf'), /占位符/);
  assert.throws(() => insertAttachmentLink('<!-- 檔案:x --><!-- 檔案:x -->', 'x', '報告', 'https://cdn.example.com/a.pdf'), /唯一/);
});

test('S3 PDF/ZIP 只 PutObject 與一次 HEAD，不下載本文；receipt 可省略寬高', async () => {
  const commandCalls: PutObjectCommand[] = [];
  const methods: string[] = [];
  const client = { send: async (command: PutObjectCommand) => { commandCalls.push(command); return {}; } } as unknown as S3Client;
  const bytes = Buffer.from('%PDF-1.5');
  const url = 'https://cdn.example.com/report.pdf';
  const result = await uploadS3([{ bytes, objectName: 'cars.example.com/cars/uid/report.pdf', url, contentType: 'application/pdf' }], {
    endpoint: 'https://s3.us-west-002.backblazeb2.com', region: 'us-west-002', bucket: 'wordpress-cdn', accessKeyId: 'demo', secretAccessKey: 'demo',
  }, (async (_url: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method ?? 'GET');
    return new Response(null, { status: 200, headers: { 'content-type': 'application/pdf' } });
  }) as typeof fetch, client);
  assert.equal(commandCalls[0].input.ContentType, 'application/pdf');
  assert.equal(commandCalls[0].input.ContentLength, bytes.length);
  assert.deepEqual(methods, ['HEAD']);
  assert.equal(result[0].width, undefined);
  assert.equal(result[0].height, undefined);
  assert.equal(result[0].url, url);
  assert.match(result[0].sha1, /^[a-f0-9]{40}$/);
});

test('B2 Native 附件原樣上傳，原生 SHA1 和唯一一次 HEAD 不下載本文', async () => {
  const bytes = Buffer.from('PK\x03\x04archive');
  const digest = createHash('sha1').update(bytes).digest('hex');
  const key = 'cars.example.com/cars/uid/report.zip';
  const url = 'https://f002.backblazeb2.com/file/wordpress-cdn/' + key;
  const methods: string[] = [];
  const fetcher = (async (request: string | URL | Request, init?: RequestInit) => {
    const path = String(request);
    methods.push(init?.method ?? 'GET');
    if (path.includes('b2_authorize_account')) return Response.json({
      authorizationToken: 'auth', apiInfo: { storageApi: { apiUrl: 'https://api001.backblazeb2.com',
        allowed: { capabilities: ['writeFiles'], buckets: [{ id: 'bucket' }] } } },
    });
    if (path.includes('b2_get_upload_url')) return Response.json({ uploadUrl: 'https://pod001.backblazeb2.com/upload', authorizationToken: 'token' });
    if (path.includes('/upload')) {
      assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'application/zip');
      return Response.json({ fileName: key, contentSha1: digest, contentLength: bytes.length, fileId: 'b2-file' });
    }
    return new Response(null, { status: 200, headers: { 'content-type': 'application/zip' } });
  }) as typeof fetch;
  const result = await uploadB2([{ bytes, objectName: key, url, contentType: 'application/zip' }], {
    keyId: 'id', key: 'secret', bucketId: 'bucket',
  }, fetcher);
  assert.deepEqual(methods, ['GET', 'POST', 'POST', 'HEAD']);
  assert.equal(result[0].sha1, digest);
  assert.equal(result[0].width, undefined);
});

test('圖片寬高仍須有效，PDF 不要求寬高；CPT file/gallery 引用不被孤兒掃描誤判', () => {
  const pdf: MediaEntry = { url: 'https://cdn.example.com/report.pdf', sha1: 'a'.repeat(40), verifiedAt: '2026-10-23T08:00:00Z', contentType: 'application/pdf' };
  const img: MediaEntry = { url: 'https://cdn.example.com/photo.webp', sha1: 'a'.repeat(40), verifiedAt: '2026-10-23T08:00:00Z', contentType: 'image/webp', width: 800, height: 600 };
  const refs = new Map([[pdf.url, pdf], [img.url, img]]);
  const used = collectUsedMedia([{ body: '', data: { fields: { report: pdf.url, photos: [img.url] } } }], refs);
  assert.deepEqual([...used].sort(), [img.url, pdf.url].sort());
  assert.equal(planMediaVerification(used, refs, undefined, { kind: 'full' }).selected.length, 2);
  assert.throws(() => planMediaVerification(new Set([img.url]), new Map([[img.url, { ...img, width: undefined }]])), /圖片未記錄寬高/);
});
