import { parseArgs } from 'node:util';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import matter from 'gray-matter';
import { spawnSync } from 'node:child_process';
import { readInput, run } from './lib/content';
import { loadSite } from '../src/lib/settings';
import { segment, postSchema, pageSchema, cptSchema } from '../src/lib/schema';
import { todayTaipei } from '../src/lib/model';
import { generateContentUid } from './lib/uid';

run(() => {
  const { values } = parseArgs({ options: {
    type: { type: 'string', default: 'post' }, uid: { type: 'string' },
    title: { type: 'string' }, slug: { type: 'string' },
    category: { type: 'string' }, help: { type: 'boolean' },
  } });
  const site = loadSite();
  const types = ['post', 'page', ...site.contentTypes.map(t => t.id)];
  if (values.help) {
    console.log('建立內容：npm run content:new -- --type post --title 標題 --slug 英文網址 --category 分類ID');
    console.log('建立 CPT：npm run content:new -- --type cars --title 車輛名稱 --slug toyota-altis');
    console.log('UID 自動生成台灣日期＋5位英數；只有舊內容遷移才手動用 --uid。');
    console.log('目前可選內容類型：' + types.join('、')); return;
  }
  if (!types.includes(values.type!)) throw new Error('未知內容類型：' + values.type + '；請先在 site.config.json 的 contentTypes 註冊。');
  if (!values.slug || !values.title) throw new Error('請提供 --slug（網址名稱）與 --title（標題）。UID 由系統自動產生。');
  const slug = segment.parse(values.slug);
  const input = readInput();
  const used = new Set([...input.posts, ...input.pages, ...(input.cpts ?? [])].map(d => d.data.uid));
  const uid = values.uid ? segment.parse(values.uid) : generateContentUid(used);
  if (used.has(uid)) throw new Error('這個 uid 已經使用，請勿重複。');
  if (values.type === 'post' && !input.categories.some(c => c.id === values.category)) {
    throw new Error('POST 請從 content/categories 選擇既有分類 ID。');
  }
  const base = { uid, slug, title: values.title, description: '請填寫內容簡介。', draft: true };
  const type = values.type!;
  const data = type === 'post'
    ? postSchema.parse({ ...base, category: values.category, tags: [], publishedAt: todayTaipei() })
    : type === 'page' ? pageSchema.parse(base)
    : cptSchema.parse({ ...base, type, fields: {}, publishedAt: todayTaipei() });
  const folder = type === 'post' ? 'content/posts' : type === 'page' ? 'content/pages' : 'content/cpt/' + type;
  mkdirSync(folder, { recursive: true });
  const path = folder + '/' + uid + '--' + slug + '.md';
  if (existsSync(path)) throw new Error('檔案已存在：' + path);
  writeFileSync(path, matter.stringify('\n請從二級標題（##）開始撰寫內容。CPT 自訂欄位請編輯 frontmatter.fields。\n', data), { flag: 'wx' });
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/reports.ts'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('草稿已建立，報表更新失敗；請修正後執行 docs:update。');
  console.log('✓ 已建立草稿：' + path + '\n永久 UID：' + uid + '\n完成內容與必填欄位後，將 draft 改成 false，執行 urls:update 與 verify。');
});
