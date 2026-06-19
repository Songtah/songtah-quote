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

## 工程慣例

- 修改後必跑 `npx tsc --noEmit`，乾淨才 commit。
- Commit 訊息用中文，格式 `feat(scope): 描述`。
- 部署 = push to main（Vercel 自動）。涉及費用的功能（API、簡訊、LINE push 等）動工前先告知用戶。
- **每次修正都要部署**：任何修改完成（tsc 乾淨）後一律 commit 並 `git push` 到 main，不要只改不部署。多人／多 session 同時作業時，push 前先 `git pull --rebase` 避免互蓋。
