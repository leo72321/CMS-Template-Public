import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { load } from 'cheerio';
import { readModel, files, run } from './lib/content';
import { normalizePath, encodePath, type Route } from '../src/lib/model';
import { buildSitemapParts, renderSitemapIndex, renderSitemapPart } from '../src/lib/sitemap';
run(() => {
  const model = readModel();
  const errors: string[] = [], warnings: string[] = [];
  const distRoot = resolve('dist');
  const isDistFile = (decodedPath: string) => {
    const full = resolve(distRoot, '.' + decodedPath);
    return full.startsWith(distRoot + sep) && existsSync(full) && statSync(full).isFile();
  };
  const html = new Map<string, { bytes: number; gzip: number; file: string; ids?: Set<string> }>();
  for (const file of files('dist').filter(f => f.endsWith('.html'))) {
    const name = relative('dist', file).split(sep).join('/');
    const path = name === 'index.html' ? '/' : name === '404.html' ? '/404/' : normalizePath(`/${name.replace(/\/index\.html$/, '')}`);
    const raw = readFileSync(file, 'utf8');
    html.set(path, { bytes: Buffer.byteLength(raw), gzip: gzipSync(raw).length, file });
  }
  const edges = new Map<string, Set<string>>(), contextual = new Map<string, Set<string>>();
  const inbound = new Map<string, Set<string>>();
  const pendingHashChecks: Array<{ from: string; resolved: string; id: string; href: string }> = [];
  const expected: Route[] = [...model.routes, { path: '/404/', kind: 'page', noindex: true, title: '找不到這個頁面', description: '找不到頁面' }];
  for (const route of expected) {
    const entry = html.get(route.path);
    if (!entry) { errors.push(`未輸出頁面：${route.path}`); continue; }
    const { bytes, gzip } = entry;
    // Parse only the current page; do not retain thousands of Cheerio DOM trees.
    const $ = load(readFileSync(entry.file, 'utf8'));
    entry.ids = new Set($('[id]').toArray().map(e => $(e).attr('id')!).filter(Boolean));
    if ($('h1').length !== 1) errors.push(`${route.path}：必須且只能有一個 H1（一級標題）。`);
    if ($('html').attr('lang') !== (route.locale ?? model.site.language)) errors.push(route.path + '：HTML lang 與語言設定不一致。');
    if (model.site.i18n.enabled) {
      for (const [locale, alternate] of Object.entries(route.alternates ?? {})) {
        if (!route.noindex && $('link[rel="alternate"][hreflang="'+locale+'"]').attr('href') !== 'https://' + model.site.domain + encodePath(alternate)) errors.push(route.path + '：hreflang 不正確。');
      }
    }
    if ($('title').length !== 1 || !$('title').text().trim()) errors.push(`${route.path}：缺少唯一的頁面標題。`);
    if ($('meta[name="description"]').length !== 1 || !$('meta[name="description"]').attr('content')?.trim()) errors.push(`${route.path}：缺少唯一的 SEO 簡介。`);
    const canonical = `https://${model.site.domain}${encodePath(route.path)}`;
    if ($('link[rel="canonical"]').length !== 1 || $('link[rel="canonical"]').attr('href') !== canonical) errors.push(`${route.path}：Canonical（標準網址）不正確。`);
    const robots = $('meta[name="robots"]').attr('content') ?? '';
    if (route.noindex !== robots.includes('noindex')) errors.push(`${route.path}：索引設定與內容模型不一致。`);
    if ($('meta[property="og:url"]').attr('content') !== canonical) errors.push(`${route.path}：OG 分享網址不正確。`);
    if (!$('script[type="application/ld+json"]').length) errors.push(`${route.path}：缺少結構化資料。`);
    $('script[type="application/ld+json"]').each((_, element) => { try { JSON.parse($(element).text()); } catch { errors.push(`${route.path}：結構化資料不是有效的 JSON。`); } });
    $('script:not([type="application/ld+json"])').each((_, element) => {
      if ((!model.site.gtmId || !$(element).text().includes('www.googletagmanager.com/gtm.js')) && !(model.site.i18n.enabled && model.site.i18n.languageSuggestion && $(element).text().includes('cms:locale-preference:v1'))) errors.push(`${route.path}：出現公版以外的前端 JavaScript，請確認必要性並調整效能規範。`);
    });
    $('img').each((_, element) => {
      const img = $(element);
      if (!img.attr('alt')?.trim() || !Number(img.attr('width')) || !Number(img.attr('height'))) errors.push(`${route.path}：圖片缺少替代文字或尺寸：${img.attr('src')}`);
      if (img.attr('src')?.startsWith('/')) {
        let decodedImg = '';
        try { decodedImg = decodeURIComponent(img.attr('src')!); } catch { decodedImg = ''; }
        if (!decodedImg || !isDistFile(decodedImg)) errors.push(`${route.path}：圖片檔案不存在：${img.attr('src')}`);
      }
    });
    if (bytes > 80000 || gzip > 25000) errors.push(`${route.path}：HTML 超過效能預算（原始 80 KB／壓縮 25 KB）。`);
    const targets = new Set<string>();
    $('a[href]').each((_, element) => {
      const a = $(element), href = a.attr('href')!;
      let url: URL;
      try { url = new URL(href, canonical); } catch { errors.push(`${route.path}：無效連結 ${href}`); return; }
      if (!['https:', 'http:'].includes(url.protocol) || url.host !== model.site.domain) return;
      const decoded = decodeURIComponent(url.pathname);
      const target = normalizePath(decoded);
      const resolved = model.redirects.get(target) ?? target;
      if (html.has(resolved)) {
        if (resolved !== route.path) {
          const isLocaleLink = a.attr('data-locale-link') !== undefined;
          if (!isLocaleLink || model.byPath.get(resolved)?.kind === 'home') {
            targets.add(resolved);
          }
          if (!inbound.has(resolved)) inbound.set(resolved, new Set());
          inbound.get(resolved)!.add(route.path);
          if (a.closest('.prose, .topic-link').length) {
            if (!contextual.has(resolved)) contextual.set(resolved, new Set());
            contextual.get(resolved)!.add(route.path);
          }
        }
        if (url.hash) {
          const id = decodeURIComponent(url.hash.slice(1));
          pendingHashChecks.push({ from: route.path, resolved, id, href });
        }
        if (resolved !== target) warnings.push(`${route.path} 使用舊連結 ${target}，建議改成 ${resolved}`);
      } else if (!isDistFile(decoded)) errors.push(`${route.path}：站內失效連結 ${href}`);
    });
    edges.set(route.path, targets);
  }
  for (const check of pendingHashChecks) {
    if (!html.get(check.resolved)?.ids?.has(check.id)) errors.push(`${check.from}：找不到連結段落 ${check.href}`);
  }
  for (const path of html.keys()) if (!expected.some(r => r.path === path)) errors.push(`輸出未登記的頁面，可能是草稿誤發布：${path}`);
  const reachable = new Set<string>(['/']);
  const queue = ['/'];
  for (let i = 0; i < queue.length; i++) for (const target of edges.get(queue[i]) ?? []) if (!reachable.has(target)) { reachable.add(target); queue.push(target); }
  for (const route of model.routes) if (!reachable.has(route.path)) errors.push(`孤兒頁：從首頁的連結無法走到 ${route.path}`);
  // Sitemap 由一份 sitemap.xml 索引與 POST／PAGE／分類／TAG 靜態 XML 組成。
  // 必須核對每一份子檔、數量、最後更新日期及公開索引資格，不能只查總索引。
  const sitemapParts = buildSitemapParts(model.routes, model.site.sitemap.maxUrls);
  const expectedSitemapIndex = renderSitemapIndex(sitemapParts, model.site.domain);
  const actualSitemapIndex = readFileSync('dist/sitemap.xml', 'utf8');
  if (actualSitemapIndex !== expectedSitemapIndex) {
    errors.push('Sitemap Index（網站地圖總索引）與實際可索引頁面不一致。');
  }
  // 所有子 Sitemap 必須放網站根目錄，避免 Google 在非 GSC 提交情境限制子目錄覆蓋範圍。
  const sitemapsDir = 'dist';
  const expectedFileNames = new Set(sitemapParts.map(p => p.filename));
  const actualFileNames = files(sitemapsDir)
    .map(file => relative(sitemapsDir, file).split(sep).join('/'))
    .filter(name => /^[a-z][a-z0-9-]*-[0-9]{3,}\.xml$/.test(name));
  if (actualFileNames.length !== expectedFileNames.size ||
      actualFileNames.some(name => !expectedFileNames.has(name))) {
    errors.push('Sitemap 子檔案缺少、過期或輸出多餘 XML。');
  }
  const actualURLs: string[] = [];
  for (const part of sitemapParts) {
    const path = resolve(sitemapsDir, part.filename);
    if (!existsSync(path)) { errors.push('Sitemap 子檔案不存在：' + part.filename); continue; }
    const raw = readFileSync(path, 'utf8');
    if (raw !== renderSitemapPart(part, model.site.domain)) {
      errors.push('Sitemap 子檔案內容、網址、lastmod 或容量不正確：' + part.filename);
    }
    const $xml = load(raw, { xmlMode: true });
    const urls = $xml('urlset > url > loc').toArray().map(node => $xml(node).text());
    if (urls.length > model.site.sitemap.maxUrls) errors.push('Sitemap 單檔超過設定筆數：' + part.filename);
    if (Buffer.byteLength(raw, 'utf8') > 50 * 1024 * 1024) errors.push('Sitemap 單檔超過 50 MiB：' + part.filename);
    actualURLs.push(...urls);
  }
  const expectedURLs = model.routes.filter(r => !r.noindex).map(r => 'https://' + model.site.domain + encodePath(r.path));
  const actualURLSet = new Set(actualURLs);
  if (actualURLSet.size !== actualURLs.length ||
      actualURLs.length !== expectedURLs.length ||
      expectedURLs.some(url => !actualURLSet.has(url))) {
    errors.push('Sitemap（網站地圖）與實際可索引頁面不一致、重複或漏列。');
  }
  if (!readFileSync('dist/robots.txt', 'utf8').includes('Sitemap: https://' + model.site.domain + '/sitemap.xml')) {
    errors.push('robots.txt 未指向 Sitemap Index。');
  }
  if (!model.canIndex && !readFileSync('dist/_headers', 'utf8').includes('X-Robots-Tag: noindex')) errors.push('預覽／未開放收錄的網站缺少 HTTP 索引限制。');
  const cssBytes = files('dist').filter(f => f.endsWith('.css')).reduce((n, f) => n + statSync(f).size, 0);
  const jsBytes = files('dist').filter(f => f.endsWith('.js')).reduce((n, f) => n + statSync(f).size, 0);
  if (cssBytes > 30000) errors.push(`CSS 共 ${cssBytes} bytes，超過 30 KB 預算。`);
  if (jsBytes > 0) errors.push(`出現 ${jsBytes} bytes 自家前端 JS，公版預算為 0。`);
  const pages = model.routes.map(r => ({ path: r.path, bytes: html.get(r.path)?.bytes, gzipBytes: html.get(r.path)?.gzip, inbound: inbound.get(r.path)?.size ?? 0, contextualInbound: contextual.get(r.path)?.size ?? 0, noindex: r.noindex }));
  for (const r of model.routes.filter(r => r.kind === 'post')) if (!contextual.get(r.path)?.size) warnings.push(`${r.path} 沒有正文或主題中心的語意連結，請編輯評估是否補上。`);
  mkdirSync('.reports', { recursive: true });
  writeFileSync('.reports/SEO_REPORT.json', JSON.stringify({ passed: !errors.length, cssBytes, jsBytes, errors, warnings, pages }, null, 2) + '\n');
  writeFileSync('.reports/SEO_REPORT.md', ['# 網站建置驗收', '', `結果：${errors.length ? '未通過' : '通過'}。自家前端 JS：${jsBytes} bytes；CSS：${cssBytes} bytes。`, '', '> 這是靜態產物檢查；不等同真實使用者的 Core Web Vitals（核心網頁體驗指標）或第三方追蹤效能。', '', '| 網址 | HTML 大小 | 壓縮大小 | 連入頁數 | 正文／中心頁連入 | 不收錄 |', '| --- | --- | --- | --- | --- | --- |', ...pages.map(p => `| ${p.path} | ${p.bytes} | ${p.gzipBytes} | ${p.inbound} | ${p.contextualInbound} | ${p.noindex ? '是' : '否'} |`), '', '## 問題與提醒', '', ...errors.map(s => `- 錯誤：${s}`), ...warnings.map(s => `- 提醒：${s}`), ''].join('\n'));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`✓ SEO／連結／索引／效能驗收通過：${pages.length} 頁；自家前端 JS ${jsBytes} bytes，CSS ${cssBytes} bytes。`);
  if (warnings.length) console.log(`另有 ${warnings.length} 項編輯提醒，詳見 .reports/SEO_REPORT.md。`);
});
