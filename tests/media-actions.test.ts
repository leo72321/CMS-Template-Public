import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Actions 媒體上傳表單使用既有 S3 Secrets，支援來源 URL/Repo 路徑與安全預覽', () => {
  const workflow = readFileSync('.github/workflows/媒體上傳.yml', 'utf8');
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(workflow, /source_path:/);
  assert.match(workflow, /source_url:/);
  assert.match(workflow, /uid:/);
  assert.match(workflow, /field:/);
  assert.match(workflow, /dry_run:[\s\S]*?default: true/);
  assert.match(workflow, /secrets\.S3_ACCESS_KEY_ID/);
  assert.match(workflow, /secrets\.S3_SECRET_ACCESS_KEY/);
  assert.match(workflow, /args=\(--uid/);
  assert.match(workflow, /scripts\/media\.ts/);
  assert.match(workflow, /git add content\/media\/manifest\.json/);
  assert.match(workflow, /git push origin HEAD:main/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /\$\{\{ inputs\.runner == 'self-hosted' && 'self-hosted' \|\| 'ubuntu-latest' \}\}/);
  assert.match(workflow, /if: \$\{\{ !inputs\.dry_run \}\}/);
  assert.ok(workflow.indexOf('取得本次檔案來源') < workflow.indexOf('secrets.S3_ACCESS_KEY_ID'),
    '外部檔案下載應該與 S3 Secrets 分離');
});
