# 產品圖片獵取管線(image-hunt)

目標:為 6,084 SKU 補產品圖。經排除與分組後實際目標 **1,691 個**
(169 系列 + 1,522 個散裝同名組;維修料件/待確認/停售 45 項不配圖;耗材組標 low 有就有)。

資料工作區(不進 git):`/Users/ted/Desktop/Songtah/產品圖片工作區/`

## 流程(五步)

| 步驟 | 指令 | 產出 |
|---|---|---|
| 1. 建目標 | `node scripts/image-hunt/build-targets.mjs` | `targets.json`(系列 + 散裝同名組,色號/容量變體共用一張圖) |
| 2. 爬官網 | `node scripts/image-hunt/crawl.mjs <brand>` | `brand-index/<brand>.json`(整站產品頁:標題+圖) |
| 3. 比對下載 | `node scripts/image-hunt/match.mjs <brand>` | `candidates/<targetId>/cand-N.jpg + meta.json` |
| 4. 人工覆核 | `node scripts/image-hunt/review-server.mjs` → http://localhost:4600 | `decisions.json`(使用者點選) |
| 5. 寫入 | `node scripts/image-hunt/apply.mjs`(dry-run)→ `--write` | Blob webp + image-index.json(SKU)/ Notion 系列庫主圖URL(系列) |

## 原則

- **圖掛對層級**:系列圖進 Notion 系列庫「主圖URL」;散裝組的同一張圖 URL 寫給組內全部 SKU(index 層共用,Blob 只存一份)。
- **只補空白**:apply 不覆蓋既有圖(手動上傳的優先)。
- **去重**:上傳前 sha256 內容雜湊 + dHash 感知雜湊(距離≤6 視為同圖)。
- **禮貌爬取**:同站併發 2、間隔 400ms、上限頁數;只收原廠域名的圖(版權)。
- **可重跑**:applied.json 記錄已套用;decisions.json 即時存檔。

## 品牌 adapter 現況(crawl.mjs 的 SITES)

- `zirkonzahn` — zirkonzahn.com/en/products 階層爬(522 組目標,最大宗)
- `yamahachi` — yamahachi-dental.co.jp/products/(102 目標;日文站,比對率預期較低)
- `schottlander` — schottlander.com sitemap(23 系列)
- 待加:GC(358)、Song Young(192)、貝施美(85)、DENKEN(79)…官網域名需逐一確認後加進 SITES

## 長尾兜底

官網爬不到的,後續評估 Google Custom Search API(只收原廠域名結果,約 US$5/千次)。
