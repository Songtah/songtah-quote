# AGENTS.md — 崧達企業管理系統開發指引（給 Codex 與其他 AI 開發代理）

> 2026-10-28 由 Claude Code 交接時整理。**本檔是入口與工作方式；領域規則的唯一來源是 `CLAUDE.md`**，
> 兩者衝突時以 `CLAUDE.md` 為準。新增或修改規則請寫進 `CLAUDE.md`（上限 150 行，長內容放 `docs/rules/`），
> 本檔只在「工作方式／環境／陷阱／交接狀態」改變時更新。這個 repo 是**公開的**：不得寫入任何金鑰、密碼、客戶資料。

## 0. 動工前必讀（依序）

1. `CLAUDE.md` 全文 —— 最高原則、資料架構、醫事監控、客情、業務漏斗、行銷活動、安全、通知、Notion 分層、工程慣例
2. `docs/rules/design-language.md` —— 動任何 UI 前必讀（棕金 brand、cream、stone、`.card-soft`、`rounded-full`、禁 blue）
3. `docs/security-data-classification.md` —— 資料分級 L1–L4 與角色存取矩陣
4. `docs/page-authoring-rules.md` —— 各分頁用途、路由、權限模組
5. 依任務再讀：`docs/rules/visit-customer-matching.md`（客情配對）、`docs/strategy/operating-system-roadmap.md`（長期方向）

## 1. 使用者與溝通

- 使用者是公司負責人（牙科材料代理商，約 25 人），**不是工程師**。一律繁體中文、臺灣用語、全形標點；先講結論、用白話，避免程式術語。
- **先查證再動手**。使用者原話：「你最好檢查我原先的設計有用這個服務嗎？不要給我亂搞」。不確定現況就先唯讀盤點，不要憑印象改設定或叫使用者去設定。
- 不要把使用者沒看過、沒定義過的欄位放進報表或畫面；新欄位先說明意義。
- 下列動作**先問、等明確同意**：刪除資料、改 Notion 正式主檔的大量資料、涉及費用的服務（API、簡訊、LINE 推播額度）、對外發送訊息。
- 不代輸入、不複製任何金鑰／密碼；需要設定環境變數時，告訴使用者「變數名稱＋去哪裡貼」，值放在本機 `.env.local` 讓使用者自己貼。
- 對外文案語氣：崧達是「陪伴技工所／診所轉型」，**絕不用「數位取代技師」的口吻**。

## 2. 最高原則（摘要，全文見 CLAUDE.md）

**業務唯一的手動義務是回報當日客情，其餘都是系統的事。** 規劃功能先問「能不能自動判定」；
任何待辦／追蹤／通知都要能自己結案；不得新增「請業務自己填」的欄位；同一件事只能有一套表達。

## 3. 技術棧與結構

- Next.js 14（App Router）＋ TypeScript ＋ Tailwind；資料庫是 **Notion**（`@notionhq/client`）；快取與狀態用 **Upstash Redis**；部署 **Vercel**；排程用 GitHub Actions（`.github/workflows/*.yml` 呼叫 `/api/cron/*`）＋ Vercel cron。
- `lib/notion/shared.ts`：基礎層（client、雙層快取 L1 記憶體＋L2 Redis、限流重試、`cachedSWR`、`runExclusiveScan`、`hitRateLimit`）。**不可 import 任何領域檔。**
- `lib/notion/<domain>.ts`：葉領域，彼此不互相 import；跨領域彙總只放組合層（`lib/notion/dashboard.ts` 等）或 route。
- `lib/system-notion.ts` 只是 barrel re-export，**不要往裡面加實作**。
- AI 判讀（客情反應、維修偵測）用 Anthropic API：`lib/visit-reaction-ai.ts`。
- 通知：機制在 `lib/notifications.ts`，「什麼事通知誰」只寫在 `lib/notification-events.ts`。

## 4. 開發流程（每次都照做）

1. 改完跑 `npx tsc --noEmit`，乾淨才 commit。
2. Commit 訊息用中文：`feat(scope): 描述`／`fix(scope): 描述`／`style(scope): 描述`。
3. **每次修改都要部署**：`git pull --rebase` → `git push` 到 `main`（Vercel 自動部署，約 1–2 分鐘）。可能有其他代理同時作業，push 前一定先 rebase。
4. **部署後在正式站驗證**（`https://songtah-quote.vercel.app`），看「畫面上實際顯示的文字」與互動，不能只用選擇器數元素（曾漏掉 JSX 註解直接顯示在首頁）。
5. 正式站驗證時：不要送出會產生真實資料的表單（報名、訂單、簽核），用預覽、dry-run 或唯讀 API 驗證；需要真實流程測試時請使用者操作。
6. 改了規則就同步更新 `CLAUDE.md` 對應段落。

### Notion 結構變更
- 一律寫成腳本 `scripts/add-*.mjs`：預設 dry-run 列出會新增的欄位，`--write` 才執行；**只新增、不刪改既有欄位**。範例：`scripts/add-registration-fields.mjs`、`scripts/add-quote-order-link-fields.mjs`。
- GET／讀取路徑**禁止**呼叫 `notion.databases.update`。
- 寫入正式主檔前先 dry-run 印出受影響筆數與樣本。

## 5. 環境與帳號

- 正式站在 Vercel 的**公司帳號**下的專案 `songtah-quote`；使用者個人帳號有一個同名專案，**那不是正式站**，查設定別看錯。
- 主要環境變數（值只在 Vercel 與本機 `.env.local`，`.env*` 已 gitignore）：
  `NOTION_TOKEN`、各 `NOTION_*_DB`、`KV_REST_API_URL`／`KV_REST_API_TOKEN`（Redis）、`NEXTAUTH_SECRET`、`ANTHROPIC_API_KEY`、
  `LINE_*`、`DAILY_REPORT_SECRET`、`BLOB_READ_WRITE_TOKEN`、`VAPID_PUBLIC_KEY`／`VAPID_PRIVATE_KEY`／`VAPID_SUBJECT`（網頁推播）。
- 本機的 `DAILY_REPORT_SECRET` 與正式站不同，本機無法直接呼叫 `/api/cron/*`。
- Redis 是免費方案（每月約 50 萬指令），大量新增 Redis 用量前先估算並告知使用者。

## 6. 資料與效能陷阱（都踩過）

- **Notion 無過濾查詢在 10,000 筆處靜默截斷**：客戶庫全掃用 `scanAllCustomerPages`（依縣市分區），客情庫用 `scanVisitPages`（依日期分區）。已用日期範圍過濾的查詢不要再分區（會變慢）。統計出「剛好整數」要當截斷警訊。
- **Notion 限流 429**：大型重算用 `runExclusiveScan`（Redis 鎖）排隊。
- **L1 快取是單一 Vercel 實例的記憶體**，換實例就各算各的：跨實例的計數／限流一定要用 Redis 原子操作（`hitRateLimit`），不要用「讀 `getRedisValue` 再 `setRedisValue`」。
- 首頁等重頁面用 `cachedSWR`（先回快取、背景重算）；資料寫入時呼叫對應的 `mark*Dirty()`，結果不完整時 `shouldCache` 回 false 不要存。
- **時區**：伺服器在 UTC。日期取星期／日期一律用 UTC 方法或明確 +8 小時；業務日 03:00 換日（`businessDayTW()`）。曾因 `getDay()` 讓 12/12（六）顯示成（五）。
- 客情只收 2025-12 以後的資料；舊日報不補。
- **營收／交易金額只有中央管理帳號可看**：不得寫入 Notion 客戶主檔、不得進 repo。

## 7. 前端陷阱

- JSX 裡的註解一律用 `{/* */}`；改包裝結構（例如 `(` 改 `(<>`）後，原本的 `//` 會變成畫面文字。
- 系統**沒有深色模式**：元件庫帶進來的 `dark:` class 要拿掉（曾讓首頁數字在深色模式變白字白底）。
- 不要用會隱藏真實資料的動畫（數字先顯示 0 再跳、清單逐筆冒出）；初始畫面就要是正確資料，並支援 `prefers-reduced-motion`。
- 觸控裝置的按鈕用 `tap-target` class（`pointer: coarse` 時至少 44px）。
- 載入骨架用 `components/PageSkeleton.tsx`（真的導覽列＋相同邊距），不要各頁另畫一套。
- 報價單／訂購單 PDF 配色集中在 `lib/pdf-brand.tsx`；品牌深綠 `pine-700`（Logo 色 `#344a33`）用於付款資訊等強調區。
- 公開頁（`/register`、`/checkin`、`/r/*`、`/share`）不經登入：遵守 CLAUDE.md 的公開例外防線（簽章／限流／honeypot／不回傳客戶資料）。

## 8. 交接時的進行中事項（2026-10-28）

- **報價單轉訂貨單**：已上線，但正式站尚無「已核准」報價單，還沒完整走過一次。下次有核准報價時請使用者實測（品項、單價、備註「請行政確認」）。
- **網頁推播**：金鑰已設定、正式站讀得到；待使用者在各裝置按「開啟這台裝置的通知」並用「傳送測試」確認。尚未接上的事件：轄區新開業機構、課程客戶即將到期（皆為每晚批次產生）。
- **技術規格資料**：選產品自動帶規格的機制已完成，但產品後台「技術規格」表只有 1 項有資料（系列規格涵蓋約 2,686 項），需中央管理補資料。
- **線上報名**：建議加 Cloudflare Turnstile 防惡意佔名額，等使用者決定並自行取得金鑰；短網址可再搭配公司網域子網域（需使用者設 DNS）。
- 先前提出、尚未獲回覆：報價單「待定價」品項顯示 0 的處理方式、Notion 搬遷評估、3 家「回報歇業但之後仍有拜訪」的客戶待人工確認（名單在醫事監控頁的客情歇業紀錄）。

## 9. 回報方式

做完一件事，回報：改了什麼（使用者看得懂的說法）、是否已部署、**在正式站實際驗證了什麼、沒驗證到什麼及原因**、需要使用者決定或操作的事。失敗或跳過的步驟要照實說。
