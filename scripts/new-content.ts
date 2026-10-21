import { parseArgs } from 'node:util';
import { writeFileSync, existsSync } from 'node:fs';
import matter from 'gray-matter';
import { spawnSync } from 'node:child_process';
import { readInput, run } from './lib/content';
import { segment, postSchema, pageSchema } from '../src/lib/schema';
import { todayTaipei } from '../src/lib/model';
run(() => {
  const { values } = parseArgs({ options: { type: { type: 'string', default: 'post' }, uid: { type: 'string' }, title: { type: 'string' }, slug: { type: 'string' }, category: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('用法：npm run content:new -- --type post --uid 內容ID --title 標題 --slug 網址名稱 --category 分類ID\n獨立頁面請用 --type page，不需要分類。新內容預設為草稿。'); return; }
  if (!['post', 'page'].includes(values.type!)) throw new Error('--type 只接受 post（文章）或 page（獨立頁面）。');
  if (!values.uid || !values.slug || !values.title) throw new Error('請提供 --uid（內容 ID）、--slug（網址名稱）與 --title（標題）。加 --help 可查看用法。');
  const uid = segment.parse(values.uid), slug = segment.parse(values.slug);
  const input = readInput();
  if ([...input.posts, ...input.pages].some(d => d.data.uid === uid)) throw new Error('這個 uid 已經使用，請保留識別碼唯一。');
  if (values.type === 'post' && !input.categories.some(c => c.id === values.category)) throw new Error('請從 content/categories 選擇既有分類 ID。');
  const base = { uid, slug, title: values.title, description: '請填寫這個頁面的簡介。', draft: true };
  const data = values.type === 'post' ? postSchema.parse({ ...base, category: values.category, tags: [], publishedAt: todayTaipei() }) : pageSchema.parse(base);
  const path = `content/${values.type === 'post' ? 'posts' : 'pages'}/${uid}.md`;
  if (existsSync(path)) throw new Error(`檔案已存在：${path}`);
  writeFileSync(path, matter.stringify('\n請在這裡撰寫內容，內文從二級標題（##）開始。\n', data), { flag: 'wx' });
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/reports.ts'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('草稿已建立，但結構報表更新失敗，請修正後執行 docs:update。');
  console.log(`✓ 已建立草稿：${path}\n完成內容後將 draft 改成 false，執行 urls:update 與 verify 再提交。`);
});
