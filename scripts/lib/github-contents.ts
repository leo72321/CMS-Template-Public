import { Buffer } from 'node:buffer';

// GitHub Actions 內建的 GITHUB_TOKEN + contents: write 即可保存檔案，無需使用者新增 PAT。
// 限制可修改的路徑；不接受任意輸入的 Repo/相對路徑。
export const allowedGeneratedFiles = new Set([
  'site.config.json',
  'content/redirect-ledger.json',
  'content/url-lock.json',
  'docs/SITE_STRUCTURE.md',
  'docs/CONTENT_INDEX.json',
]);

export type SaveOptions = {
  repo: string;
  token: string;
  path: string;
  content: string;
  branch?: string;
  fetcher?: typeof fetch;
};

export async function saveGithubContent(input: SaveOptions): Promise<'unchanged' | 'updated'> {
  if (!allowedGeneratedFiles.has(input.path)) throw new Error('此工作流程不可修改指定路徑：' + input.path);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repo)) throw new Error('GITHUB_REPOSITORY 格式不正確。');
  if (!input.token) throw new Error('GitHub Actions 預設 GITHUB_TOKEN 未提供，請檢查 workflow contents: write 權限。');
  const branch = input.branch ?? 'main';
  if (branch !== 'main') throw new Error('此動作只允許儲存至 main。');
  const url = 'https://api.github.com/repos/' + input.repo + '/contents/'
    + input.path.split('/').map(encodeURIComponent).join('/');
  const fetcher = input.fetcher ?? fetch;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + input.token,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // 使用 ref=main 讀取遠端當下的 SHA；不以 Runner 的 .git 狀態判斷版本。
  const response = await fetcher(url + '?ref=main', {
    method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('讀取 GitHub 既有檔案失敗：' + input.path + '（HTTP ' + response.status + '）');
  const old = await response.json() as { sha?: string; content?: string; encoding?: string };
  if (!old.sha || old.encoding !== 'base64' || typeof old.content !== 'string') {
    throw new Error('GitHub 目前檔案的 SHA 或 Base64 內容不完整：' + input.path);
  }
  const prior = Buffer.from(old.content.replace(/\s/g, ''), 'base64').toString('utf8');
  if (prior === input.content) return 'unchanged';

  const updated = await fetcher(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: input.path === 'site.config.json'
        ? 'chore(storage): persist verified S3/CDN setup'
        : 'chore(cms): sync verified site metadata ' + input.path,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      sha: old.sha,
      branch,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!updated.ok) throw new Error(
    'GitHub 設定寫入失敗：' + input.path + '（HTTP ' + updated.status
      + '）。若為 409，代表 main 有其他更新，請重新檢查後再執行；不會強制覆蓋。');
  return 'updated';
}
