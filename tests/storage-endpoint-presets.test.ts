import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { endpointPresets, endpointPresetIds, storageFormFromEndpointPreset } from '../src/lib/storage-endpoint-presets';
import { resolveStorageForm } from '../src/lib/storage-providers';
import { planStorageConfiguration } from '../scripts/lib/storage-config';
import { siteSchema } from '../src/lib/schema';
import { mediaBase } from '../src/lib/settings';

const input = (preset: string, more: Partial<Parameters<typeof storageFormFromEndpointPreset>[0]> = {}) => ({
  preset, bucket:'wordpress-cdn', cdnUrl:'https://cdn.holeboom.com/file/wordpress-cdn/', ...more,
});
const old = () => ({ domain:'holeboom.com',title:'原網站',description:'說明',author:'作者',
  media:{bucket:'wordpress-cdn',cdnBase:''} });

test('全部端點選單選項都能自動推導 provider／region／HTTPS S3 Endpoint，不必再自己填地址', () => {
  assert.equal(endpointPresetIds.length,33);
  const ids = new Set<string>();
  for (const id of endpointPresetIds) {
    assert.ok(!ids.has(id),'預設端點代碼不可重複：'+id);
    ids.add(id);
    const r2 = id.startsWith('r2-');
    const form = storageFormFromEndpointPreset(input(id, r2 ? { accountId:'a'.repeat(32) } : {}));
    const expected = endpointPresets[id];
    assert.equal(form.provider,expected.provider,id);
    assert.equal(form.region,expected.region,id);
    assert.equal(form.endpoint,
      expected.provider === 'r2'
        ? 'https://' + 'a'.repeat(32) + ('jurisdiction' in expected && expected.jurisdiction ? '.' + expected.jurisdiction : '') + '.r2.cloudflarestorage.com'
        : ('endpoint' in expected ? expected.endpoint : undefined),id);
    assert.equal(new URL(form.endpoint!).protocol,'https:');
    const resolved=resolveStorageForm(form,'holeboom.com');
    assert.equal(resolved.storage.endpoint,form.endpoint);
    assert.equal(resolved.storage.provider,form.provider);
  }
});

test('GitHub Actions 只保留一個 S3 圖床設定入口，包含全部端點並執行真實驗證', () => {
  const workflowFile = '.github/workflows/圖床設定.yml';
  const workflows = readdirSync('.github/workflows').filter(f => f.startsWith('圖床'));
  assert.deepEqual(workflows, ['圖床設定.yml']);
  const content = readFileSync(workflowFile, 'utf8').replace(/\r\n/g, '\n');
  const start = content.indexOf('      endpoint_preset:\n');
  const end = content.indexOf('      bucket:\n', start);
  assert.ok(start >= 0 && end > start);
  const choices = [...content.slice(start, end).matchAll(/^          - ([^\n]+)$/gm)].map(x => x[1]);
  assert.deepEqual(choices, ['choose-endpoint', ...endpointPresetIds, 'custom']);
  assert.match(content, /S3_ACCESS_KEY_ID: \$\{\{ secrets\.S3_ACCESS_KEY_ID \}\}/);
  assert.match(content, /STORAGE_B2_PUBLIC_URL: \$\{\{ inputs\.b2_public_url \}\}/);
  assert.match(content, /S3_SECRET_ACCESS_KEY: \$\{\{ secrets\.S3_SECRET_ACCESS_KEY \}\}/);
  assert.match(content, /run: node --import tsx scripts\/storage-action\.ts/);
  assert.doesNotMatch(content, /run: npm run verify/, '圖床設定不可以整站文章／SEO／301 驗收作為提交前置條件');
  assert.match(content, /node --import tsx scripts\/github-save\.ts site\.config\.json/, '圖床成功後應由 GitHub API 保存網站設定');
  assert.match(content, /GH_TOKEN: \$\{\{ github\.token \}\}/, '必須使用內建 GitHub token 而非新申請的 PAT');
  assert.doesNotMatch(content, /STORAGE_CUSTOM_PROVIDER/);
  try {
    const init = readFileSync('.github/workflows/網站初始化.yml', 'utf8');
    assert.match(init, /INIT_DOMAIN:/);
    assert.doesNotMatch(init, /endpoint_preset:/);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
});

test('B2 us-west-002 的端點及 Region 自動帶入', () => {
  const form = storageFormFromEndpointPreset(input('b2-us-west-002'));
  assert.equal(form.provider, 'b2');
  assert.equal(form.region, 'us-west-002');
  assert.equal(form.endpoint, 'https://s3.us-west-002.backblazeb2.com');
  assert.equal(resolveStorageForm(form, 'holeboom.com').storage.endpoint, form.endpoint);
});

test('已建立的 B2 URL 在選擇同一 Bucket 的 S3 Endpoint 後不改變', () => {
  const before=siteSchema.parse(old());
  const after=planStorageConfiguration(old(),storageFormFromEndpointPreset(input('b2-us-west-004')),12);
  assert.equal(after.storage?.endpoint,'https://s3.us-west-004.backblazeb2.com');
  assert.equal(mediaBase(after),mediaBase(before));
  assert.equal(after.media.bucket,before.media.bucket);
});

test('R2 一般／EU／US／FedRAMP 必須以 Account ID 組成正確的 API Endpoint', () => {
  for(const key of ['r2-standard','r2-eu','r2-us','r2-fedramp']) {
    assert.throws(()=>storageFormFromEndpointPreset(input(key)),/32 位/);
    assert.throws(()=>storageFormFromEndpointPreset(input(key,{accountId:'not-a-real-id'})),/32 位/);
  }
  const full=storageFormFromEndpointPreset(input('r2-eu',{accountId:'b'.repeat(32)}));
  assert.equal(full.region,'auto');
  assert.equal(full.endpoint,'https://'+'b'.repeat(32)+'.eu.r2.cloudflarestorage.com');
});

test('特殊 S3 服務仍可自訂 provider、region、endpoint；預設和手動欄位衝突則拒絕', () => {
  const custom=storageFormFromEndpointPreset(input('custom',{
    customProvider:'akamai',region:'us-ord',endpoint:'https://us-ord-10.linodeobjects.com',
  }));
  assert.equal(custom.provider,'akamai');
  const automatic=storageFormFromEndpointPreset(input('custom',{
    region:'us-west-002',endpoint:'https://s3.us-west-002.backblazeb2.com',
  }));
  assert.equal(automatic.provider,'b2');
  assert.equal(resolveStorageForm(custom,'holeboom.com').storage.endpoint,'https://us-ord-10.linodeobjects.com');
  assert.throws(()=>storageFormFromEndpointPreset(input('custom',{ customProvider:'other-s3' })),/自訂 S3 端點/);
  assert.throws(()=>storageFormFromEndpointPreset(input('choose-endpoint')),/請先/);
  assert.throws(()=>storageFormFromEndpointPreset(input('unknown-provider-region')),/未知/);
  assert.throws(()=>storageFormFromEndpointPreset(input('b2-us-west-004',{region:'us-west-001'})),/不需要另外填 Region/);
  assert.throws(()=>storageFormFromEndpointPreset(input('b2-us-west-004',{endpoint:'https://malicious.example/'})),/B2 手動 S3 Endpoint/);
  assert.equal(storageFormFromEndpointPreset(input('b2-us-west-002', { endpoint:'https://s3.us-west-002.backblazeb2.com' })).endpoint, 'https://s3.us-west-002.backblazeb2.com');
  assert.throws(()=>storageFormFromEndpointPreset(input('aws-us-east-1',{accountId:'1'.repeat(32)})),/只有 Cloudflare/);
});
