# 給接手 Agent 的專案規則

這是少爺自用的靜態網站公版。優先順序是 SEO 正確、網頁輕量、結構清楚、操作簡單。人看的文件、報表、錯誤訊息及介面使用繁體中文與台灣用語。固定英文欄位與工具名稱保留，但補中文解釋。

## 操作前

先讀 README、site.config.json、docs/內容管理.md 與 docs/CONTENT_INDEX.json。先查既有分類、標籤及主題，不要增殖同義標籤。

## 內容約定

- Post 正式網址固定 `/{category.slug}/{post.slug}/`；Blog `/blog/` 僅提供全部文章列表，Category `/{category.slug}/` 才是分類索引。舊 `/blog/{post.slug}/` 和 `blogLegacyPaths` 舊文章網址需直接 301 到正式分類文章。Page 為 `/{page.slug}/`。
- `uid` 是永久識別碼。改標題不准順手改 `uid` 或 `slug`。
- 已公開文章改分類或 slug 都是改網址；修改前要檢查 `content/url-lock.json`，並在 `aliases` 保留舊網址的 301。前一版分類 URL 若升格為正式路由，不能保留反向轉址；禁止轉址鏈。
- `draft: true` 及未到台灣發布日的文章不輸出。正文從 `##` 開始，頁面只有一個 H1。
- 範例標記 `sample: true` 固定不收錄，正式內容請改成 `false`。
- 正文連結按語意決定，先查內容索引，使用明確錨點文字，不做關鍵字全域替換。
- 新 Page 必須接入導覽、正文或其他頁面，建置會擋下從首頁無法到達的孤兒頁。
- 新分類、標籤、主題先建設定檔；主題子文章公開前，中心頁必須公開。

## 公版與衍生網站雙向維護

通用 CMS 的路由、Canonical、Sitemap、301 轉址、內容驗證與排版元件出現 BUG 時，需同時檢查公版及使用本模板的網站，並補上回歸測試。只回補共通修復，不把個別網站的品牌文案、價格、LINE、GTM、真實文章或私有設定複製回公版。只維護本公開模板及各正式網站的共通功能；各倉庫獨立驗收後合併，不得把其中一邊的驗收結果視為另一邊已通過。

## 圖片

使用 `npm run media:add -- --help`。封面用 `--cover`；內文先放 `<!-- 圖片:名稱 -->` 再用 `--name 名稱`。圖片需要正確替代文字與寬高。

金鑰只放本機環境變數或未追蹤的 `.env`；GitHub Actions 與 Cloudflare 不需要上傳金鑰。不得偽造 manifest.json 的上傳紀錄。工具只上傳，不擅自刪 B2 遠端物件。

## 外觀與效能

修改 `.astro`、版型和 CSS，不改 `dist/`。不安裝前端框架、動畫套件、字型套件或搜尋。

自家前端 JS 預算為 0；CSS 全站不超過 30 KB；單頁原始 HTML 不超過 80 KB，gzip 壓縮不超過 25 KB。新功能需要超出時，說明取捨，不得直接刪驗收。

GTM 只提供 ID 入口，不擅自替少爺新增追蹤事件。

## 提交前

1. `npm run urls:update`：檢查轉址後更新網址紀錄。
2. `npm run verify`：型別、行為測試、內容、結構報表、建置及 HTML 驗收。
3. 有圖片時跑 `npm run media:verify`，確認 CDN 圖片存在且校驗一致。
4. 查看 `.reports/SEO_REPORT.md` 的正文連入提醒，提交 docs 兩份結構索引、網址紀錄及圖片紀錄。
5. 使用功能分支與 PR，標題、說明及驗收結果用繁體中文。不得把本機測試說成 GitHub CI 或正式部署成功。

新站使用獨立倉庫，不連動改舊站。沒有明確要求，不替既有網站搬家或部署。

## POST 共用頁尾與擴充限制

所有 Post 正文後只允許共用 `PostFooter.astro` 輸出：Tag（`postFooter.tags`）、作者介紹（`postFooter.author.enabled`）、獨立開關的自訂區塊（`postFooter.blocks[].enabled`）和推薦（`relatedArticles.enabled`）。停用時不可清空區塊資料。預設不加閱讀提醒、Topic 中心連結、服務諮詢卡片或每篇私有例外；Topic 只用於推薦相關性。新增功能修改 `PostFooterCustom.astro`，由全站開關控制，詳見 `docs/POST頁尾設定.md`。需要複雜呈現時另建 Page，不要讓 POST 變成 Landing Page。
