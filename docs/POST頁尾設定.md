# POST 頁尾設定（全站統一）

## 設計原則

**所有 POST 共用同一套頁尾，不逐篇增加花俏元件。** 內容寫在文章 Markdown；額外的複雜銷售、展示或互動頁面應另做 Page。

POST 正文之後的元件順序固定：**標籤 → 作者 → 自訂區塊 → 自動延伸閱讀**。每一項皆由根目錄 `site.config.json` 控制。

已移除硬編碼的「閱讀提醒／法律免責聲明」、「主題中心」跳轉與「服務諮詢卡片」；不會在一般 POST 頁底自動加回。`Topic` 仍可供延伸閱讀演算法計算相關性，但不額外輸出 Topic 中心連結或專屬卡片。

## 三個內建功能的開關

- **標籤**：`postFooter.tags` 設成 `true` 顯示有設定的 Tag；`false` 全站所有 POST 都隱藏標籤，原文章 Tag 資料不會刪除。
- **作者介紹**：`postFooter.author.enabled` 設成 `true` 顯示作者姓名、職稱、簡介、選填圖片與作者頁連結；`false` 隱藏元件但保留所有資料。`page` 指向自己建立的既有 Page，例如 `/about/`；留空則不顯示作者頁連結。`photo` 留空或圖片不存在時不顯示空白相框。
- **自動延伸閱讀**：沿用 `relatedArticles.enabled` 與 `relatedArticles.maxItems`。由各篇文章的 Topic、Tag、Category 分數獨立推薦，排除已經在正文引用的文章，預設上限 4；`enabled:false` 即全站所有 POST 關閉推薦。

## 自訂區塊：關閉不等於刪除

在 `postFooter.blocks` 追加一筆設定即可；每個 `id` 不得重複，`enabled` 是**區塊自己的開關**。`false` 時不輸出任何 HTML，但區塊文字與連結照樣保留，日後改回 `true` 即在全站 POST 重新顯示。

```json
{
  "postFooter": {
    "tags": true,
    "author": {
      "enabled": false,
      "name": "",
      "role": "",
      "bio": "",
      "photo": "",
      "page": "/about/",
      "linkText": "認識作者"
    },
    "blocks": [
      {
        "id": "my-note",
        "enabled": false,
        "title": "給讀者的一段話",
        "text": "這裡可放全站文章共用的補充內容。",
        "href": "/about/",
        "linkText": "查看介紹"
      }
    ]
  },
  "relatedArticles": {
    "enabled": true,
    "maxItems": 4
  }
}
```

請**修改既有設定**，不要把上述整段直接覆蓋 `site.config.json`，以免刪掉網站網域、圖床或其他必要設定。

設定說明：

| 欄位 | 用途 |
| --- | --- |
| `blocks[].id` | 自訂區塊唯一代號 |
| `blocks[].enabled` | 此區塊是否顯示；關閉不會清掉內容 |
| `blocks[].title` | 區塊標題，可留空 |
| `blocks[].text` | 純文字敘述，可留空；會安全轉義 HTML |
| `blocks[].href` | 選填連結：完整站內路徑（如 `/about/`）或 HTTPS |
| `blocks[].linkText` | 有設定 href 且啟用時必填 |
| `postFooter.author.page` | 作者介紹連到的現有 Page 路徑 |

不需要為每篇 POST 分別設定。調整 `site.config.json` 後，重新部署即可全站生效。

## 為進階客製留下的位置

- 統一的插入順序、區塊開關在 `src/components/PostFooter.astro`。
- 自訂區塊的排版與額外 HTML / Astro 元件在 **`src/components/PostFooterCustom.astro`**，檔案內已標註擴充位置。可依 `block.id` 決定不同設計或功能；仍由對應的 `enabled` 決定是否顯示。
- 一般使用者只改 JSON 就能新增文字與連結區塊；需要複雜頁面請建 Page，再由自訂區塊連過去。
- 不會預裝自家前端 JavaScript、表單、購物車或 CTA；加入額外元件也必須遵守網站效能及安全驗收。

變更後請執行 `npm run verify` 與 `npm run docs:check`，確認全部 POST 與站內連結正常。
