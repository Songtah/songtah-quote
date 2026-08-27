# 產品分類／品牌 UI 與依賴唯讀盤點

日期：2026-07-14  
範圍：`quote-system`；未修改程式、JSON 主檔或 Notion 資料。

## 一、目前產品頁實際資料流

- `/products` 直接導向 `/products/catalog`；實際頁面從 `products_catalog.json` 取得品牌、分類、商品類型選項，再交給 `CatalogManagerContent`。證據：`app/products/page.tsx:1-5`、`app/products/catalog/page.tsx:1-23`。
- `CatalogManagerContent` 初始同時讀 `/api/products/families` 與 `/api/products/catalog-raw`；搜尋或選品牌／分類後改呼叫 `/api/products/search`。證據：`components/CatalogManagerContent.tsx:2400-2462`。
- 現行管理頁搜尋框標示「貨號、品名、品牌」，實作也只搜 `code/name/brand`；不會以分類、商品類型或 `mainCategory` 命中。證據：`components/CatalogManagerContent.tsx:2521-2530`、`lib/products-catalog.ts:81-100`。
- 管理頁目前只提供品牌與 `category` 篩選；雖 server page 傳入 `productTypes`，元件沒有 `filterProductType`，`mainCategory` 也完全未進 UI/API。證據：`components/CatalogManagerContent.tsx:2374-2386,2554-2606`、`lib/products-catalog.ts:14-25`。
- family browse 顯示與篩選使用 `product_families.json` 內的 `brand/category/productType`；SKU 搜尋結果則使用 `products_catalog.json`。若只改其中一份，瀏覽系列與搜尋個品會顯示不同分類。證據：`components/CatalogManagerContent.tsx:2479-2484,2654-2667`、`app/api/products/families/[id]/route.ts:39-46`。
- `components/ProductsContent.tsx` 也實作完整產品搜尋、類型／品牌／分類篩選與 family browse，但目前 repo 沒有頁面 import 它；屬遺留／備用 UI，不是 `/products` 現行入口。其依賴仍應在重構時處理，避免日後重新掛載產生第二套行為。證據：`components/ProductsContent.tsx:423-519,586-650,700-787`。

## 二、API 與欄位語意

### `products_catalog.json`（現行 SKU 主檔）

- 欄位：`code`、`name`、`brand`、`productType`、`category`、`mainCategory`、價格與停售狀態。`code` 是跨系統穩定 SKU；`brand/productType/category` 是目前搜尋、篩選和顯示的原始字串。證據：`lib/products-catalog.ts:14-25`。
- `/api/products/search` 接受 `q/brand/type/category`；三種分類條件都是字串精確相等。回傳時把 `brand` 改名為 `manufacturer` 供 UI 使用。證據：`app/api/products/search/route.ts:12-40`、`lib/products-catalog.ts:96-100`。
- `/api/products/options` 從全 catalog 字串去重產生品牌、商品類型、分類；改名會立即改變篩選選項，也會讓仍持有舊 query 值的 UI 查不到資料。證據：`lib/products-catalog.ts:107-118`、`app/api/products/options/route.ts:1-13`。
- `/api/products/catalog-raw` 回傳全部原始資料，瀏覽器 private cache 5 分鐘；部署後短時間可能看見舊 taxonomy。證據：`app/api/products/catalog-raw/route.ts:21-32`。
- `mainCategory` 目前除了 type 宣告與文件外沒有實際程式消費者；直接把細分類搬到 `mainCategory` 而不改 API/UI，畫面仍只會使用舊 `category`。證據：`lib/products-catalog.ts:20`；全 repo 搜尋僅另見 `docs/page-authoring-rules.md:82`。

### `product_families.json`（系列主檔）

- family 的穩定識別是 `id`；SKU 歸屬主要依 `seriesCode` prefix、`skuMap`、covered codes 或 Notion manual familyId，不依 brand/category 名稱。證據：`lib/products-catalog.ts:34-47,127-130`、`app/api/products/families/[id]/route.ts:18-37`。
- `brand/productType/category` 仍用於 family 顯示與精確篩選，必須與 SKU catalog 同步改標籤。證據：`components/OrderForm.tsx:143-170`、`components/CatalogManagerContent.tsx:2479-2484`。

### Notion 產品 enrichment

- catalog 是貨號、品名、品牌、分類的主來源；Notion 只應存圖片、介紹等 enrichment。證據：`lib/products-notion.ts:1-8`。
- 但首次建立 Notion 商品頁時會把 catalog 的 `brand/category/productType` 快照寫進 `生產商/系列/類型`；既有頁 update 不會同步這三欄。只改 JSON 後，Notion 舊頁會保留舊 taxonomy。證據：`lib/products-notion.ts:128-169,172-187`。
- 另有 Notion series DB，品牌是獨立 select，並非 JSON family 的自動鏡像；品牌改名若要一致需另作唯讀差異表，不能假設同步。證據：`lib/products-series-notion.ts:66-90,123-175`。

## 三、報價與訂貨選品器

### 訂貨 `OrderForm`

- 選品器讀 `/api/products/families`、`/prices`、`/options`、`/notion-assignments`；品牌／類型／分類都精確篩 family，fallback SKU 也把條件送到 `/api/products/search`。證據：`components/OrderForm.tsx:84-110,112-170,188-202`。
- 個別 SKU 加入訂單時，`brand=item.manufacturer`，但 `seriesName=item.category`、`seriesId=''`；family SKU 才保存真正 family `id/seriesName`。所以 category 改名會改變新訂單中非 family SKU 的「系列」快照，但不會替既有訂單更新。證據：`components/OrderForm.tsx:209-220,345-349`。
- 訂單明細持久化 `skuCode/skuName/brand/seriesName/seriesId/unitPrice`；既有單據是業務快照，不可因 taxonomy 清理批次改寫。證據：`lib/orders-notion.ts:150-163,242-257`。

### 舊報價 `QuoteForm`

- `QuoteForm` 不使用 JSON catalog search，而是 `/api/products` → `lib/notion.ts#getProducts()`；它從 Notion 的 `生產商/分類/商品類型/價格` 讀取，再在 client 以品牌、分類精確篩選。證據：`components/QuoteForm.tsx:67-77,136-156`、`app/api/products/route.ts:1-19`、`lib/notion.ts:137-173`。
- 因此只改 `products_catalog.json` 不會改 QuoteForm，甚至可能與 OrderForm 顯示不同分類；這是 taxonomy 調整前必須處理的雙來源斷層。
- 報價明細保存品牌、品類、規格與單價快照；既成報價不得回填新分類或品牌名稱。證據：`components/QuoteForm.tsx:25-41`、`lib/notion.ts:340-369`。

## 四、促銷與系列比對

- 促銷權威比對不依 brand/category 字串：一般促銷精準比 `skuCode`；只有系列級促銷可比穩定 `seriesId`。只要 SKU code、family id 不變，分類／品牌顯示名改動不應改促銷命中。證據：`lib/order-pricing.ts:42-64`。
- 促銷品項仍把 `brand` 與 `seriesName` 當文字快照存入 Notion，供管理 UI 顯示；這些不應為了名稱清理批次覆寫，除非有獨立、可 read-back 的資料遷移。證據：`lib/promotion-items-notion.ts:91-107,164-180,206-230`。
- `ProductFamily.id` 被促銷項目的 `seriesId` 持久保存；**不可因分類整理重建 family id**。`seriesCode` 也用於 family 找尋及 SKU prefix membership；**不可拿品牌／分類新名稱去重寫 seriesCode**。證據：`lib/promotion-items-notion.ts:95-100`、`lib/products-catalog.ts:34-45,127-130`。

## 五、其他受 taxonomy 影響的業務功能

- 業務開發 Campaign 的 cross-sell「同分類／同品牌」以 catalog 當下字串精確相等判斷。直接把部分 SKU 改新名稱，會立刻改變潛在名單 cohort；若只改目標 SKU 或部分歷史 SKU，結果會漏人。證據：`app/api/bd/campaigns/[id]/generate/route.ts:54-81`。
- 產品 family member API 對 catalog 找不到的 code 會 fallback family 的品牌／分類／類型；catalog/family 不同步時，同一 family response 內可能混出兩組標籤。證據：`app/api/products/families/[id]/route.ts:39-46`。
- module scope 會快取 catalog/families JSON，當次 server process 不會重讀檔案；這符合部署模式，但不可期待同一 process 熱更新 JSON。證據：`lib/products-catalog.ts:50-68`。

## 六、不可直接批次改名的欄位

1. **絕對不可改作 taxonomy label：** `code`（SKU）、`ProductFamily.id`、`seriesCode`、`skuMap` values、covered SKU codes。它們承擔訂單、促銷、family membership 與 Notion manual assignment 的穩定鍵。
2. **不可只改單一來源：** `brand`、`category`、`productType` 同時存在 catalog、families、Notion product snapshot、Notion series、促銷／單據快照。至少 catalog 與 families 的現行標籤要原子同步；Notion 與歷史單據不能無差別批次覆寫。
3. **不可把 `category` 直接搬成 `mainCategory`：** 現有 UI/API、OrderForm、Campaign 都只讀 category；mainCategory 尚未接線。
4. **不可回寫既成單據：** 訂單的 brand/seriesName/unitPrice、報價的 brand/category/spec/unitPrice、促銷品項顯示快照皆應保持成立時內容。

## 七、安全兼容方案

### 建議模型

- 保留穩定 raw key，新增集中式 taxonomy mapping，例如 `brandAliases/categoryAliases` 與 canonical key/label；不要先大量覆寫所有消費者。
- 查詢層先 canonicalize：`searchCatalog` 讓新舊品牌／分類 query 都展開到同一 canonical group；Campaign 的同分類／同品牌也改用同一 helper 比 canonical key，不直接比顯示字串。
- UI 顯示 canonical label，但 API 在一個相容期內同時接受舊 label；部署後再依 usage/log 決定是否清除 alias。
- `mainCategory` 若要成為第一層，先新增回傳與 UI 篩選，不移除 category；採 `mainCategory → category → productType` 或經業務確認的層級，並保持舊 `category` query 可用。
- catalog 與 families 先做 dry-run join：依 code/family membership 列出 old→new、影響筆數、前 20 筆與不一致 family；確認後同一 commit 原子更新兩份 JSON。
- Notion enrichment 一律以 SKU code join catalog 後顯示 canonical taxonomy；不把 Notion 舊 `生產商/系列/類型` 當新權威。若確需清理 Notion，另做 dry-run、逐批 migration 和 read-back。
- QuoteForm 應先改用同一 JSON catalog/search 契約，或至少套同一 canonical helper；在它仍讀 Notion 期間，不宜宣稱分類改名已全站完成。
- 促銷只保證 `skuCode/seriesId` 穩定；不得重新產生 family id。既有訂單、報價、促銷文字快照維持不變，新單才帶 canonical label。

## 八、最低回歸

- 產品管理頁：搜尋舊／新名稱、品牌／分類／類型／大分類篩選、family browse 與 SKU search 顯示一致。
- OrderForm：family 與個別 SKU 均可選；停售品仍隱藏；新單帶 canonical label，既有單內容不變。
- QuoteForm：同一 SKU 與 OrderForm 顯示相同品牌／分類／價格來源決策；既有報價快照不變。
- 促銷：SKU 精準類型與 seriesId 類型正反例均不受 rename 影響；gift picker 仍能以原 family id 開啟。
- Campaign cross-sell：alias 前後 cohort 筆數一致，除非使用者明確核准 taxonomy 語意調整。
- 部署後測 `/api/products/options`、`search`、`catalog-raw`、`families/:id`，並留意 5 分鐘 browser cache 與 module reload。

驗收: 通過
