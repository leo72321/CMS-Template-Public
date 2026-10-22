# 天公仔CMS

<p align="center">
  <img src="assets/php-tiangong-meme.webp" alt="天公仔 PHP 工程師梗圖：寫 PHP 是走投無路的人在做的，老子我天公仔，看起來像走投無路的嗎？" width="680" />
</p>

**寫文章、填欄位、放圖片；其餘交給網站自動整理。**

Astro 在建置時產生靜態 HTML。內容採 WordPress 的 Post（文章）／Page（獨立頁面）邏輯，不需要資料庫或管理後台。

> 公版預設不開放搜尋引擎收錄。範例內容另有保護，整站開啟索引後也不會收錄範例。

## 我想查看網站

| 想看什麼 | 點這裡 |
| --- | --- |
| 有哪些網址、各自對應哪個檔案 | **[網站結構總覽](docs/SITE_STRUCTURE.md)** |
| 文章內容 | [文章資料夾](content/posts) |
| 關於、服務等獨立頁面 | [獨立頁面資料夾](content/pages) |
| 分類、標籤與主題中心 | [內容管理](docs/內容管理.md) |
| 網域、站名、GTM 與收錄設定 | [網站設定](site.config.json)・[中文欄位說明](docs/設定說明.md) |
| 圖片怎麼上傳 | [圖片操作](docs/圖片操作.md) |
| Cloudflare Pages 怎麼接 | [部署說明](docs/部署說明.md) |
| Agent 該遵守什麼規則 | [AGENTS.md](AGENTS.md) |
| 功能與驗收範圍 | [功能與驗收](docs/功能與驗收.md) |

## 在 GitHub 執行網站驗收

開啟倉庫的 [Actions（動作）](../../actions)，在左側選擇「網站自動驗收」，按 **Run workflow（執行工作流程）** 並選擇 `main`，就能手動跑完整檢查。修改程式碼或提出 PR 時也會自動執行。

> 已提供「網站初始化精靈」及「圖床連線測試」兩個手動工作流程；建議先將此範本複製成私人倉庫再設定正式站。

## 不寫程式初始化網站

複製本公開範本為私人倉庫後，開啟 **Actions → 網站初始化精靈 → Run workflow**，填寫網站名稱、正式網域、S3 相容端點、儲存桶與 CDN 子網域。操作與金鑰安全注意事項請看 [中文初始化說明](docs/初始化精靈.md)。S3／B2／R2 圖片上傳共用 AWS S3 SDK，透過「圖床連線測試」按鈕驗證真實上傳與 CDN 讀取；沒有 S3 設定的舊站保留 B2 原生 API。

## 建立新網站

將倉庫設為 GitHub Template（範本倉庫），再用「Use this template／使用此範本」建立新站。每站獨立修改與部署，公版更新不會自動改到舊站。

本機需要 Node.js 24：

```bash
npm ci
npm run site:init -- --domain your-domain.com --title "我的網站"
npm run dev
```

`domain` 是正式網域，`title` 是站名。圖片網址預設跟著變成 `cdn.your-domain.com`；DNS（網域設定）及 CDN（內容傳遞網路）仍需先接妥。

## 新增文章

```bash
npm run content:new -- --type post --uid 我的第一篇 --title "我的第一篇文章" --slug 我的第一篇 --category 網站教學
```

`uid` 是永久內容識別碼，`slug` 是固定網址名稱，`category` 是分類 ID。新文章預設草稿，完成後將 `draft` 改為 `false`，再執行：

```bash
npm run urls:update
npm run verify
npm run media:verify
```

將內容、圖片紀錄、網址紀錄與結構報表一起提交，再開 PR（合併請求）。

## 網址規則

| 類型 | 網址 |
| --- | --- |
| 首頁 | `/` |
| Post 文章 | `/{分類網址}/{文章網址}/` |
| Page 獨立頁面 | `/{頁面網址}/` |
| 分類彙整 | `/{分類網址}/`（各分類有獨立彙整頁） |
| 標籤彙整 | `/tag/{標籤網址}/` |
| 全部文章列表 | `/blog/` |

`/blog/` 僅為全部文章總覽，文章正式網址使用 `/{分類網址}/{文章網址}/`。`Category` 是真分類，各分類保有 `/{分類網址}/` 彙整頁；變更分類會改變文章網址，必須保留原分類 URL 的 301。前一版 `/blog/{文章網址}/` 也直接 301 到分類文章。`site.config.json` 的 `blogLegacyPaths` 保護舊入口；`relatedArticles.maxItems` 控制每篇文章延伸閱讀總名額（含正文手動內連），預設 4、最多 12。可以使用中文網址。

## 自動處理的功能

- 分類、標籤、列表與分頁，並控制彙整頁收錄。
- 主題中心與子文章雙向連結，每次建置重算新舊文章推薦。
- SEO 標題、簡介、Canonical（標準網址）、OG（分享預覽）、結構化資料、麵包屑、Sitemap（網站地圖）。
- 草稿、範例、預覽環境索引保護；網址衝突、301 轉址及既有網址保護。
- 內部失效連結、段落連結、圖片替代文字、孤兒頁與 HTML 大小驗收。
- B2／R2／AWS S3 圖片縮圖、雜湊檔名、S3 上傳、CDN 校驗與回填。
- 中文網站結構表、Agent 內容索引及中文驗收報表。

## 專案位置

| 位置 | 用途 |
| --- | --- |
| `content/posts/`、`content/pages/` | 文章與獨立頁面 |
| `content/categories/`、`tags/`、`topics/` | 分類、標籤與主題 |
| `content/media/manifest.json` | 上傳圖片及校驗紀錄 |
| `content/url-lock.json` | 既有網址與轉址紀錄 |
| `src/pages/` | 首頁與共用頁面產生器 |
| `src/components/` | 頁首、頁尾、SEO 與列表 |
| `src/layouts/`、`src/styles/` | 版型與外觀 |
| `scripts/` | 操作指令、圖片及驗收工具 |
| `docs/` | 中文說明與網站結構 |
| `.github/workflows/` | PR 與主分支自動檢查 |

頁面預設不載入自家前端 JavaScript，採精簡 CSS 與系統字型。GTM 只在填入 ID 後載入，事件由你自行管理。不預裝搜尋、會員、購物車或後台。

外觀請改 `.astro` 和 CSS。`dist/` 是建置結果，下次會重產，不是原始碼。

## 全站 POST 頁尾（簡化與開關）

[POST 頁尾設定：標籤、作者、推薦與自訂區塊](docs/POST頁尾設定.md)。所有文章共用 `site.config.json` 設定；閱讀提醒、主題中心跳轉及服務諮詢卡片不再自動插入文章。新增自訂區塊可先設 `enabled:false` 保留內容，未來再啟用。複雜銷售與互動請自行建立 Page。
