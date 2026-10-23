import { readFileSync } from 'node:fs';
import { saveGithubContent, allowedGeneratedFiles } from './lib/github-contents';

const files = process.argv.slice(2);
if (!files.length) throw new Error('請指定至少一個允許儲存的已產生檔案。');
if (files.some(path => !allowedGeneratedFiles.has(path))) throw new Error('僅允許儲存 CMS 白名單設定與結構檔。');
const repo = process.env.GITHUB_REPOSITORY ?? '';
const token = process.env.GH_TOKEN ?? '';
if (!repo || !token) throw new Error('請從含 contents: write 的 GitHub Actions 執行，讀取內建 GITHUB_TOKEN。');

for (const path of [...new Set(files)]) {
  const result = await saveGithubContent({ repo, token, path, content: readFileSync(path, 'utf8') });
  console.log((result === 'updated' ? '✓ 已儲存 ' : '✓ 未變更 ') + path + ' 到 GitHub main');
}
