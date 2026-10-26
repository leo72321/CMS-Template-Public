import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const matrix = JSON.parse(process.env.AUDIT_MATRIX || '{"include":[]}');
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const run = (process.env.GITHUB_SERVER_URL || 'https://github.com') + '/' + repo +
  '/actions/runs/' + process.env.GITHUB_RUN_ID;
if (!repo || !token || !Array.isArray(matrix.include) || !matrix.include.length) {
  throw Error('Missing GITHUB_TOKEN, repository or selected audit sites');
}
const headers = {
  authorization: 'Bearer ' + token, accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28', 'user-agent': 'CMS-Live-Audit/2.0',
};
async function api(method, path, body) {
  const response = await fetch('https://api.github.com/repos/' + repo + path, {
    method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('GitHub API ' + method + ' ' + path + ': ' +
    response.status + ' ' + (await response.text()).slice(0, 700));
  return response.status === 204 ? null : await response.json();
}
const existingIssues = [];
for (let page = 1; page <= 5; page++) {
  const list = await api('GET', '/issues?state=open&per_page=100&page=' + page);
  existingIssues.push(...list.filter(issue => !issue.pull_request));
  if (list.length < 100) break;
}
const markdown = [
  '## CMS 正式站巡檢', '',
  '| 網域 | 類型 | 頁面 | 資源 | 確定錯誤 | 提醒 | 結果 |',
  '| --- | --- | ---: | ---: | ---: | ---: | --- |',
];
let failures = 0;
for (const site of matrix.include) {
  const path = join('.reports', 'live-' + site.domain + '.json');
  let report, invalid = '';
  if (!existsSync(path)) invalid = 'Runner 沒有產生巡檢報告';
  else try { report = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { invalid = '報告無法解析：' + String(e); }
  if (report && (!Array.isArray(report.findings) || !Array.isArray(report.truncated))) {
    invalid = '報告結構不正確';
  }
  const errors = report && Array.isArray(report.findings) ?
    report.findings.filter(x => x.severity === 'error') : [];
  const truncated = report && Array.isArray(report.truncated) ? report.truncated : [];
  const bad = !!invalid || errors.length > 0 || truncated.length > 0;
  if (bad) failures++;
  markdown.push('| ' + site.domain + ' | ' + site.state + ' | ' + (report?.pagesChecked ?? '-') +
    ' | ' + (report?.assetsChecked ?? '-') + ' | ' + (report?.errors ?? '-') +
    ' | ' + (report?.warnings ?? '-') + ' | ' + (bad ? '⚠️ 需處理' : '✓ 通過') + ' |');
  // Explicit manual checks of parked/demo sites produce reports but not persistent alerts.
  if (site.state !== 'live') continue;
  const title = '[CMS 巡檢異常] ' + site.domain;
  const issue = existingIssues.find(x => x.title === title);
  if (!bad) {
    if (issue) {
      await api('PATCH', '/issues/' + issue.number, { state: 'closed', state_reason: 'completed' });
      console.log('Resolved issue #' + issue.number + ' for ' + site.domain);
    }
    continue;
  }
  const signature = createHash('sha256').update(JSON.stringify({
    invalid, truncated, errors: errors.map(x => [x.type, x.url, x.status, x.detail]).sort(),
  })).digest('hex').slice(0, 24);
  const marker = '<!-- cms-live-audit-fingerprint:' + signature + ' -->';
  const body = [
    '# ' + site.domain + ' 正式站巡檢異常', '',
    '系統由 CMS-Template-Public 的 GitHub Actions 建立或更新本追蹤單，同一網域不會重複開單。',
    '',
    '本次驗收執行：' + run,
    '頁面：' + (report?.pagesChecked ?? '無報告') +
      '；資源：' + (report?.assetsChecked ?? '無報告') +
      '；確認錯誤：' + errors.length +
      '；未完整掃描項目：' + (truncated.join(', ') || '無'),
    invalid ? '執行異常：' + invalid : '', '',
    '## 待處理',
    ...errors.slice(0, 75).map(x => '- [' + x.type + '] HTTP ' + x.status +
      '；目標：' + String(x.url).slice(0, 450).replaceAll(String.fromCharCode(96), '%60') +
      '；來源：' + String(x.source).slice(0, 450).replaceAll(String.fromCharCode(96), '%60') +
      (x.detail ? '；說明：' + String(x.detail).slice(0, 200) : '')),
    ...truncated.map(x => '- 巡檢不完整：' + x),
    invalid ? '- ' + invalid : '',
    errors.length > 75 ? '- 尚有 ' + (errors.length - 75) + ' 筆，請下載 Actions artifact 查看完整清單。' : '',
    '',
    '注意：這是故障觀測及追蹤，不會自動刪除文章、替換圖片或更動 B2。修復後新一輪通過會自動結案。',
    '', marker,
  ].filter(Boolean).join('\n');
  if (!issue) {
    const created = await api('POST', '/issues', { title, body });
    console.log('Opened issue #' + created.number + ' for ' + site.domain);
  } else if (!issue.body?.includes(marker)) {
    await api('PATCH', '/issues/' + issue.number, { body });
    console.log('Updated issue #' + issue.number + ' for ' + site.domain);
  } else {
    console.log('Unchanged issue #' + issue.number + ' for ' + site.domain);
  }
}
markdown.push('', '完整 JSON 與 Markdown 問題明細請到本次 Actions 的 Artifacts 下載。', '');
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown.join('\n') + '\n');
}
console.log(markdown.join('\n'));
if (failures) process.exitCode = 1;
