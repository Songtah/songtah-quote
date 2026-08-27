# quote-system URL 相容性稽核

稽核日期：2026-07-20  
範圍：`app/**/page.tsx`、`app/api/**/route.ts(x)`、`next.config.mjs`、程式內 `href`／`router.push`／`redirect`／`fetch`，以及分享、PDF、Webhook、Cron 入口。  
性質：唯讀盤點；本文件是全系統改造時的 URL 保留契約。

## 摘要與總數

- 頁面路由：31 個。
- API 路由：98 個。
- 合計檔案路由：129 個。
- 動態頁面路由：6 個（客戶、設備、活動、訂單、分享、工單）。
- 動態 API 路由：18 個（含 catch-all NextAuth）。
- `next.config.mjs` 目前只有 headers，沒有 rewrites 或 redirects（`next.config.mjs:1-22`）。
- 應用層明確 redirect：`/` 依登入狀態導向 `/dashboard` 或 `/login`（`app/page.tsx:7-8`）；`/products` → `/products/catalog`（`app/products/page.tsx:4`）；`/customers/regions` → `/admin/clinic-monitor?tab=regions`（`app/customers/regions/page.tsx:5`）。

## 前 20 項樣本

| # | URL | 類型 | 來源證據 | 重要參數 | 相容策略 |
|---:|---|---|---|---|---|
| 1 | `/` | 頁面/轉址入口 | `app/page.tsx:7-8` | session | 永久保留；不得直接改成單一目的地。 |
| 2 | `/login` | 頁面 | `app/login/page.tsx:30` | 無 | 保留；未登入 redirect 的固定目的地。 |
| 3 | `/dashboard` | 頁面 | `components/AppShell.tsx:62` | 無 | 保留；登入後與權限拒絕的固定落點。 |
| 4 | `/customers` | 頁面 | `components/AppShell.tsx:63` | 無 | 保留 canonical URL。 |
| 5 | `/customers/[id]` | 動態頁面 | `app/customers/[id]/page.tsx:95` | `id` | ID 格式不得變；若換頁面，舊路徑 server redirect。 |
| 6 | `/customers/regions` | 舊頁面轉址 | `app/customers/regions/page.tsx:5` | 無 | 保留為相容 alias，不刪。 |
| 7 | `/tickets` | 頁面 | `components/AppShell.tsx:64` | 無 | 保留 canonical URL。 |
| 8 | `/tickets/new` | 頁面 | `components/CEODashboardContent.tsx:965` | 無 | 保留深連結。 |
| 9 | `/tickets/[id]` | 動態頁面 | `app/customers/[id]/page.tsx:522` | `id` | 保留 ID 深連結。 |
| 10 | `/bd` | 多分頁頁面 | `components/AppShell.tsx:65` | `tab=report|pipeline|campaigns|suggest` | 保留 tab 值；新版可換 UI，不得讓舊 query 失效。 |
| 11 | `/products` | 舊頁面轉址 | `app/products/page.tsx:4` | 無 | 保留並導向 `/products/catalog`。 |
| 12 | `/products/catalog` | 頁面 | `components/AppShell.tsx:66` | 無 | 保留 canonical URL。 |
| 13 | `/quotes` | 頁面 | `components/AppShell.tsx:67` | 無 | 保留 canonical URL。 |
| 14 | `/quote/new` | 頁面 | `components/QuoteListContent.tsx:369` | 無 | 注意單數 `quote`；不可擅改為 `/quotes/new`，可新增 alias。 |
| 15 | `/share/[id]` | 公開動態頁面 | `lib/notion.ts:256` | quote `id`（建立時會去除連字號） | 高風險外部連結；永久保留且同時接受既有 ID 形式。 |
| 16 | `/api/quotes/[id]/pdf` | PDF 外部入口 | `components/QuoteForm.tsx:306` | quote `id` | 高風險；瀏覽器、分享頁與客戶書籤可能直連，內容可改但 URL/回應類型不可破壞。 |
| 17 | `/orders` | 頁面 | `components/AppShell.tsx:68` | 無 | 保留 canonical URL。 |
| 18 | `/orders/new` | 頁面 | `components/CEODashboardContent.tsx:964` | `fromQuote=<quoteId>` | 保留轉單 query；不得只保留空白新增模式。 |
| 19 | `/orders/[id]` | 動態頁面 | `app/customers/[id]/page.tsx:346` | `id` | 保留訂單深連結。 |
| 20 | `/api/line/webhook` | 外部 Webhook | `app/api/line/webhook/route.ts:2,62` | POST；`x-line-signature` | 最高風險；不得 redirect；路徑、POST、簽章 header 與快速 2xx 行為皆需相容。 |

## 頁面路由完整清冊（31）

每項證據均為同路徑下的 `page.tsx`；括號內列重要 query 或相容角色。

- 核心入口：`/`、`/login`、`/dashboard`。
- 業務開發：`/bd`（`tab=report|pipeline|campaigns|suggest`）。
- 客戶：`/customers`、`/customers/[id]`、`/customers/regions`（redirect alias）。
- 報價訂單：`/quotes`、`/quote/new`、`/share/[id]`、`/orders`、`/orders/new`（`fromQuote`）、`/orders/[id]`。
- 產品與行銷：`/products`（redirect alias）、`/products/catalog`、`/marketing`、`/promotions`、`/events`、`/events/[id]`、`/course-costs`、`/assets`。
- 售後服務：`/tickets`、`/tickets/new`、`/tickets/[id]`、`/equipment/[id]`。
- 行政與治理：`/admin`、`/admin/clinic-monitor`（`tab=regions|territory|opportunity`）、`/admin/line-import`、`/admin/trip-planner`、`/settings/accounts`、`/settings/audit`。

頁面相容原則：上述 URL 均視為公開於公司內部書籤或歷史訊息的穩定入口。資訊架構重整時，優先保留舊頁作 server-side redirect/alias；動態 ID 與 query 必須原樣轉送。

## API 路由完整清冊（98）

證據規則：每個 URL 對應 `app<URL>/route.ts`，PDF 例外為 `route.tsx`。除非另註，改造時保留現有 HTTP methods、驗證方式、request body 與 response shape；不能用 redirect 代替 API 回應。

### 帳號、稽核、儀表板（8）

`/api/accounts`、`/api/accounts/[id]`、`/api/audit-logs`（`limit,cursor`）、`/api/audit-pageview`、`/api/auth/[...nextauth]`、`/api/dashboard`、`/api/dashboard/ceo`、`/api/bug-report`。

### 客戶、業務開發與拜訪（31，主清單 27 + 批次/分析 4）

`/api/customers`（`q`）、`/api/customers/[id]`、`/api/customers/[id]/events`、`/api/customers/search`（`q`）、`/api/customers/by-area`（`city,district,salesperson,type,status,devStage`）、`/api/customers/region-stats`（`refresh=1`）、`/api/customers/count-by-salesperson`（`name`）、`/api/customers/assign`、`/api/customers/assign-company`（GET 使用 `city,district,owner`）、`/api/customers/reassign`、`/api/system-customers`（`q,city,district,salesperson,type`）、`/api/system-customers/all`（`limit,cursor`）、`/api/system-customers/names`、`/api/system-customers/options`、`/api/bd/pipeline`、`/api/bd/campaigns`、`/api/bd/campaigns/[id]`、`/api/bd/campaigns/[id]/members`、`/api/bd/campaigns/[id]/generate`、`/api/bd/visit-suggestions`（`city,district,salesperson,target,bcap`）、`/api/bd/visit-suggestions/adoption`（`mine,days`）、`/api/visits`（`customerName,salesperson,cursor,limit`）、`/api/visits/[id]`、`/api/visits/options`、`/api/visits/today`（`date`）、`/api/visits/follow-ups`、`/api/visits/auto-link`。

另有拜訪批次/分析端點 4 個：`/api/visits/bulk-import`、`/api/visits/bulk-delete`、`/api/visits/dedup`、`/api/visits/detect-competitors`。

### 報價、訂單、促銷（14）

`/api/quotes`（`limit,cursor`）、`/api/quotes/[id]`、`/api/quotes/[id]/approve`、`/api/quotes/[id]/pdf`、`/api/orders`、`/api/orders/[id]`、`/api/promotions`（`active=1`）、`/api/promotions/[id]`、`/api/promotions/[id]/items`、`/api/promotions/usage-stats`、`/api/promotion-items/[id]`、`/api/course-costs`、`/api/course-costs/[id]`、`/api/daily-report`（GET：`date,period=AM|PM|FULL,salesperson,title`；cron header）。

### 產品與素材（22）

`/api/products`、`/api/products/search`（`q,brand,type,category,limit`）、`/api/products/catalog-raw`、`/api/products/options`、`/api/products/prices`、`/api/products/notion-assignments`、`/api/products/families`（`code,includeDisabled=1`）、`/api/products/families/[id]`、`/api/products/families/[id]/members`、`/api/products/families/manage`、`/api/products/series`、`/api/products/series/[seriesCode]`、`/api/products/sku/[skuCode]`、`/api/products/upload-doc`、`/api/products/upload-image`、`/api/notion-image`（`pageId`）、`/api/assets`（`category`）、`/api/assets/[id]`、`/api/assets/upload`（multipart `file,folder`）。

同類 AI 端點 3 個：`/api/ai/analyze`、`/api/ai/suggest-fields`、`/api/ai/suggest-reaction`。

### 活動、設備、工單（8）

`/api/events`（`limit,cursor`）、`/api/events/[id]`（`registrations=1`）、`/api/equipment`（`q`）、`/api/equipment/[id]`、`/api/equipment/[id]/tickets`、`/api/tickets`（`limit,cursor`）、`/api/tickets/[id]`、`/api/clinic-monitor`（`months`）。

### 醫事監控、LINE 與排程（15）

`/api/admin/medical-monitor`（`refresh=1`）、`/api/admin/medical-monitor/changes`（`month=YYYY-MM`）、`/api/admin/medical-monitor/history`、`/api/admin/medical-monitor/import`、`/api/admin/medical-monitor/save`、`/api/admin/medical-monitor/status`、`/api/clinic-monitor/lookup`、`/api/opportunity`（`mode=stats` 或 `tag,city,district,salesperson,goldOnly=1`）、`/api/opportunity/scan`、`/api/line/import`（multipart `file,dateFrom,salesperson`）、`/api/line/import/batch`、`/api/line/webhook`、`/api/cron/campaign-autoclose`、`/api/cron/refresh-region-stats`、`/api/cron/refresh-visit-suggestions`。

> 計數核對：以上分類為 8 + 31（客戶/拜訪含另列 4）+ 14 + 22 + 8 + 15 = 98。

## Redirect、導航與呼叫契約

1. 權限層固定使用 `/login` 與 `/dashboard` 作 redirect（`lib/permissions.ts:8,43,49`）。
2. 登入成功固定 `router.push('/dashboard')`（`app/login/page.tsx:30`）。
3. 主導覽固定引用 `/dashboard`、`/customers`、`/tickets`、`/bd`、`/products/catalog`、`/quotes`、`/orders`、`/marketing`、`/admin`、`/admin/clinic-monitor`、`/settings/accounts`、`/settings/audit`（`components/AppShell.tsx:62-73`）。
4. NextAuth 登出入口 `/api/auth/signout` 被直接當連結使用（`components/AppShell.tsx:154`），應視為外部套件相容契約。
5. 報價轉訂單使用 `/orders/new?fromQuote=<id>`（`components/QuoteListContent.tsx:474`；`app/orders/new/page.tsx:12-27`）。
6. 分享 URL 寫入 Notion 報價紀錄，格式是 `${appUrl}/share/<無連字號 quoteId>`（`lib/notion.ts:256`）；這使其比一般站內導航更難回收。
7. 站內 fetch 大量直接寫死 `/api/...`；API 搬遷需保留 adapter route，不能只改新前端呼叫。

## 高風險外部連結

| URL | 外部依賴/風險 | 證據 | 必要相容措施 |
|---|---|---|---|
| `/share/[id]` | 已寄給客戶或存在 Notion 的公開報價連結 | `lib/notion.ts:256`、`components/AdminQuoteContent.tsx:166` | 永久保留；舊 ID 正規化；避免登入 redirect。 |
| `/api/quotes/[id]/pdf` | 客戶/使用者可直接下載，分享頁也直接引用 | `app/share/[id]/page.tsx:174`、`components/QuoteListContent.tsx:466` | 保留 GET、PDF content-type/disposition 與 ID 相容。 |
| `/api/line/webhook` | LINE Developer Console 固定 callback | `app/api/line/webhook/route.ts:2,62,76` | 路徑與 POST 不變；保留 `x-line-signature` 驗證及快速回應。 |
| `/api/daily-report` | 外部排程/推播可用 cron secret 呼叫 | `app/api/daily-report/route.ts:2-12,33-37` | 保留 GET/POST、query 與 `x-cron-secret`。 |
| `/api/cron/campaign-autoclose` | 夜間排程 | `app/api/cron/campaign-autoclose/route.ts:2-6,25-27` | 不 redirect；保留 POST/header；改路徑需先雙跑。 |
| `/api/cron/refresh-region-stats` | 夜間排程 | `app/api/cron/refresh-region-stats/route.ts:24` | 同上。 |
| `/api/cron/refresh-visit-suggestions` | GitHub Action 夜間 curl | `app/api/cron/refresh-visit-suggestions/route.ts:2-4,22-25` | 同上；需同步外部 Action 後才可退役舊端點。 |
| `/api/auth/[...nextauth]` | NextAuth callback/session/signout 子路徑 | `app/api/auth/[...nextauth]/route.ts`、`components/AppShell.tsx:154` | 不可用單一 redirect 取代 catch-all；升級需做完整 auth 回歸。 |
| 外部 `dmUrl` | 促銷可儲存任意外部素材連結 | `components/PromotionsContent.tsx:942` | 資料欄位與開新頁行為保留；與站內 URL 遷移分開處理。 |

## 改造相容策略

1. **Freeze first**：將本清冊視為基線；先加新 URL，再遷移呼叫端，最後才評估舊入口退役。
2. **頁面可 redirect，API 不 redirect**：舊頁面以 307/308 或 server redirect 保留 query；API 以 adapter 轉呼叫相同 handler，維持 method/body/status/JSON 或 PDF。
3. **公開 ID 正規化**：`/share/[id]`、PDF 與各 `[id]` route 同時接受有/無連字號形式；不要在 URL 改用新的業務單號而沒有舊 ID fallback。
4. **Query 白名單不縮減**：`tab`、`fromQuote`、分頁 cursor、`refresh=1`、`registrations=1` 與報表參數均為契約；未知 query 可忽略，但既有值不可改義。
5. **外部入口雙跑**：Webhook/Cron 若必須換路徑，先部署新舊兩個 handler，共用驗證與核心邏輯；外部設定確認切換後保留舊入口至少一個觀察週期。
6. **回歸最低集合**：逐項驗證 `/` 登入導流、舊 redirect aliases、客戶/工單/訂單深連結、報價分享與 PDF、轉訂單 query、LINE 簽章、三個 cron header、NextAuth signout/callback。

## 未確認事項

- 未讀取 Vercel、GitHub Actions、LINE Developer Console 等外部設定，因此實際呼叫網域、排程時間及是否仍有歷史 callback 為「未確認」。
- 靜態搜尋無法證明所有客戶端書籤或 Notion 舊資料中的 URL；因此列為高風險的公開分享與 PDF 應採永久相容，而非依存取量推定可刪。
