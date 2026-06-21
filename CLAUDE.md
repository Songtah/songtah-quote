# 崧達企業管理系統 — 開發規則

## 設計語言（2026 暖色柔深度）

所有新 UI 與改版**必須**遵循此設計語言，tokens 定義在 `app/globals.css` 的 `@layer components`。

### 核心原則

1. **柔深度取代框線**：卡片不用 `border border-gray-200`，一律用 `.card-soft`（層疊陰影＋細環線）。可互動的卡片加 `.card-soft-hover`（hover 浮起）。
2. **品牌色是唯一 accent**：主要動作、選中狀態、hover 強調一律用 `brand-500`（#b8956a 棕金）。禁止藍色（`blue-*`）作為互動色——那是舊風格的殘留。
3. **膠囊與大圓角**：按鈕用 `rounded-full`，面板用 `rounded-2xl`/`rounded-3xl`。禁止 `rounded` / `rounded-md` 的小圓角。
4. **微互動必備**：可點元素加 `active:scale-95 transition-all`；主 CTA 加 `shadow-md shadow-brand-500/25`。
5. **中性色用 stone 不用 gray**：文字 `text-stone-800`（標題）/ `text-stone-600`（內文）/ `text-stone-400`（輔助）；分隔線 `border-stone-900/[0.06]`。

### 必用 Tokens（globals.css）

| Token | 用途 |
|-------|------|
| `.card-soft` | 所有卡片容器 |
| `.card-soft-hover` | 可點擊卡片的 hover 浮起 |
| `.glass-bar` | 吸頂/吸底工具列（backdrop-blur 玻璃）|
| `.chip` / `.chip-active` | 規格選擇、篩選膠囊 |
| `.price-pill` | 價格徽章（翡翠綠）|
| `.input-soft` | 文字輸入框（無框柔底，聚焦白底＋品牌光環）|
| `.select-soft` | 下拉選單（同 input-soft 語言）|

### 標準元件寫法

```tsx
// 主要按鈕（CTA）
className="px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white
           hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all"

// 次要按鈕
className="px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white
           text-stone-600 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all"

// 清單列 hover（品牌色暈染，不用 blue/gray）
className="hover:bg-brand-50/50 transition-colors"

// Modal 面板
className="bg-[#fcfbf8] rounded-3xl shadow-2xl ring-1 ring-stone-900/[0.06] overflow-hidden"

// 區段小標（eyebrow）
className="text-[11px] font-bold uppercase tracking-widest text-stone-400"
```

### 禁止事項

- ❌ `border border-gray-200 rounded-lg` 平面灰框卡
- ❌ `text-blue-600` / `bg-blue-50` 互動色（狀態徽章除外，如訂單狀態）
- ❌ 無 transition 的可點元素
- ❌ 原生樣式的 `<input>` / `<select>`（一律 `.input-soft` / `.select-soft`）
- ❌ 新增顏色 token——只能用 tailwind.config.ts 既有的 brand / gold / cream / stone 色票

## 資料架構鐵則

1. **價格快照**：訂單/報價一旦成立，品名與單價定格在單據內，禁止連動主檔。
2. **欄位擁有權**：貨號/品名歸 ERP（唯讀）；分類/價格/規格歸 `public/products_catalog.json`；圖片/介紹歸 Notion。
3. **ERP 匯入新品後必跑** `python3 scripts/validate_categories.py`，分類錯誤先修再上線。
4. **價格更新流程**：改 Excel 主檔 → `scripts/merge_catalog_prices.py` → git push 部署。價格表比對規則見桌面《價格表比對規則.docx》。

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
2. **狀態回寫會改 Notion 主檔（高風險操作）**：歇業候選/醫院待確認的「開業狀態」下拉 → `POST /api/admin/medical-monitor/status` → `updateCustomerStatus` **直接寫入 Notion 客戶庫「機構狀態」select**。這是改動正式主檔，UI 須讓使用者明確操作（逐筆、不自動觸發）；寫入後必 `deleteRedisValue('customers-with-codes-v1')` 使下次比對讀到新值。機構狀態 ∈ {停業,已歇業,撤銷} 者自動排除候選（結案）。
3. **匯入也是寫 Notion 主檔**：待開發機構匯入 → `createSystemCustomer` 建立新客戶，並依機構代碼從 `data/bas-cache.json` 反查 basSeq、打 BAS 詳細頁（`fetchBasFull`）帶入 地址/電話/健保特約 + 機構資料/醫事人員連結/診療科別連結（URL 格式須與既有一致：BASBasicData／BASMedicalPersonnel／BASDepartments）。
4. **比對結果與紀錄存伺服器端 Redis（刷新不可消失）**：最近結果＝`medical-monitor:last-result`（開頁回此、`?refresh=1` 才重算並覆寫）；每月趨勢紀錄＝`medical-monitor:history`（依快照月份去重、保留 36 筆）。**不可改回只存 localStorage**——跨裝置共用且要耐清快取。helper 在 `lib/system-notion.ts`（`get/setCachedMonitorResult`、`get/pushMonitorHistory`）。
5. **快照建置永不讓 Action 失敗**：`scripts/clinic-monitor.mjs` 對 BAS（有 WAF/限流）採持久快取＋時間預算＋帶走舊值＋永不 throw；換來源（prev.source≠'mohw-bas'）時跳過月對月 diff，避免假異動灌爆 Notion 監控紀錄。

## 工程慣例

- 修改後必跑 `npx tsc --noEmit`，乾淨才 commit。
- Commit 訊息用中文，格式 `feat(scope): 描述`。
- 部署 = push to main（Vercel 自動）。涉及費用的功能（API、簡訊、LINE push 等）動工前先告知用戶。
- **每次修正都要部署**：任何修改完成（tsc 乾淨）後一律 commit 並 `git push` 到 main，不要只改不部署。多人／多 session 同時作業時，push 前先 `git pull --rebase` 避免互蓋。
