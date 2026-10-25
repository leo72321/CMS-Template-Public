import { readFileSync, writeFileSync } from 'node:fs';
const [kind, ...words] = process.argv.slice(2);
const note = words.join(' ').trim();
if (!['patch','minor','major'].includes(kind) || note.length < 5)
  throw Error('用法：npm run version:bump -- patch|minor|major "這次更新做了什麼"（至少五字）');
const pkg = JSON.parse(readFileSync('package.json','utf8'));
const lock = JSON.parse(readFileSync('package-lock.json','utf8'));
const previous = pkg.version;
const numbers = previous.split('.').map(Number);
if (numbers.length !== 3 || numbers.some(n=>!Number.isInteger(n))) throw Error('目前版本不是 SemVer');
if (kind === 'major') { numbers[0]++;numbers[1]=0;numbers[2]=0; }
if (kind === 'minor') { numbers[1]++;numbers[2]=0; }
if (kind === 'patch') numbers[2]++;
const next = numbers.join('.');
const readme = readFileSync('README.md','utf8');
const match = '目前公版版本：**v' + previous + '**';
if (!readme.includes(match)) throw Error('README 版本與 package.json 不一致，請先檢查版本紀錄');
const changelog = readFileSync('CHANGELOG.md','utf8');
if (!changelog.includes('## [' + previous + ']')) throw Error('CHANGELOG 版本不一致');
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date()).map(p => [p.type, p.value]));
const today = `${parts.year}-${parts.month}-${parts.day}`;
pkg.version = next;
lock.version = next;
lock.packages[''].version = next;
writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
writeFileSync('package-lock.json',JSON.stringify(lock,null,2)+'\n');
writeFileSync('README.md',readme.replace(match,'目前公版版本：**v' + next + '**'));
writeFileSync('CHANGELOG.md',changelog.replace('\n## [' + previous + ']',
  '\n## [' + next + '] - ' + today + '\n\n- ' + note + '\n\n## [' + previous + ']'));
console.log('✓ 已升版：' + previous + ' → ' + next + '，請審核 CHANGELOG，再執行 npm run version:check');
