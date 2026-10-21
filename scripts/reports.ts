import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { makeModel, pathFor } from '../src/lib/model';
import { loadSite } from '../src/lib/settings';
import { readInput, run } from './lib/content';
run(() => {
  const input = readInput();
  const model = makeModel(input, loadSite());
  const cell = (s: string) => s.replace(/\|/g, '／').replace(/\n/g, ' ');
  const link = (file: string) => `[開啟內容](../${file})`;
  const lines = [
    '# 網站結構總覽', '',
    '> 由真實內容自動產生。請執行 `npm run docs:update` 更新，不要直接改這份表。', '',
    `網站：**${model.site.title}**　正式網域：\`${model.site.domain}\``, '',
    `目前有 **${model.posts.length} 篇公開文章**、**${model.pages.length} 個公開獨立頁面**、**${model.routes.length} 個網站網址**。`, '',
    '文章固定使用「／分類／文章網址／」；獨立頁面使用「／頁面網址／」。範例一律不開放索引。', '',
    '## 網址與原始檔案', '', '| 網址 | 類型 | 標題 | 內容位置 | 個別索引限制 |', '| --- | --- | --- | --- | --- |',
    ...model.routes.map(r => `| [${cell(r.path)}](https://${model.site.domain}${r.path}) | ${{ home: '首頁', blog: '文章索引', post: '文章', page: '獨立頁面', category: '分類', tag: '標籤' }[r.kind]} | ${cell(r.title)} | ${r.document ? link(r.document.file) : '自動產生'} | ${r.document?.data.sample ? '範例：不收錄' : r.document?.data.noindex ? '指定不收錄' : r.kind === 'tag' || r.kind === 'category' ? '依分類／標籤設定及篇數判斷' : (r.page ?? 1) > 1 ? '分頁：不收錄' : '另受整站與預覽環境設定控制'} |`),
    '', '## 草稿與預約文章', '', '| 標題 | 網址 | 狀態 | 內容位置 |', '| --- | --- | --- | --- |',
    ...[...input.posts, ...input.pages].filter(d => !model.routes.some(r => r.document?.data.uid === d.data.uid)).map(d => `| ${cell(d.data.title)} | ${pathFor(d, input.categories)} | ${d.data.draft ? '草稿，不輸出網頁' : '尚未到台灣發布日，不輸出網頁'} | ${link(d.file)} |`),
    '', '## 主題群集', '', '| 主題 | 中心頁 | 公開子文章 |', '| --- | --- | --- |',
    ...input.topics.map(t => { const hub = [...input.posts, ...input.pages].find(d => d.data.uid === t.hub)!; return `| ${cell(t.name)} | [${cell(hub.data.title)}](../${hub.file}) | ${model.posts.filter(p => p.data.topic === t.id).map(p => `[${cell(p.data.title)}](../${p.file})`).join('、') || '尚無'} |`; }),
    '', '## 永久轉址', '', '| 舊網址 | 新網址 | 狀態碼 |', '| --- | --- | --- |',
    ...[...model.redirects].map(([from, to]) => `| ${from} | ${to} | 301 |`),
    '', '## 檢查結果在哪裡', '',
    '執行 `npm run build` 後，`.reports/SEO_REPORT.md` 會列出每頁大小、實際連入數、正文連入數與提醒。GitHub Actions（自動檢查）會把它放在「網站驗收報表」下載附件。', '',
    '這份結構表負責列出內容；最終 HTML、失效連結、孤兒頁、圖片及 Sitemap 的查核由建置驗收負責。', '',
  ].join('\n');
  const index = JSON.stringify({ domain: model.site.domain, categories: input.categories, tags: input.tags, topics: input.topics, documents: [...input.posts, ...input.pages].map(d => ({ uid: d.data.uid, title: d.data.title, path: pathFor(d, input.categories), file: d.file, kind: d.kind, draft: d.data.draft, description: d.data.description, ...('category' in d.data ? { category: d.data.category, tags: d.data.tags, topic: d.data.topic } : {}) })) }, null, 2) + '\n';
  mkdirSync('docs', { recursive: true });
  for (const [path, content] of [['docs/SITE_STRUCTURE.md', lines], ['docs/CONTENT_INDEX.json', index]]) {
    if (process.argv.includes('--check')) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== content) throw new Error(`${path} 尚未更新，請執行 npm run docs:update 並一併提交。`);
    } else writeFileSync(path, content);
  }
  console.log('✓ 中文網站結構與 Agent 內容索引已同步。');
});
