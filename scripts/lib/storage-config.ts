import { siteSchema, type Site } from '../../src/lib/schema';
import { mediaBase } from '../../src/lib/settings';
import { resolveStorageForm, type StorageForm } from '../../src/lib/storage-providers';

// 先計算目標設定，不觸碰遠端物件；已有媒體時不允許偷偷切換到不同 Bucket/來源/網址。
export function planStorageConfiguration(raw: unknown, form: StorageForm, existingUploads: number): Site {
  const oldSite = siteSchema.parse(raw);
  const resolved = resolveStorageForm(form, oldSite.domain);
  const nextSite = siteSchema.parse({
    ...oldSite,
    storage: resolved.storage,
    media: { ...oldSite.media, bucket: resolved.bucket, cdnBase: resolved.cdnBase },
  });
  if (!Number.isInteger(existingUploads) || existingUploads < 0) {
    throw new Error('媒體 manifest 中的圖片數量無效。');
  }
  if (existingUploads > 0) {
    const beforePublic = mediaBase(oldSite);
    const afterPublic = mediaBase(nextSite);
    const changeOfBackend = oldSite.storage
      ? oldSite.storage.provider !== nextSite.storage?.provider ||
        oldSite.storage.endpoint !== nextSite.storage?.endpoint ||
        oldSite.storage.region !== nextSite.storage?.region
      : nextSite.storage?.provider !== 'b2';
    if (changeOfBackend || oldSite.media.bucket !== nextSite.media.bucket || beforePublic !== afterPublic) {
      throw new Error('此網站已有媒體收據，禁止直接切換儲存來源、Bucket 或 CDN 圖片公開路徑。請先完成媒體遷移並驗證舊網址。');
    }
  }
  return nextSite;
}
