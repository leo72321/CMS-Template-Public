import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import matter from 'gray-matter';
import { readInput, run } from './lib/content';
import { loadSite } from '../src/lib/settings';
import { segment } from '../src/lib/schema';
import { pathFor } from '../src/lib/model';
import { prepareMedia } from './lib/media';
import { uploadB2, type Receipt } from './lib/b2';
import { uploadS3 } from './lib/s3';
run(async () => {
  const { values } = parseArgs({ options: { uid: { type: 'string' }, file: { type: 'string' }, alt: { type: 'string' }, name: { type: 'string', default: 'image' }, cover: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('用法：npm run media:add -- --uid 內容識別碼 --file 圖片路徑 --alt 替代文字 [--cover] [--name 圖片名稱] [--dry-run]\n內文插圖先放 <!-- 圖片:名稱 --> 占位符；封面使用 --cover。dry-run 只預覽，不上傳 S3／B2。'); return; }
  if (!values.uid || !values.file || !values.alt?.trim()) throw new Error('請提供 --uid、--file、--alt；加 --help 可查看中文說明。');
  const site = loadSite();
  if (site.domain === 'example.com') throw new Error('請先執行 site:init 設定自己的網域。');
  const input = readInput();
  const doc = [...input.posts, ...input.pages].find(d => d.data.uid === values.uid);
  if (!doc) throw new Error(`找不到 uid：${values.uid}`);
  const name = segment.parse(values.cover ? 'cover' : values.name);
  const original = readFileSync(doc.file, 'utf8');
  const parsed = matter(original);
  const marker = `<!-- 圖片:${name} -->`;
  if (!values.cover && parsed.content.split(marker).length !== 2) throw new Error(`請在內文放入唯一一個 ${marker} 占位符，再執行指令。`);
  const items = await prepareMedia(values.file, site, pathFor(doc, input.categories), name, !!values.cover);
  if (values['dry-run']) { console.log(JSON.stringify({ 說明: '僅預覽，尚未上傳或更新文章。', 圖片: items.map(({ bytes, ...item }) => ({ ...item, bytes: bytes.length })) }, null, 2)); return; }
  let receipts: Receipt[];
  if (site.storage) {
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('缺少 S3_ACCESS_KEY_ID 或 S3_SECRET_ACCESS_KEY。請放在本機 .env 或 GitHub Secrets，勿提交到倉庫。');
    }
    receipts = await uploadS3(items, {
      endpoint: site.storage.endpoint,
      region: site.storage.region,
      bucket: site.media.bucket,
      accessKeyId,
      secretAccessKey,
    });
  } else {
    // 未執行新初始化精靈的舊站保留原 B2 Native 流程。
    const { B2_APPLICATION_KEY_ID: keyId, B2_APPLICATION_KEY: key, B2_BUCKET_ID: bucketId } = process.env;
    if (!keyId || !key || !bucketId) throw new Error('缺少 B2 Native 設定。請參照 .env.example。');
    receipts = await uploadB2(items, { keyId, key, bucketId });
  }
  const variants = items.filter(i => i.contentType === 'image/webp');
  const main = variants.at(-1)!;
  if (values.cover) parsed.data.cover = { url: main.url, alt: values.alt, width: main.width, height: main.height, variants: variants.map(i => ({ url: i.url, width: i.width })), ogUrl: items.find(i => i.contentType === 'image/jpeg')!.url };
  else parsed.content = parsed.content.replace(marker, `![${values.alt.replace(/[\[\]\n]/g, '')}](${main.url})`);
  const manifest = JSON.parse(readFileSync('content/media/manifest.json', 'utf8')) as { uploads: (Receipt & { variants?: { url: string; width: number }[] })[] };
  for (const receipt of receipts) {
    manifest.uploads = manifest.uploads.filter(r => r.url !== receipt.url);
    manifest.uploads.push({ ...receipt, ...(receipt.url === main.url ? { variants: variants.map(i => ({ url: i.url, width: i.width })) } : {}) });
  }
  // 只有全部圖片通過 B2 校驗及 CDN 讀取測試，才改寫本機檔案。
  if (readFileSync(doc.file, 'utf8') !== original) throw new Error('上傳期間文章已被其他程序修改，請重新執行；這次未覆寫文章。');
  writeFileSync('content/media/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(doc.file, matter.stringify(parsed.content, parsed.data));
  console.log(`✓ 圖片已縮圖、上傳、驗證並填回 ${doc.file}\n${main.url}\n請執行 npm run verify，再提交文章與 manifest.json。`);
});
