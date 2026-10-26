import { readFileSync } from 'node:fs';
const allSites = JSON.parse(readFileSync(new URL('../config/live-audit-sites.json', import.meta.url), 'utf8')).sites;
const selected = process.argv[2] || 'all';
const domains = allSites.map(s => s.domain);
if (new Set(domains).size !== domains.length) throw new Error('CMS 網域清單有重複資料');
if (allSites.some(s => !/^[a-z0-9.-]+$/.test(s.domain) || !['live', 'pending'].includes(s.state) ||
    !Number.isInteger(s.maxPages) || s.maxPages < 1)) throw new Error('CMS 網域設定格式無效');
if (!['all', 'all-configured'].includes(selected) && !domains.includes(selected)) {
  throw new Error('未知的 CMS 網域：' + selected + '；可用值：all、all-configured、' + domains.join('、'));
}
const sites = selected === 'all-configured' ? allSites :
  selected === 'all' ? allSites.filter(s => s.state === 'live') :
  allSites.filter(s => s.domain === selected);
if (!sites.length) throw new Error('本次無須巡檢的 CMS 網域');
console.log(JSON.stringify({ include: sites }));
