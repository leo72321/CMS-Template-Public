# CPT 自訂內容類型（Cars／Houses／Products）

CPT（Custom Post Type）與 Blog 分開管理，但共用 Astro 靜態建置、永久 UID、媒體上傳、網址衝突檢查、301、Canonical 與 XML Sitemap。**註冊類型不會更改原本 Blog 的任何 URL**。

## 註冊新的 cars 類型

在網站自己的 `site.config.json` 根層加入 `contentTypes`（與 `media`、`blogIndexable` 同一層）：

```json
{
  "contentTypes": [
    {
      "id": "cars",
      "name": "車輛庫存",
      "description": "在售車輛與規格資料。",
      "indexable": true,
      "fields": [
        { "id": "brand", "label": "廠牌", "type": "text", "required": true, "showOnList": true },
        { "id": "year", "label": "出廠年", "type": "number", "required": true, "showOnList": true },
        { "id": "price", "label": "售價", "type": "price", "required": true, "showOnList": true },
        { "id": "mileage", "label": "里程", "type": "number", "showOnList": true },
        { "id": "status", "label": "銷售狀態", "type": "select", "options": ["在售", "已售出", "下架"], "showOnList": true },
        { "id": "photos", "label": "相簿", "type": "gallery" },
        { "id": "report", "label": "車況報告", "type": "file" }
      ]
    }
  ]
}
```

上面是一段根層欄位範例，**不是要直接取代整份 site.config.json**。`id` 是永久的內部類型代碼，顯示名稱 `name` 可改，類型代碼不可隨意更名，以免原網址、Sitemap、媒體目錄受影響。

每種 CPT 可設定名稱、介紹、是否索引及最多 40 個欄位。可用欄位：`text`、`number`、`price`、`boolean`、`select`、`date`、`url`、`image`、`gallery`、`file`。`required` 僅在發布時強制，草稿可先留白；`showOnList` 用於列表卡片。這是型別驗證與基本呈現，不是車輛商業邏輯：例如 VIN 唯一性、複雜篩選仍需另外開發。

## 新增車輛，不用自己產生 UID

```bash
npm run content:new -- --type cars --title "Toyota Altis 2022" --slug toyota-altis-2022
```

- 自動建立 `content/cpt/cars/20261023-k7m2q--toyota-altis-2022.md`（UID 為台灣建檔日期＋5 位 base36 隨機字碼，每次可能不同）。
- 修改檔案的 `fields`，例如 `brand: Toyota`、`year: 2022`、`price: 580000`、`status: 在售`；完成之後 `draft: false` 才公開。
- 預設列表 `https://你的網域/cars/`，詳細頁 `https://你的網域/cars/toyota-altis-2022/`；Blog 繼續使用既有分類網址 `/{category}/{slug}/`。
- 詳細頁會自動顯示有內容的自訂欄位；`image`、`gallery` 渲染圖片，`file` 提供下載連結，`price` 以新台幣顯示。
- CPT 有自己的 `cars-001.xml` Sitemap；列表頁進入 `pages-001.xml`。草稿及 noindex 不會出現在 Sitemap。
- Content UID 建立後不隨 slug、標題、分類更改；已建立的 Post/Page 保留原 UID，不強制改名。

## 圖片與附件

新上傳圖片與附件的物件路徑為：

```text
Bucket/
└── 網域/
    ├── site/UID/          # PAGE 封面與內文圖片
    ├── blog/UID/          # POST 封面與內文圖片
    └── cars/UID/          # Cars CPT 圖片
```

**這是新上傳的媒體路徑，不會搬動既有圖片。** 封面可另外產生 OG 分享圖。圖片單一 WebP 最大 1440px、不放大小圖；原 B2／S3 上傳回應成功後只做一次 HTTP HEAD 查公開圖片連結，不重新下載驗證。

要新增車輛封面：

```bash
npm run media:add -- --uid 20261023-k7m2q --file "./car.jpg" --alt "Toyota Altis 正面" --cover
```

相簿與附件現在都能直接透過同一個 `media:add` 上傳器操作，不必手動複製網址。上傳圖片仍會轉成單尺寸 WebP；非圖片附件**原樣保留副檔名與位元組**。

車輛相簿一次上傳一張，自動追加到 `fields.photos`，不會覆寫既有照片：

```bash
npm run media:add -- --uid 20261023-k7m2q --file "./front.jpg" --alt "Toyota 車頭" --field photos
npm run media:add -- --uid 20261023-k7m2q --file "./rear.jpg" --alt "Toyota 車尾" --field photos
```

車況報告或其他附件直接上傳並填入 `fields.report`（CPT 定義中需為 `file` 欄位）：

```bash
npm run media:add -- --uid 20261023-k7m2q --file "./condition.pdf" --field report
```

這會把 PDF 原檔上傳到 `Bucket/網域/cars/20261023-k7m2q/report-隨機字尾.pdf`，成功後寫回該車輛 frontmatter 的 `fields.report`，前台自動產生下載連結。`--field` 使用前會先核對內容類型的欄位設定，照片只能填 `image/gallery`，文件只能填 `file`。

**一般 Blog／Page 也可以放附件**：在正文先放 `<!-- 檔案:download -->`，再執行：

```bash
npm run media:add -- --uid 文章UID --file "./guide.zip" --name download --label "使用手冊 ZIP"
```

占位符會換成 Markdown 下載連結。先加 `--dry-run` 可以預覽物件名稱和網址，不會上傳或改寫文章。

常見支援格式有 PDF、ZIP、7Z、RAR、Word、Excel、PowerPoint、CSV、TXT、RTF、MP3、MP4、WebM。每個附件上限 100 MiB；不接受 HTML、JavaScript、SVG 或可執行檔。**上傳所使用的 CDN 必須能匿名存取，敏感車主資料、身分文件或內部報價不可上傳到公開 Bucket**。私桶附件的登入授權與短效簽名連結另屬存取控制功能，不會因 CPT `file` 欄位而自動獲得。

## 維運與轉址

- `npm run docs:update`：更新結構表與 JSON 內容索引。
- `npm run urls:update`：鎖定公開內容 UID 對應的網址。更換 slug 時必須加上 `aliases` 作 301。
- `npm run verify`：欄位驗證、路由／SEO／Sitemap／HTML 產物驗收。
- 刪除或更名已發布的 CPT 類型前，先規劃網址及資產遷移，不可直接修改 `id`。
- 公版和目前的正式站預設 **不註冊任何 CPT**，只有在網站設定中新增 `contentTypes` 後才產生對應列表與詳細頁，不會跑出沒用的 cars 頁面。

使用者自訂內容需要特殊卡片版型、動態排序與價格篩選、交易狀態處理或搜尋 API 時，請再於前台加對應功能；CPT 核心已統一註冊資料欄位與路由，毋須重寫 CMS。
