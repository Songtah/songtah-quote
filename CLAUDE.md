# 崧達企業管理系統 — 開發規則

> 通用工作方法(模型調度/交辦範本/判斷 rubric)在 `~/.claude/ops/`,由全域 CLAUDE.md 路由;本檔只放**這個系統特有**的領域鐵則。本檔上限 150 行,長內容放 `docs/rules/` 並在此留一行路由。

## 公司營運系統長期方向（規劃或改功能前必讀）

- 四大主線、共同資料底座、分期路線圖與不破壞既有功能的交付原則：`docs/strategy/operating-system-roadmap.md`
- 最新盤點與已確認的 live schema 風險：`docs/strategy/2026-07-14-system-inventory.md`、`docs/strategy/2026-07-14-ticket-schema-audit.md`
- 產品分類主樹、商品型態、3D 列印公開分類與無破壞遷移規則：`docs/strategy/product-taxonomy-v1.md`
- 原則：系統由「分頁功能集合」轉為「訊號 → 判斷 → 工作 → 負責人 → 期限 → 結果 → 指標」閉環；不得以策略改造為由破壞既有報價、訂貨、客情、技服、設備、行銷或行政流程。

## 設計語言(摘要;動任何 UI 前必讀 docs/rules/design-language.md 全文)

- 卡片用 `.card-soft`(禁平面灰框)、按鈕 `rounded-full`、互動色只用 brand-500 棕金(**禁止 blue-\***)
- 輸入一律 `.input-soft`/`.select-soft`;中性色用 stone 不用 gray;可點元素必加 `active:scale-95 transition-all`
- 完整 tokens、標準寫法、禁止清單:`docs/rules/design-language.md`

## 資料架構鐵則

0. **Notion 全庫掃描必用分區**:無過濾的 `databases.query` 分頁在 **10,000 筆處靜默截斷**(has_more 直接 false,2026-07-06 實測 10,655 筆只回 10,000,曾致監控誤判 280 筆重複匯入)。掃全客戶庫一律走 `lib/notion/customers.ts` 的 `scanAllCustomerPages`(按縣市分區+空白批);其他接近萬筆的 DB 全掃比照辦理。

1. **價格快照**：訂單/報價一旦成立，品名與單價定格在單據內，禁止連動主檔。
2. **欄位擁有權**：貨號/品名歸 ERP（唯讀）；分類/價格/規格歸 `public/products_catalog.json`；圖片/介紹歸 Notion。
3. **ERP 匯入新品後必跑** `python3 scripts/validate_categories.py`，分類錯誤先修再上線。
4. **價格更新流程**：改 Excel 主檔 → `scripts/merge_catalog_prices.py` → git push 部署。價格表比對規則見桌面《價格表比對規則.docx》。
5. **銷售狀態同步**：核對表（桌面《產品目錄核對表》）的「銷售狀態」以貨號（`code`）合併回 `products_catalog.json`——有售價→寫 `price`；已停售／未販售→`discontinued:true` 且 `status` 記細分。**選品器以 `discontinued` 隱藏**：`searchCatalog`（`/api/products/search`，訂貨/報價）過濾掉 discontinued；管理頁走 `getCatalog`／`catalog-raw` 仍全顯示並標狀態徽章。既成單據走價格快照不受影響。

## 促銷與訂貨鐵則

1. **促銷比對類型感知**：訂貨頁套用促銷時，`skuCode` 精準比對優先；`seriesId` **只**用於系列級促銷（`series_discount`／`series_buy_n_get_m`）。買A送B／加價購／單品特價等一律只認 `skuCode`，避免同系列其他產品被誤觸發（曾導致沒訂的贈品 Detax 亂跳）。helper：`OrderForm` 的 `matchPromoItem`。
2. **跨規格系列買N送M（同系列跨規格合計）**：
   - 進度橫幅只在訂單**已有該系列品項**時顯示（`totalQty>0`）。
   - **達標自動跳出該系列選單**讓使用者選贈品（`giftPicker` + `ProductPicker lockSeriesId`），每系列自動彈一次，banner 另有「選擇贈品」按鈕可重開。
   - **未選滿贈品不可儲存**（`handleSave` 驗證 giftCount≥freeQty）。
3. **促銷設定防呆**：促銷設定頁條件類型分組（折扣／贈品／加購組合），依品項是單品或系列只開放對的類型；儲存前必填驗證（買A送B 必填贈品、商品組合必填搭配品、系列類限系列品項）。源頭杜絕錯設定。
4. **定價進行中降級**：產品尚未定價時，訂貨品項顯示「待定價／尚未定價」而非靜默 0。

## 醫事監控鐵則（客戶資料監控）

1. **對照來源＝衛福部 BAS**（`ma.mohw.gov.tw` 醫事查詢系統），非 NHI 健保開放資料。診所/醫院/衛生所＝`BAS_KIND=A`+`DEP_DEPT_ID=51`、牙技所＝`2`、鑲牙所＝`L`。快照只收「開業」者。詳見記憶 `project_clinic_monitor`。
2. **狀態回寫會改 Notion 主檔（高風險操作）**：歇業候選/醫院待確認的「開業狀態」下拉 → `POST /api/admin/medical-monitor/status` → `updateCustomerStatus` **直接寫入 Notion 客戶庫「機構狀態」select**。這是改動正式主檔，UI 須讓使用者明確操作（逐筆、不自動觸發）；寫入後必 `deleteRedisValue('customers-with-codes-v2')` 使下次比對讀到新值。機構狀態 ∈ {停業,已歇業,撤銷} 者自動排除候選（結案）。
3. **匯入也是寫 Notion 主檔**：待開發機構匯入 → `createSystemCustomer` 建立新客戶，並依機構代碼從 `data/bas-cache.json` 反查 basSeq、打 BAS 詳細頁（`fetchBasFull`）帶入 地址/電話/健保特約 + 機構資料/醫事人員連結/診療科別連結（URL 格式須與既有一致：BASBasicData／BASMedicalPersonnel／BASDepartments）。
4. **比對結果與紀錄存伺服器端 Redis（刷新不可消失）**：最近結果＝`medical-monitor:last-result`（開頁回此、`?refresh=1` 才重算並覆寫）；每月趨勢紀錄＝`medical-monitor:history`（依快照月份去重、保留 36 筆）。**不可改回只存 localStorage**——跨裝置共用且要耐清快取。helper 在 `lib/system-notion.ts`（`get/setCachedMonitorResult`、`get/pushMonitorHistory`）。
5. **快照建置永不讓 Action 失敗**：`scripts/clinic-monitor.mjs` 對 BAS（有 WAF/限流）採持久快取＋時間預算＋帶走舊值＋永不 throw；換來源（prev.source≠'mohw-bas'）時跳過月對月 diff，避免假異動灌爆 Notion 監控紀錄。

## 客情拜訪鐵則

1. **回報窗 17:00～隔日 03:00（台北）**：客情紀錄由 `app/api/line/webhook` 解析 LINE 每日報表建檔。**只在回報窗內擷取**——依 `event.timestamp` 換算台北時 `hour>=17 || hour<3` 才建檔，03:00–17:00 的訊息一律略過（避免誤抓日間非回報資料）。
2. **業務日 03:00 換日**：`businessDayTW()`（`lib/ceo-stats.ts`）= now−3h 取日期；報表日期解析（`lib/line-daily-report.ts`）同樣 03:00 前算前一天。拜訪 `日期` 為 date-only（無時間），時間資訊只在 `created_time`（且多為批次匯入時間，不代表實際拜訪時刻）。
3. **待追蹤＝跨月未結案，禁止改回只看本月**：待追蹤定義為「是否需追蹤=true 且 追蹤已結案=false」，不限月份（`listOpenFollowUps`、ceo-stats `fetchOpenFollowUps`）。結案唯一路徑＝勾 `追蹤已結案` checkbox（`closeFollowUp`／PATCH `/api/visits/follow-ups`，可逆）。舊版只算本月導致月初整批消失（曾累積 397 筆黑數），不可回退。

## 業務開發漏斗鐵則

1. **機構狀態 ≠ 開發階段，嚴格分離**：`機構狀態`＝營業狀態（開業/停業/已歇業/撤銷/狀況不明），只歸醫事監控領域寫入；`開發階段`（線索/已接觸/試用中/報價中/已成交/流失）＝業務關係狀態，只歸業務領域寫入（`updateCustomerDevStage`）。**禁止把「潛在客戶」之類的業務語意塞回機構狀態**——兩邊會互蓋（監控狀態回寫 vs 業務標記）。
2. **開發階段掛在客戶主檔，不另建商機實體**：漏斗看板（`/bd?tab=pipeline`、`/api/bd/pipeline` 組合層 route）直接讀客戶庫的 開發階段/開發來源/負責業務 ＋ 跨月待追蹤彙總。認領＝寫 `負責業務`。
3. **BAS 新開業自動入池**：醫事監控匯入（`createSystemCustomer`）一律帶 `開發階段=線索、開發來源=BAS新開業`，讓新開業機構直接出現在漏斗的未認領區。
4. **開發拜訪不加新欄位**：「這筆是不是開發拜訪」由拜訪對象的開發階段推導（∈ 線索/已接觸），不要求業務多填型態欄位；客戶反應（要求報價/同意試用/使用競品…）是階段推進與競品檔案的訊號源。

## 安全鐵則（2026 資安稽核後建立）

1. **API route 一律用 `withApiAuth` 宣告授權規則，不能只檢查 `if (!session)`**：`session` 只證明「有登入」，不證明「有權限」。統一閘道在 `lib/api-auth.ts`——`export const POST = withApiAuth(rule, async (req, ctx, session) => {...})`，規則為 `'session'`（只需登入）／`'admin'`（role==='admin'）／`{ roles: [...] }`（accountType 任一）／`{ module, action:'view'|'edit' }`（沿用 `lib/permissions` 的 canView/canEdit）。**新增任何 route 一律走 withApiAuth**。例外只有雙重驗證的 `daily-report`（cron secret）與 `line/webhook`（HMAC），這兩個維持手動驗證。高權限路由（accounts、admin/medical-monitor、clinic-monitor、line/import、dashboard/ceo）已全數採用;其餘 module-edit 寫入路由仍有正確的 inline `canEdit` 檢查（安全），可漸進改用 withApiAuth。
2. **密碼一律雜湊，禁止明文比對／儲存**：`lib/system-notion.ts` 的 `hashPassword`/`verifyPassword`（bcrypt）是唯一允許的密碼存取路徑；新增任何帳號相關欄位寫入都要走這兩個 helper，不可直接 `properties['密碼'] = richText(plainPassword)`。
3. **共用密鑰比對一律 timing-safe**：LINE webhook 簽章、`DAILY_REPORT_SECRET` 等共用密鑰比對禁止用 `===`，要用 `crypto.timingSafeEqual`；密鑰未設定時必須「失效關閉」（拒絕請求），不可「失效開放」。
4. **訂單金額/數量伺服器端必須驗證**：兩道防線,任何新增訂貨/報價寫入路徑都要套用,不可只信任前端算好的金額——
   - `lib/orders-notion.ts` 的 `validateOrderItems`：基本防線（數量正整數、單價非負、贈品/樣品貨號須存在、贈品數量不可超過一般購買數量）。
   - **`lib/order-pricing.ts` 的 `validateOrderPromotions`（促銷權威）**：`createOrder`/`updateOrder` 依訂單 `promotionId` 重抓「已確認」促銷品項→跑此純引擎→**驗證前端宣稱的促銷帶價與免費贈品是否真的成立**（免費品必須由 buy_a_get_b/buy_n_get_m/series_buy_n_get_m 授權且不超量;single_price/series_discount/qty_discount 等帶價須等於重算值;rate 型以目錄價當折前基準防灌高）。**手動非促銷價放行**（業務議價,由報價審批把關）。此引擎是前後端共用的單一真實來源;改促銷規則要同步改這裡。
5. **報價單狀態機**：`app/api/quotes/[id]/approve/route.ts` 的 `TRANSITIONS` 表是唯一允許的狀態轉換來源，新增簽核動作要先在這張表加規則，不可繞過直接呼叫 `updateQuoteStatus`。
6. **對外代理／外部圖片一律驗證網域**：`app/api/notion-image/route.ts` 的 `isUrlSafeToProxy` 是唯一允許代理的網址檢查，新增任何「伺服器端 fetch 使用者可控 URL」的功能都要套用同等的 host allowlist + 私網位址檢查，避免 SSRF。

## Notion 資料層架構原則（拆 god module 的長期防線）

目標：避免 `system-notion.ts` 那種「什麼都包」的 god module 復發。`lib/notion/` 分兩層：

1. **基礎層 `lib/notion/shared.ts`**：Notion client、雙層快取、DB id 對照、property helper、限流重試。**leaf，不可 import 任何領域檔**。
2. **葉領域 `lib/notion/<domain>.ts`**（customers／equipment／visits／tickets／events／course-costs／medical-monitor／accounts…）：各自擁有自己的 Notion DB 與查詢，**包含「依某客戶查」這類查詢**（例：`listCustomerEquipment` 歸 equipment、`listCustomerEvents` 歸 events——「某客戶的 X」歸 X，不歸客戶）。**葉領域彼此不互相 import**。
3. **組合層 `lib/notion/dashboard.ts`（及客戶 360 等彙總）**：跨領域彙總/組合**只能放這裡**，它 import 多個葉領域，自己不直接碰 DB 細節。

**鐵律：葉領域不互依；任何「跨多個領域的彙總邏輯」一律放組合層或上層 route，不准滲回葉領域。** 這條一旦守住，再長的彙總都不會把某個領域檔養成新的 god module。

**現況（拆分已完成）**：`system-notion.ts` 已收斂為**純 barrel re-export**（2883 → ~72 行），所有實作在 `lib/notion/*`：`shared`（基礎）、`relations`（跨切面 relation 解析）、葉領域 `customers/equipment/visits/tickets/events/course-costs/medical-monitor/products-search/accounts`、組合層 `dashboard`、權限模型 `permissions-model`。**既有 `import { ... } from '@/lib/system-notion'` 全部維持相容**；新程式可直接 import 對應的 `lib/notion/<domain>` 檔。**新增領域請建新檔，不要往 `system-notion.ts` 加實作。**

## 工程慣例

- 修改後必跑 `npx tsc --noEmit`，乾淨才 commit。
- Commit 訊息用中文，格式 `feat(scope): 描述`。
- 部署 = push to main（Vercel 自動）。涉及費用的功能（API、簡訊、LINE push 等）動工前先告知用戶。
- **每次修正都要部署**：任何修改完成（tsc 乾淨）後一律 commit 並 `git push` 到 main，不要只改不部署。多人／多 session 同時作業時，push 前先 `git pull --rebase` 避免互蓋。
