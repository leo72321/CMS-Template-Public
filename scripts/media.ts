import { parseArgs } from 'node:util';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { loadMediaIndex, type MediaEntry } from './lib/media-index';
import matter from 'gray-matter';
import { readInput, run } from './lib/content';
import { loadSite } from '../src/lib/settings';
import { segment } from '../src/lib/schema';
import { prepareMedia } from './lib/media';
import { cmsMediaPath } from './lib/media-path';
import { prepareAttachment, isImageFilename, resolveCptAssetField, applyCptAssetField, insertAttachmentLink } from './lib/attachments';
import { uploadB2, type Receipt, type ImageUpload } from './lib/b2';
import { uploadS3 } from './lib/s3';

run(async () => {
  const { values } = parseArgs({ options: {
    uid: { type: 'string' }, file: { type: 'string' }, alt: { type: 'string' },
    name: { type: 'string' }, label: { type: 'string' }, field: { type: 'string' },
    cover: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log([
      '圖片封面：npm run media:add -- --uid UID --file ./cover.jpg --alt 封面說明 --cover',
      '內文圖片：npm run media:add -- --uid UID --file ./photo.jpg --alt 圖片說明 --name photo（內文先放 <!-- 圖片:photo -->）',
      'CPT 相簿：npm run media:add -- --uid UID --file ./car.jpg --alt 車輛照片 --field photos（自動追加到 gallery）',
      'CPT 附件：npm run media:add -- --uid UID --file ./report.pdf --field report（自動填入 file 欄位）',
      '一般文章附件：npm run media:add -- --uid UID --file ./report.pdf --name report --label 車況報告（內文先放 <!-- 檔案:report -->）',
      '支援 PDF、ZIP、Office、CSV、TXT、7Z、RAR、音訊及影片等附件（單檔 <=100 MiB）；圖片只保留原始檔，無轉檔及縮圖。',
      '附加 --dry-run 只列出目標網址，不上傳、不修改任何內容。',
    ].join('\n'));
    return;
  }
  if (!values.uid || !values.file) throw new Error('請提供 --uid 和 --file；使用 --help 查看圖片、CPT 和附件上傳方法。');
  const isImage = isImageFilename(values.file);
  if (isImage && !values.alt?.trim()) throw new Error('圖片必須提供 --alt 替代文字。');
  if (!isImage && values.cover) throw new Error('PDF／ZIP 等附件不能設為文章封面。');
  if (values.cover && values.field) throw new Error('--cover 不能同時指定 --field。');
  const site = loadSite();
  if (site.domain === 'example.com') throw new Error('請先執行 site:init 設定自己的網域。');
  const input = readInput();
  const doc = [...input.posts, ...input.pages, ...(input.cpts ?? [])].find(d => d.data.uid === values.uid);
  if (!doc) throw new Error('找不到 UID：' + values.uid);

  const name = segment.parse(values.cover ? 'cover' : values.name ?? values.field ?? (isImage ? 'image' : 'attachment'));
  const original = readFileSync(doc.file, 'utf8');
  const parsed = matter(original);
  const fieldType = values.field ? resolveCptAssetField(doc, site, values.field, isImage) : undefined;
  if (!values.cover && !fieldType) {
    const marker = '<!-- ' + (isImage ? '圖片:' : '檔案:') + name + ' -->';
    if (parsed.content.split(marker).length !== 2) {
      throw new Error('請在內文放入唯一一個 ' + marker + ' 占位符，再執行上傳。');
    }
  }
  const mediaKind = doc.kind === 'post' ? 'blog' : doc.kind === 'page' ? 'site' : doc.data.type;
  const path = cmsMediaPath(mediaKind, doc.data.uid);
  const items = isImage
    ? await prepareMedia(values.file, site, path, name, !!values.cover)
    : [prepareAttachment(values.file, site, path, name)];
  const imageVariants = isImage ? items.filter((i): i is ImageUpload => i.width !== undefined && i.height !== undefined) : [];
  const main = isImage ? imageVariants.at(-1)! : items[0];
  if (!main) throw new Error('沒有產生可上傳的媒體。');
  const url = main.url;

  // 先檢查欄位型別與相簿容量，避免上傳成功後才因前台資料不合法而無法填回。
  const nextFields = fieldType && values.field
    ? applyCptAssetField(parsed.data.fields ?? {}, values.field, fieldType, url)
    : undefined;
  if (values['dry-run']) {
    console.log(JSON.stringify({
      說明: '僅預覽，沒有上傳，也沒有修改文章或媒體索引',
      UID: doc.data.uid,
      類型: doc.kind,
      寫入目標: values.cover ? 'cover' : fieldType ? 'fields.' + values.field : '正文占位符',
      檔案: items.map(({ bytes, ...item }) => ({ ...item, bytes: bytes.length })),
    }, null, 2));
    return;
  }
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
      accessKeyId, secretAccessKey,
    });
  } else {
    const { B2_APPLICATION_KEY_ID: keyId, B2_APPLICATION_KEY: key, B2_BUCKET_ID: bucketId } = process.env;
    if (!keyId || !key || !bucketId) throw new Error('缺少 B2 Native 設定，請參照 .env.example。');
    receipts = await uploadB2(items, { keyId, key, bucketId });
  }

  if (values.cover) {
    const cover = imageVariants.at(-1)!;
    parsed.data.cover = {
      url: cover.url, alt: values.alt, width: cover.width, height: cover.height,
      variants: [],
      ogUrl: cover.url,
    };
  } else if (fieldType && values.field) {
    parsed.data.fields = nextFields;
  } else if (isImage) {
    const safeAlt = values.alt!.replace(/[\[\]\n\r]/g, ' ');
    parsed.content = parsed.content.replace('<!-- 圖片:' + name + ' -->', '![' + safeAlt + '](' + url + ')');
  } else {
    parsed.content = insertAttachmentLink(parsed.content, name, values.label ?? basename(values.file), url);
  }

  // 與現有圖片共用同一份媒體索引，二進位附件不需 width/height，不會經過 Sharp。
  const stored = loadMediaIndex();
  const records = new Map<string, MediaEntry>(stored.byUrl);
  for (const receipt of receipts) {
    records.set(receipt.url, {
      ...receipt,
      ...(imageVariants.some(i => i.url === receipt.url)
        ? { variants: [] }
        : {}),
    });
  }
  // 只在全部 API 上傳及本次 URL HEAD 成功後，才更新文章與媒體索引。
  if (readFileSync(doc.file, 'utf8') !== original) throw new Error('上傳期間內容被其他程序修改，未覆寫；請重新執行。');
  const manifestFile = 'content/media/manifest.json';
  const originalManifest = readFileSync(manifestFile, 'utf8');
  const current = JSON.parse(originalManifest) as typeof stored.manifest;
  if (!Array.isArray(current.uploads)) throw new Error('媒體清單缺少 uploads。');
  // Re-read the manifest immediately before writing; reject clobbering concurrent uploads.
  const latest = new Map(current.uploads.map(item => [item.url, item] as const));
  for (const receipt of receipts) {
    latest.set(receipt.url, records.get(receipt.url)!);
  }
  const nextManifest = JSON.stringify({ ...current, uploads: [...latest.values()] }, null, 2) + '\n';
  const originalDoc = readFileSync(doc.file, 'utf8');
  if (originalDoc !== original) throw new Error('文章在上傳期間被更新，拒絕覆寫。');
  const nextDoc = matter.stringify(parsed.content, parsed.data);
  const tempManifest = join(dirname(manifestFile), '.manifest-' + randomUUID() + '.tmp');
  const tempDoc = join(dirname(doc.file), '.media-' + randomUUID() + '.tmp');
  try {
    writeFileSync(tempManifest, nextManifest);
    writeFileSync(tempDoc, nextDoc);
    if (readFileSync(manifestFile, 'utf8') !== originalManifest || readFileSync(doc.file, 'utf8') !== original) {
      throw new Error('寫入前偵測到並行修改，拒絕覆寫。');
    }
    renameSync(tempDoc, doc.file);
    try {
      renameSync(tempManifest, manifestFile);
    } catch (error) {
      // A two-file rename is not a transaction. Roll the first file back if the
      // second rename failed, so the workspace is not left in a split state.
      writeFileSync(doc.file, originalDoc);
      throw error;
    }
  } finally {
    try { unlinkSync(tempDoc); } catch { /* already renamed */ }
    try { unlinkSync(tempManifest); } catch { /* already renamed */ }
  }
  console.log('✓ ' + (isImage ? '圖片' : '附件') + '已上傳並以一次 HEAD 確認公開連結：' + url
    + '\n已更新 ' + doc.file + (values.field ? '（fields.' + values.field + '）' : '')
    + '\n請執行 npm run verify，然後提交內容與 content/media/manifest.json。');
});
