# 全站 A 版 UI 頁面盤點

盤點日期：2026-07-20  
範圍：`app/**/page.tsx`（31 個頁面檔）與 `components/AppShell.tsx`。本文件只做唯讀盤點，不代表已改版。

## 結論摘要

- 31 個 `page.tsx` 中，25 個直接使用 `AppShell`，檔案覆蓋率 **80.6%**。
- 扣除 3 個純轉址頁後，共 28 個實際畫面；其中 25 個由 `AppShell` 包覆，畫面覆蓋率 **89.3%**。
- 3 個必須獨立處理的實際畫面：`/dashboard`、`/login`、`/share/[id]`。
- 3 個純轉址頁：`/`、`/products`、`/customers/regions`；不需視覺改造，但網址相容性必須回歸測試。
- 集中修改 `AppShell` 可以統一 25 頁的頁首、導覽、標題區、容器、登出與字級控制；無法取代各內容元件內的表格、表單、篩選、手機操作與空／錯誤狀態改造。

## 分類與網址清單

### 1. 業務常用（12 個實際畫面）

| URL | 頁面／主要標題 | 殼層 | 主要內容元件 | 證據 |
|---|---|---|---|---|
| `/dashboard` | 今日工作首頁 | 自訂 `SalesTodayDashboard` | `SalesTodayDashboard` | `app/dashboard/page.tsx:8` |
| `/bd` | 業務開發・客情紀錄／匯入／開發漏斗／追蹤名單／拜訪建議 | AppShell | `VisitsContent`、`DailyReportPanel`、`PipelineContent`、`CampaignsContent` | `app/bd/page.tsx:42` |
| `/customers` | 客戶管理 | AppShell | `CustomersContent` | `app/customers/page.tsx:11` |
| `/customers/[id]` | 客戶主檔／客戶 360 | AppShell | 頁面內大型實作、`VisitsContent` | `app/customers/[id]/page.tsx:176`、`:216` |
| `/quotes` | 報價單管理 | AppShell | `QuoteListContent` | `app/quotes/page.tsx:11` |
| `/quote/new` | 新增報價單 | AppShell | `QuoteForm` | `app/quote/new/page.tsx:14` |
| `/orders` | 訂貨單管理 | AppShell | `OrdersContent` | `app/orders/page.tsx:11` |
| `/orders/new` | 新增訂貨單 | AppShell | `OrderForm` | `app/orders/new/page.tsx:45` |
| `/orders/[id]` | 訂貨單＋單號 | AppShell | `OrderForm` | `app/orders/[id]/page.tsx:38` |
| `/products/catalog` | 產品目錄 | AppShell | `CatalogManagerContent` | `app/products/catalog/page.tsx:14` |
| `/promotions` | 促銷活動 | AppShell | `PromotionsContent` | `app/promotions/page.tsx:12` |
| `/assets` | 品牌素材庫 | AppShell | `AssetLibraryContent` | `app/assets/page.tsx:16` |

### 2. 主管（5 個實際畫面）

| URL | 頁面／主要標題 | 殼層 | 主要內容元件 | 證據 |
|---|---|---|---|---|
| `/marketing` | 行銷管理 | AppShell | `MarketingContent` | `app/marketing/page.tsx:16` |
| `/events` | 活動管理 | AppShell | `EventsContent` | `app/events/page.tsx:12` |
| `/events/[id]` | 活動詳情 | AppShell | `EventDetailContent` | `app/events/[id]/page.tsx:12` |
| `/course-costs` | 辦課成本試算 | AppShell | `CourseCostsContent` | `app/course-costs/page.tsx:12` |
| `/admin` | 行政管理／報價簽核 | AppShell | `AdminQuoteContent` | `app/admin/page.tsx:23` |

### 3. 服務（4 個實際畫面）

| URL | 頁面／主要標題 | 殼層 | 主要內容元件 | 證據 |
|---|---|---|---|---|
| `/tickets` | 技術支援 | AppShell | `TicketsContent` | `app/tickets/page.tsx:9` |
| `/tickets/new` | 新建工單 | AppShell | `TicketForm` | `app/tickets/new/page.tsx:14` |
| `/tickets/[id]` | 客戶名／案件詳情 | AppShell | 頁面內大型實作 | `app/tickets/[id]/page.tsx:159`、`:163` |
| `/equipment/[id]` | 設備詳細資訊 | AppShell | 頁面內實作 | `app/equipment/[id]/page.tsx:70` |

### 4. 管理（5 個實際畫面）

| URL | 頁面／主要標題 | 殼層 | 主要內容元件 | 證據 |
|---|---|---|---|---|
| `/admin/clinic-monitor` | 客戶資料監控／區域客戶儀表板／業務轄區管理／商機偵測 | AppShell | `ClinicMonitorContent`、`RegionStatsContent`、`TerritoryContent` | `app/admin/clinic-monitor/page.tsx:50` |
| `/admin/trip-planner` | 行程規劃 | AppShell | `TripPlannerContent` | `app/admin/trip-planner/page.tsx:12` |
| `/admin/line-import` | LINE 客情紀錄匯入 | AppShell | `LineImportContent` | `app/admin/line-import/page.tsx:11` |
| `/settings/accounts` | 帳號與權限 | AppShell | `AccountsContent` | `app/settings/accounts/page.tsx:11` |
| `/settings/audit` | 操作紀錄 | AppShell | `AuditLogsContent` | `app/settings/audit/page.tsx:11` |

### 5. 特殊公開／入口（2 個實際畫面）

| URL | 頁面／主要標題 | 殼層 | 說明 | 證據 |
|---|---|---|---|---|
| `/login` | 企業管理系統登入 | 獨立 | 公開登入入口，登入後前往 `/dashboard` | `app/login/page.tsx:30`、`:43` |
| `/share/[id]` | 對外報價分享頁 | 獨立 | 客戶可見的公開報價畫面，含未找到／未開放狀態與 PDF | `app/share/[id]/page.tsx:19`、`:28`、`:42`、`:175` |

### 6. 保留網址的純轉址（3 個，無獨立 UI）

| URL | 目前行為 | 證據 |
|---|---|---|
| `/` | 已登入轉 `/dashboard`，未登入轉 `/login` | `app/page.tsx:5-8` |
| `/products` | 轉 `/products/catalog` | `app/products/page.tsx:3-4` |
| `/customers/regions` | 轉 `/admin/clinic-monitor?tab=regions` | `app/customers/regions/page.tsx:4-5` |

## 共用殼層：可集中改造的範圍

`AppShell` 的集中責任如下：

- 權限導覽項目與四群組（工作／交易／服務／管理）：`components/AppShell.tsx:50-74`。
- 依角色、帳號類型、模組權限過濾導覽：`components/AppShell.tsx:76-89`、`:118-126`。
- 目前桌機與手機共用的頂部 Logo、標題、字級與登出列：`components/AppShell.tsx:139-170`。
- 目前手機是橫向捲動膠囊導覽，而非 A 版首頁的底部導覽：`components/AppShell.tsx:172-200`。
- 共用內容寬度、頁面標題與說明：`components/AppShell.tsx:202-207`。
- 頁面瀏覽稽核的標題映射尚未包含 `/equipment/[id]`、`/admin/line-import` 等少數路徑，改造時應一併盤點但不可改變稽核語意：`components/AppShell.tsx:17-46`。

因此第一個集中批次應改 `AppShell`，能立刻影響 25 個頁面；`/dashboard` 已有 A 版自訂殼層，應抽取或對齊共用導覽模式，避免兩套導覽行為。

## 必須逐頁／逐元件處理的範圍

共用殼層不會改變內容區。核心內容元件合計約 **20,752 行**，不能只換殼就宣稱全站完成。特別需要逐頁驗收：

1. **大型業務交易表單**：`OrderForm` 2,209 行、`QuoteForm` 791 行；需保留價格快照、促銷驗證、簽核與所有既有操作。
2. **客情與產品**：`VisitsContent` 2,888 行、`CatalogManagerContent` 2,917 行；有最多狀態、篩選與手機互動。
3. **促銷與監控**：`PromotionsContent` 1,485 行、`ClinicMonitorContent` 1,204 行、`RegionStatsContent` 1,019 行；屬管理密集頁，適合將低頻工具收進次層。
4. **大型頁面內實作**：`customers/[id]/page.tsx` 804 行、`tickets/[id]/page.tsx` 328 行、`equipment/[id]/page.tsx` 199 行，沒有獨立內容元件可單純替換。
5. **對外頁面**：`/share/[id]` 不可套內部導覽，但應獨立對齊新版白色品牌語言並驗證公開權限與 PDF 連結。
6. **登入頁**：需保持獨立、簡單且不可洩漏帳號存在與敏感資訊。

## 建議改造批次與驗收邊界

1. **共用基礎**：AppShell、通用頁標、卡片、按鈕、輸入、表格、空／錯誤／載入狀態；保留每條 URL。
2. **業務主路徑**：客戶 → 客戶詳情 → 報價 → 訂貨 → 業務開發；逐條實際操作但不寫正式資料。
3. **服務與行銷**：工單、設備、活動、促銷、素材、辦課成本。
4. **主管與管理**：簽核、監控、轄區、行程、LINE 匯入、帳號權限、稽核。
5. **特殊頁與相容性**：登入、公開分享、三個轉址；檢查舊連結、query/tab 參數、動態 `[id]` 與手機 400px。

上架門檻必須是：每個正式頁面靜態檢查通過、實際開啟無 runtime error、主要互動可用、合法角色不誤擋、未授權角色確實被擋、手機關鍵操作可完成，最後才 commit／push／部署。
