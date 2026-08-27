# quote-system 回歸基線盤點（2026-07-14）

## 結論

目前可用的自動安全網只有 TypeScript 與 production build；專案沒有可直接執行的單元、整合或 E2E 測試。`npm run lint` 雖存在，但因沒有 ESLint 設定，實際執行會進入互動式設定而失敗，不能當 CI gate。GitHub Actions 兩支 workflow 都是會接觸正式服務的營運排程，不是 pull request CI，不應用來驗證一般程式修改。

本次基線是在 dirty worktree 上量測：`app/bd/VisitSuggestionsContent.tsx` 已有未提交修改，另有使用者既有的 `tmp/` 報表檔；因此只能證明「目前工作目錄」通過，不能直接宣稱 commit `5073ca1` 的乾淨基線通過。

## 現有命令與本次結果

| 命令 | 來源 | 本次結果 | 可否作 gate |
|---|---|---|---|
| `npx tsc --noEmit` | `CLAUDE.md:77`；`tsconfig.json:7` | 通過，exit 0 | 是，所有批次必跑 |
| `npm run build` | `package.json:7` | 通過，60 個頁面生成完成 | 是，但需處理既有 warning |
| `npm run lint` | `package.json:9` | 未通過：啟動 ESLint 互動式初始化 | 否，先建立明確 ESLint 設定 |
| `npm run dev` | `package.json:6` | 本次未啟動 | 僅供本地 UI/API smoke |
| `npm start` | `package.json:8` | 本次未啟動 | 需先 build，適合 production-mode smoke |

Build 既有警訊：`next.config.mjs:6` 的 `serverExternalPackages` 不被目前 Next.js 14.2.5（`package.json:27`）辨識；另有 ESM 與 `punycode` deprecation warning。這些目前不阻擋 build，但修改前後應維持 warning 數量不增加，另開批次處理，不要混入功能重構。

## GitHub workflows 現況

- `.github/workflows/clinic-monitor.yml:3-13`：每月排程／手動執行；即使有 `dry_run`，仍會下載外部資料，而非程式碼 CI。非 dry-run 會在 `.github/workflows/clinic-monitor.yml:44-57` commit/push snapshot。
- `.github/workflows/refresh-region-stats.yml:14-44`：依序 POST 正式站區域統計、Campaign 自動結案、拜訪建議刷新；這是正式資料／快取工作，絕對不能當 smoke test。
- 缺少：PR/push 的 install、typecheck、build、test workflow；目前改壞功能不會在 GitHub 自動攔截。

## 測試缺口

1. `package.json:36-44` 沒有 Jest/Vitest/Playwright/Cypress 等 devDependency；`package.json:5-10` 沒有 `test` 或 `typecheck` script。
2. repo 搜尋不到實際 `describe()`／`it()`／`test()` 測試；lockfile 中的 Playwright 只是間接 optional dependency，不代表測試框架已安裝。
3. 沒有固定 fixture/test database；目前多數 API 直接接 Notion，不能安全地用正式資料做寫入回歸。
4. 沒有 API response contract、權限矩陣或資料層 mock；最容易發生「編譯成功、業務流程故障」。
5. 數個既有 route 仍是裸 handler，未走統一 `withApiAuth`，例如 `app/api/course-costs/route.ts:7-14`、`app/api/events/route.ts:7-18`、`app/api/assets/route.ts:17-30`、`app/api/products/route.ts:8`。未來調整時必須把「目前行為」和「目標權限」分開記錄，避免安全修正順帶造成合法角色誤擋。

## 四主線 smoke test（每個可部署批次都要跑）

### A. 業務開發

- UI：登入一般業務帳號，依序開 `/bd?tab=pipeline`、`campaigns`、`suggest`、`report`；五個 tab 定義見 `app/bd/page.tsx:41-45`。確認資料能載入、切換不報錯、權限外的 LINE 匯入不可見。
- 唯讀 API：`GET /api/bd/pipeline`（`app/api/bd/pipeline/route.ts:13`）、`GET /api/bd/campaigns`（`app/api/bd/campaigns/route.ts:13`）、`GET /api/bd/visit-suggestions`（`app/api/bd/visit-suggestions/route.ts:14`）、`GET /api/visits/follow-ups`（`app/api/visits/follow-ups/route.ts:11`）。記錄 status、top-level keys、筆數、前 20 筆 ID；修改後比對 schema 與 ID 集合差異。
- 寫入路徑只在隔離 fixture 驗證：認領／階段推進、建立追蹤名單、結案後可逆。正式 Notion 不做自動 smoke 寫入。

### B. 設備與技術支援

- UI：一般業務與技術角色分別開 `/tickets`、一筆 `/tickets/[id]`、`/tickets/new`、一筆 `/equipment/[id]`；確認列表、篩選、詳情、附件／設備資訊與新增表單都能顯示。
- 唯讀 API：`GET /api/tickets`（`app/api/tickets/route.ts:17`）、`GET /api/tickets/[id]`（`app/api/tickets/[id]/route.ts:5`）、`GET /api/equipment`（`app/api/equipment/route.ts:15`）、`GET /api/equipment/[id]`（`app/api/equipment/[id]/route.ts:5`）。比對 status、schema、筆數與關聯設備／客戶 ID。
- 隔離寫入 smoke：建立工單 → 指派 → 狀態推進 → 排程 → 完成 → 重開；同時驗證無編輯權限角色被拒。現況單筆 ticket route 只有 GET，因此新增狀態流程前要保留列表與詳情讀取相容性。

### C. 行政自動化

- UI：行政角色檢查 `/quotes`、`/orders`、`/course-costs`、`/admin/line-import`、`/settings/accounts`；一般業務角色確認不該出現的操作不可用。
- 唯讀 API：`GET /api/quotes`（`app/api/quotes/route.ts:7`）、`GET /api/orders`（`app/api/orders/route.ts:5`）、`GET /api/dashboard`（`app/api/dashboard/route.ts:7`）。比對 status、單據 snapshot 欄位、金額欄位與角色可見性。
- 隔離寫入 smoke：報價建立／簽核狀態轉換、訂單建立與促銷價格驗證、LINE 匯入 dry-run／預覽、失敗工作人工接管。禁止觸發 LINE push、daily report、cron 或正式 Notion 寫入。

### D. 行銷與業務協作

- UI：行政／行銷角色開 `/marketing`，確認促銷、活動、素材、Campaign 相關區塊能載入；業務角色只看到被授權的檢視／回饋操作。頁面入口見 `app/marketing/page.tsx:9-28`。
- 唯讀 API：`GET /api/promotions`（`app/api/promotions/route.ts:8`）、`GET /api/events`（`app/api/events/route.ts:7`）、`GET /api/assets`（`app/api/assets/route.ts:17`）、`GET /api/bd/campaigns`。比對 status、schema、期間／狀態欄位與目標 SKU。
- 隔離寫入 smoke：建立 Campaign → 匯入名單 → 指派業務 → 回饋狀態 → 模擬成交歸因；促銷仍需同時測合法訂單不誤擋與非法價格確實被擋。

## 第一批修改前後的固定比對

1. **先凍結程式基線**：記錄 commit、dirty files、Node/npm 版本、`npx tsc --noEmit`、`npm run build` exit code與 warning；dirty 狀態下不得把結果歸因給 main。
2. **登入與權限**：未登入請求被擋；業務、技術、行政、總經理各自能看的頁面與按鈕不變；權限修正要同時測合法角色不誤擋。
3. **核心唯讀資料**：上述四主線 GET 各保存 status、top-level keys、筆數與前 20 筆穩定 ID；若資料本身會變，至少比較 schema、必填欄位與關聯完整率，不用絕對筆數硬判失敗。
4. **頁面可用性**：登入後逐頁打開 `/dashboard`、`/bd` 四個一般 tab、`/tickets`、工單詳情、設備詳情、`/quotes`、`/orders`、`/marketing`；不得有 console error、500、無限 loading 或主要 CTA 消失。
5. **關鍵領域不變式**：單據價格 snapshot 不漂移；停售產品不出現在選品器但管理頁仍可見；促銷合法／非法雙向驗證；追蹤結案可逆；設備與工單仍連到原客戶。
6. **外部副作用為零**：測試不得觸發 `.github/workflows/refresh-region-stats.yml:14-44`、LINE push、簡訊、正式 Campaign 自動結案或醫事監控寫回。
7. **每批交付 gate**：`tsc` + build + 四主線受影響區域 smoke；沒有自動測試前，至少由不同驗證者 read-back，並保留執行證據。

## 建議的最小防故障建設順序

1. 新增非互動 `typecheck`、可執行 lint 設定及 PR CI，但先不改業務邏輯。
2. 為純函式先補單元測試：促銷／訂單驗證、開發訊號評分、LINE 業務日日期、權限判斷。
3. 抽出 Notion repository interface，建立測試 adapter 與固定 fixture，才能安全測 POST/PATCH/DELETE。
4. 加 Playwright 的角色化 read-only smoke；寫入流程只指向隔離 DB，且 teardown read-back 驗證復原。
5. 第一個功能批次採 feature flag 或只新增讀取／建議層；資料 schema、正式寫入與自動通知分成後續獨立批次。

驗收: 通過
