import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planStorageConfiguration } from '../scripts/lib/storage-config';
import { storageFormFromEndpointPreset } from '../src/lib/storage-endpoint-presets';

const action = () => readFileSync('scripts/storage-action.ts', 'utf8');
const workflow = () => readFileSync('.github/workflows/圖床設定.yml', 'utf8');

test('圖床設定與 SEO／301／Sitemap／文章驗收解耦，不能因文章舊網址錯誤回滾 S3', () => {
  const cli = action();
  const yml = workflow();
  assert.match(cli, /probeS3Storage\(/, '必須真的連線測試 S3');
  assert.match(cli, /planStorageConfiguration\(/, '必須保留媒體設定防遷移檢查');
  assert.match(cli, /result\.cdnReachable/, '必須確認 CDN HEAD');
  assert.match(cli, /writeFileSync\('site\.config\.json'/, '成功後須寫入設定');
  assert.doesNotMatch(cli, /spawnSync|scripts\/reports\.ts|readModel\(|readInput\(/,
    '圖床設定不可觸發會檢查文章與 301 的整站內容模型');
  assert.match(yml, /run: node --import tsx scripts\/storage-action\.ts/);
  assert.doesNotMatch(yml, /npm run (verify|build|docs:update|urls:check|urls:update)|scripts\/(reports|validate|audit|redirects)\.ts/,
    '圖床工作流程不應呼叫 SEO、轉址、整站報表或建置');
  assert.match(yml, /^\s+git add -- site\.config\.json$/m, '僅允許儲存圖床網站設定');
  assert.doesNotMatch(yml, /git add[^\n]*(docs\/|content\/)/,
    '圖床工作流程不能提交文章／轉址／網站報表');
  assert.match(yml, /git push origin HEAD:main/, '圖床通過後須永久寫回 main');
});

test('有媒體時驗證同一 Bucket／CDN 可以重用，禁止意外切換既有媒體來源', () => {
  const raw = {
    domain: 'holeboom.com',
    title: '範例站',
    description: '內容測試',
    author: '編輯',
    media: { bucket: 'wordpress-cdn', cdnBase: 'https://cdn.holeboom.com/file/wordpress-cdn/' },
    storage: { provider: 'b2', region: 'us-west-002', endpoint: 'https://s3.us-west-002.backblazeb2.com' },
  };
  const base = { preset: 'b2-us-west-002', bucket: 'wordpress-cdn', cdnUrl: raw.media.cdnBase };
  const good = storageFormFromEndpointPreset(base);
  const result = planStorageConfiguration(raw, good, 19);
  assert.equal(result.media.bucket, 'wordpress-cdn');
  assert.equal(result.media.cdnBase, raw.media.cdnBase);
  assert.equal(result.storage?.endpoint, raw.storage.endpoint);

  assert.throws(
    () => planStorageConfiguration(raw, { ...good, bucket: 'some-other-bucket' }, 19),
    /已有媒體收據/,
  );
  assert.throws(
    () => planStorageConfiguration(raw, { ...good, cdnUrl: 'https://different.example.com/file/wordpress-cdn/' }, 19),
    /已有媒體收據/,
  );
});
