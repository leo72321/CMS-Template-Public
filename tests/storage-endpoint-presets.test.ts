import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.equal(endpointPresetIds.length,32);
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

test('每個 GitHub Actions 供應商頁面只顯示自己的 S3 Endpoint；八家共用同一執行核心', () => {
  const vendorFiles: [string, string][] = [
    ['B2', 'b2'], ['R2', 'r2'], ['AWS', 'aws-s3'],
    ['Wasabi', 'wasabi'], ['Spaces', 'digitalocean'],
    ['Hetzner', 'hetzner'], ['Scaleway', 'scaleway'], ['Akamai', 'akamai'],
  ];
  const seen = new Set<string>();
  for (const [file, provider] of vendorFiles) {
    const text = readFileSync('.github/workflows/圖床-' + file + '.yml', 'utf8');
    const start = text.indexOf('      endpoint_preset:\n');
    const end = text.indexOf('      bucket:\n', start);
    assert.ok(start >= 0 && end > start, file);
    const choices = [...text.slice(start, end).matchAll(/^          - ([^\n]+)$/gm)].map(x => x[1]);
    const expected = endpointPresetIds.filter(id => endpointPresets[id].provider === provider);
    assert.deepEqual(choices, expected, file + ' 的機房下拉選單必須只包含該廠商');
    for (const id of choices) {
      assert.ok(!seen.has(id), id + ' 不可重複出現在其他廠商');
      seen.add(id);
    }
    assert.match(text, /uses: \.\/\.github\/workflows\/_圖床共用套用\.yml/);
    assert.match(text, /\$\{\{ inputs\.cdn_url \}\}/);
    assert.match(text, /\$\{\{ inputs\.endpoint_preset \}\}/);
    if (provider === 'r2') assert.match(text, /account_id:/);
    else assert.doesNotMatch(text, /account_id:/);
  }
  assert.deepEqual([...seen].sort(), endpointPresetIds.slice().sort());
  const advanced = readFileSync('.github/workflows/圖床設定.yml', 'utf8');
  assert.match(advanced, /endpoint_preset: custom/);
  assert.match(advanced, /custom_provider:/);
  assert.match(advanced, /region:/);
  assert.match(advanced, /endpoint:/);
  assert.doesNotMatch(advanced, /choose-endpoint/);
  const core = readFileSync('.github/workflows/_圖床共用套用.yml', 'utf8');
  assert.match(core, /workflow_call:/);
  assert.match(core, /STORAGE_ENDPOINT_PRESET/);
  assert.match(core, /run: npm run verify/);
  assert.match(core, /git push origin HEAD:main/);
  assert.doesNotMatch(core, /S3_SECRET_ACCESS_KEY/);
  try {
    const init = readFileSync('.github/workflows/網站初始化.yml', 'utf8');
    assert.match(init, /INIT_DOMAIN:/);
    assert.doesNotMatch(init, /endpoint_preset:/);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
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
  assert.equal(resolveStorageForm(custom,'holeboom.com').storage.endpoint,'https://us-ord-10.linodeobjects.com');
  assert.throws(()=>storageFormFromEndpointPreset(input('custom',{ customProvider:'other-s3' })),/自訂 S3 端點/);
  assert.throws(()=>storageFormFromEndpointPreset(input('choose-endpoint')),/請先/);
  assert.throws(()=>storageFormFromEndpointPreset(input('unknown-provider-region')),/未知/);
  assert.throws(()=>storageFormFromEndpointPreset(input('b2-us-west-004',{region:'us-west-001'})),/應留空/);
  assert.throws(()=>storageFormFromEndpointPreset(input('b2-us-west-004',{endpoint:'https://malicious.example/'})),/應留空/);
  assert.throws(()=>storageFormFromEndpointPreset(input('aws-us-east-1',{accountId:'1'.repeat(32)})),/只有 Cloudflare/);
});
