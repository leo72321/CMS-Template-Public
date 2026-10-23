import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import matter from 'gray-matter';
import { postSchema, pageSchema, cptSchema, taxonomySchema, topicSchema } from '../../src/lib/schema';
import { makeModel, type Input } from '../../src/lib/model';
import { loadSite, isPreview } from '../../src/lib/settings';
import { redirectHistorySchema } from '../../src/lib/redirect-manager';
export function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(f => f.isDirectory() ? files(join(dir, f.name)) : [join(dir, f.name)]).sort();
}
export function readInput(root = process.cwd()): Input {
  const documents = (kind: 'posts' | 'pages') => files(join(root, 'content', kind)).filter(f => f.endsWith('.md')).map(file => {
    const { data, content: body } = matter(readFileSync(file, 'utf8'));
    try {
      return { data: kind === 'posts' ? postSchema.parse(data) : pageSchema.parse(data), body, file: relative(root, file).split(sep).join('/'), kind: kind === 'posts' ? 'post' : 'page' };
    } catch (error) { throw new Error(`${file}：欄位驗證失敗\n${error}`); }
  });
  const cptDir = join(root, 'content', 'cpt');
  const cpts = existsSync(cptDir) ? files(cptDir).filter(f => f.endsWith('.md')).map(file => {
    const { data, content: body } = matter(readFileSync(file, 'utf8'));
    try { return { data: cptSchema.parse(data), body, file: relative(root, file).split(sep).join('/'), kind: 'cpt' as const }; }
    catch (error) { throw new Error(file + '：CPT 欄位驗證失敗\n' + error); }
  }) : [];
  const json = <T>(name: string, parse: (value: unknown) => T): T[] => files(join(root, 'content', name)).filter(f => f.endsWith('.json')).map(f => parse(JSON.parse(readFileSync(f, 'utf8'))));
  return {
    posts: documents('posts') as Input['posts'], pages: documents('pages') as Input['pages'], cpts,
    categories: json('categories', v => taxonomySchema.parse(v)), tags: json('tags', v => taxonomySchema.parse(v)), topics: json('topics', v => topicSchema.parse(v)),
  };
}
export function readModel(root = process.cwd()) {
  const site = loadSite(root);
  const ledgerFile = join(root, 'content', 'redirect-ledger.json');
  const ledger = existsSync(ledgerFile) ? redirectHistorySchema.parse(JSON.parse(readFileSync(ledgerFile, 'utf8'))) : undefined;
  return makeModel(readInput(root), site, new Date(), isPreview(process.env, site.productionBranch), ledger);
}
export async function run(task: () => unknown | Promise<unknown>) {
  try { await task(); } catch (error) { console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
