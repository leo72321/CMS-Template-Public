import { storageProviderIds, type StorageForm, type StorageProvider } from './storage-providers';

// 官方端點範例：固定候選清單以便在 GitHub Actions 的靜態下拉選單中選取。
// 新機房不在清單中時使用 custom + provider + region + endpoint，不要猜測機房名稱。
export const endpointPresets = {
  "b2-us-west-001": { provider: "b2", region: "us-west-001", endpoint: "https://s3.us-west-001.backblazeb2.com" },
  "b2-us-west-002": { provider: "b2", region: "us-west-002", endpoint: "https://s3.us-west-002.backblazeb2.com" },
  "b2-us-west-004": { provider: "b2", region: "us-west-004", endpoint: "https://s3.us-west-004.backblazeb2.com" },
  "b2-us-east-005": { provider: "b2", region: "us-east-005", endpoint: "https://s3.us-east-005.backblazeb2.com" },
  "b2-eu-central-003": { provider: "b2", region: "eu-central-003", endpoint: "https://s3.eu-central-003.backblazeb2.com" },
  "r2-standard": { provider: "r2", region: "auto", jurisdiction: "" },
  "r2-eu": { provider: "r2", region: "auto", jurisdiction: "eu" },
  "r2-us": { provider: "r2", region: "auto", jurisdiction: "us" },
  "r2-fedramp": { provider: "r2", region: "auto", jurisdiction: "fedramp" },
  "aws-ap-east-2": { provider: "aws-s3", region: "ap-east-2", endpoint: "https://s3.ap-east-2.amazonaws.com" },
  "aws-ap-northeast-1": { provider: "aws-s3", region: "ap-northeast-1", endpoint: "https://s3.ap-northeast-1.amazonaws.com" },
  "aws-ap-southeast-1": { provider: "aws-s3", region: "ap-southeast-1", endpoint: "https://s3.ap-southeast-1.amazonaws.com" },
  "aws-ap-east-1": { provider: "aws-s3", region: "ap-east-1", endpoint: "https://s3.ap-east-1.amazonaws.com" },
  "aws-us-east-1": { provider: "aws-s3", region: "us-east-1", endpoint: "https://s3.us-east-1.amazonaws.com" },
  "aws-eu-central-1": { provider: "aws-s3", region: "eu-central-1", endpoint: "https://s3.eu-central-1.amazonaws.com" },
  "wasabi-ap-northeast-1": { provider: "wasabi", region: "ap-northeast-1", endpoint: "https://s3.ap-northeast-1.wasabisys.com" },
  "wasabi-ap-southeast-1": { provider: "wasabi", region: "ap-southeast-1", endpoint: "https://s3.ap-southeast-1.wasabisys.com" },
  "wasabi-us-east-1": { provider: "wasabi", region: "us-east-1", endpoint: "https://s3.us-east-1.wasabisys.com" },
  "wasabi-eu-central-1": { provider: "wasabi", region: "eu-central-1", endpoint: "https://s3.eu-central-1.wasabisys.com" },
  "do-sgp1": { provider: "digitalocean", region: "sgp1", endpoint: "https://sgp1.digitaloceanspaces.com" },
  "do-nyc3": { provider: "digitalocean", region: "nyc3", endpoint: "https://nyc3.digitaloceanspaces.com" },
  "do-ams3": { provider: "digitalocean", region: "ams3", endpoint: "https://ams3.digitaloceanspaces.com" },
  "do-fra1": { provider: "digitalocean", region: "fra1", endpoint: "https://fra1.digitaloceanspaces.com" },
  "hetzner-fsn1": { provider: "hetzner", region: "fsn1", endpoint: "https://fsn1.your-objectstorage.com" },
  "hetzner-nbg1": { provider: "hetzner", region: "nbg1", endpoint: "https://nbg1.your-objectstorage.com" },
  "hetzner-hel1": { provider: "hetzner", region: "hel1", endpoint: "https://hel1.your-objectstorage.com" },
  "scaleway-fr-par": { provider: "scaleway", region: "fr-par", endpoint: "https://s3.fr-par.scw.cloud" },
  "scaleway-nl-ams": { provider: "scaleway", region: "nl-ams", endpoint: "https://s3.nl-ams.scw.cloud" },
  "scaleway-pl-waw": { provider: "scaleway", region: "pl-waw", endpoint: "https://s3.pl-waw.scw.cloud" },
  "scaleway-it-mil": { provider: "scaleway", region: "it-mil", endpoint: "https://s3.it-mil.scw.cloud" },
  "akamai-us-east": { provider: "akamai", region: "us-east", endpoint: "https://us-east-1.linodeobjects.com" },
  "akamai-us-lax": { provider: "akamai", region: "us-lax", endpoint: "https://us-lax-1.linodeobjects.com" },
  "akamai-jp-tyo-3": { provider: "akamai", region: "jp-tyo-3", endpoint: "https://jp-tyo-1.linodeobjects.com" },
} as const satisfies Record<string, { provider: StorageProvider; region: string; endpoint?: string; jurisdiction?: string }>;

export const endpointPresetIds = Object.keys(endpointPresets) as (keyof typeof endpointPresets)[];
export type EndpointSelection = {
  preset: string;
  customProvider?: string;
  region?: string;
  endpoint?: string;
  accountId?: string;
  bucket: string;
  cdnUrl: string;
};

export function storageFormFromEndpointPreset(selection: EndpointSelection): StorageForm {
  const key = (selection.preset ?? '').trim();
  if (!key || key === 'choose-endpoint') {
    throw new Error('請先從「S3 端點預設」下拉選單選擇正確的供應商和 Bucket 區域。');
  }
  const shared = { bucket: selection.bucket, cdnUrl: selection.cdnUrl };
  if (key === 'custom') {
    // 自訂端點自動辨認已知供應商，不再要求使用者重複選第二次供應商。
    const host = (() => { try { return new URL(selection.endpoint ?? '').hostname.toLowerCase(); } catch { return ''; } })();
    const known: [string, StorageProvider][] = [
      ['.backblazeb2.com', 'b2'], ['.r2.cloudflarestorage.com', 'r2'],
      ['.amazonaws.com.cn', 'aws-s3'], ['.amazonaws.com', 'aws-s3'],
      ['.wasabisys.com', 'wasabi'], ['.digitaloceanspaces.com', 'digitalocean'],
      ['.your-objectstorage.com', 'hetzner'], ['.scw.cloud', 'scaleway'],
      ['.linodeobjects.com', 'akamai'],
    ];
    const inferred = known.find(([suffix]) => host.endsWith(suffix))?.[1] ?? 'other-s3';
    const provider = (selection.customProvider || inferred).trim();
    if (!storageProviderIds.includes(provider as StorageProvider)) {
      throw new Error('自訂 S3 模式必須選擇有效的供應商。');
    }
    if (!selection.region?.trim() || !selection.endpoint?.trim()) {
      throw new Error('使用「自訂 S3 端點」時，請填 Region 與完整 HTTPS Endpoint。');
    }
    return {
      ...shared, provider: provider as StorageProvider,
      region: selection.region.trim(), endpoint: selection.endpoint.trim(),
      accountId: selection.accountId?.trim(),
    };
  }
  const match = Object.prototype.hasOwnProperty.call(endpointPresets, key)
    ? endpointPresets[key as keyof typeof endpointPresets] : undefined;
  if (!match) throw new Error('未知的 S3 端點預設：' + key + '。請使用下拉選單，或改選 custom。');
  if (selection.endpoint?.trim() || selection.region?.trim()) {
    throw new Error('已選擇 S3 端點預設，Region 與手動 Endpoint 應留空；特殊端點請選 custom。');
  }
  if (match.provider !== 'r2' && selection.accountId?.trim()) {
    throw new Error('只有 Cloudflare R2 需要填 Account ID。');
  }
  if (match.provider === 'r2') {
    const id = (selection.accountId ?? '').trim();
    if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error('R2 端點預設需要 32 位十六進位的 Cloudflare Account ID。');
    const jurisdiction = 'jurisdiction' in match && match.jurisdiction ? '.' + match.jurisdiction : '';
    return { ...shared, provider: 'r2', region: 'auto',
      endpoint: 'https://' + id + jurisdiction + '.r2.cloudflarestorage.com', accountId: id };
  }
  return { ...shared, provider: match.provider, region: match.region, endpoint: ('endpoint' in match ? match.endpoint : '') };
}
