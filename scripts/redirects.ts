import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readModel, run } from './lib/content';
import { checkURLs } from './urls';

run(() => {
  const model = readModel();
  const { redirectState } = model;
  const previousPath = 'content/url-lock.json';
  const previous = existsSync(previousPath)
    ? JSON.parse(readFileSync(previousPath, 'utf8')) as { urls: Record<string, string>; redirects: Record<string, string> }
    : { urls: {}, redirects: {} };
  const retiredSet = new Set(Object.entries(redirectState.history.entries)
    .filter(([, record]) => !!record.retiredAt)
    .map(([from]) => from));
  const nextLock = checkURLs(model, previous, retiredSet);
  const historyText = JSON.stringify(redirectState.history, null, 2) + '\n';
  const lockText = JSON.stringify(nextLock, null, 2) + '\n';
  const historyPath = 'content/redirect-ledger.json';
  const notices = redirectState.notices;
  const retirements = redirectState.retired;
  mkdirSync('.reports', { recursive: true });
  const report = {
    rawCandidates: redirectState.candidates,
    active: model.redirects.size,
    maxActive: model.site.redirectManagement.maxActive,
    notices, retired: retirements,
    agePrune: model.site.redirectManagement.agePrune,
  };
  writeFileSync('.reports/REDIRECT_MAINTENANCE.json', JSON.stringify(report, null, 2) + '\n');
  const summary = [
    '# CMS 301 轉址容量維護', '',
    '候選：' + report.rawCandidates + ' 條，實際輸出：' + report.active + ' 條，上限：' + report.maxActive + ' 條。', '',
    '提醒：', ...notices.map(item => '- ' + item.message),
    ...(notices.length ? [] : ['- 本次沒有新增容量提醒。']), '',
    '本次自動退役：' + retirements.length + ' 條。',
    ...retirements.slice(0, 100).map(item => '- ' + item.from + '（' + item.reason + '）'),
    ...(retirements.length > 100 ? ['- 其餘詳見 JSON 報表。'] : []), '',
    '> 日期清理是「首次建立紀錄距今天數」，不是訪客最後存取時間。', '',
  ].join('\n');
  writeFileSync('.reports/REDIRECT_MAINTENANCE.md', summary);
  const issueMessages = [
    ...notices.map(n => '- ' + n.message),
    ...(retirements.length ? ['- 自動退役 ' + retirements.length + ' 條（最舊優先／日期清理）。'] : []),
  ];
  const issue = issueMessages.length ? [
    '## Cloudflare Pages 301 容量提醒', '',
    '候選 ' + report.rawCandidates + ' 條，實際保留 ' + report.active + ' 條。', '',
    ...issueMessages, '', '轉址紀錄：content/redirect-ledger.json', '',
  ].join('\n') : '';
  writeFileSync('.reports/REDIRECT_ISSUE.md', issue);
  for (const item of notices) console.log('::warning::' + item.message);
  if (retirements.length) console.log('::warning::本次自動退役 ' + retirements.length + ' 條轉址，完整紀錄已保留。');
  if (process.argv.includes('--sync')) {
    writeFileSync(historyPath, historyText);
    writeFileSync(previousPath, lockText);
    console.log('✓ 301 轉址歷史與 URL 保護紀錄已同步。');
  } else if (process.argv.includes('--check')) {
    if (!existsSync(historyPath) || readFileSync(historyPath, 'utf8') !== historyText
      || !existsSync(previousPath) || readFileSync(previousPath, 'utf8') !== lockText) {
      throw new Error('301 轉址歷史紀錄尚未同步，請先執行 npm run redirects:sync。');
    }
  }
  console.log('✓ 301 轉址容量維護：候選 ' + report.rawCandidates + '，保留 ' + report.active + '。');
});
