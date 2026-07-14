# 2026-07-14 營運系統第一輪盤點

> 盤點方式：程式碼與現有文件唯讀檢查；未對正式 Notion 資料做寫入。
> 對應長期方向：`docs/strategy/operating-system-roadmap.md`

## 一、結論

系統已有業務漏斗、拜訪建議、追蹤名單、工單、設備、促銷、活動、素材、行政簽核與夜間排程，不需要重建。當前主要風險是跨入口、跨 relation、快取與指標語意尚未形成一致底座。

第一批只處理不改 schema、可逆且能降低故障風險的項目。所有需要改正式 Notion relation、status 或大量資料的工作，必須先做 live schema 唯讀盤點、影響筆數與前 20 筆樣本。

## 二、已確認問題與處理順序

| 優先級 | 發現 | 影響 | 決策 |
|---|---|---|---|
| P0（已修正） | 工單新增刪除 `tickets:list`，實際清單快取為 `tickets:list:v2:*` | 新工單可能三分鐘不出現，造成重複送單 | 2026-07-14 已修正所有清單 key 及該客戶工單快取；typecheck、build、fresh-context read-back 通過 |
| P0（已修正） | 工單建立 payload 原有四項不符合 live schema：案件標題、案件類型、聯絡人及客戶 relation 欄位 | 建立工單可能被 Notion 拒絕 | 2026-07-14 已依明確授權新增 optional 欄位並修正程式 mapping；正式測試工單 read-back 通過 |
| P0（已修正） | 工單表單送出 `equipmentId`，原 live 工單 DB 沒有設備 relation | 無法形成設備維修履歷 | 2026-07-14 已新增單向 `設備資料` relation；正式測試工單設備 relation read-back 通過 |
| P1 | 設備查詢遇到第一個合法但空的 relation 便停止 | 歷史設備可能在客戶頁消失 | 盤點各 relation 分布後，兼容取聯集與去重 |
| P1 | LINE batch 拜訪只存名稱，未必保存客戶 relation | 同一事件因入口而有不同資料品質 | 抽共用精準配對；多筆或模糊命中進人工例外 |
| P1 | 只有一般拜訪 POST 推進 Campaign 已聯絡狀態 | 行銷名單狀態取決於回報入口 | 建立共用 application service 與可補跑副作用 |
| P1 | CEO dashboard 冷啟動扇出多組 Notion 查詢且有 12 秒 timeout | 主管數字慢、逾時或跨 instance 不一致 | 改為共享快照及 generatedAt，現有即時計算保留為受控重算 |
| P1 | 首頁摘要的 `total` 是第一頁筆數 | 可能把至少 100 誤解為精確 100 | UI 保留 `+` 語意；後續接權威快照，不在請求路徑全掃 |
| P1 | 工單只有預計外派日，缺狀態更新、SLA、改派與衝突控制 | 技服仍是紀錄，不是可控履約流程 | 完成 schema 與角色/狀態盤點後分批新增 |
| P2 | 產品文件 metadata 為 JSON rich text，未形成知識庫 | 不利搜尋、版本與機型適用管理 | 先定義知識模型與權限，不改寫既有文件 JSON |

## 三、目前回歸安全網

- `npx tsc --noEmit`：2026-07-14 基線通過。
- `npm run build`：2026-07-14 基線通過；存在既有 Next config/deprecation warning，後續不得增加。
- `npm run lint`：目前會進入互動式 ESLint 初始化，不能作為 gate。
- 專案目前沒有正式單元、整合或 E2E 測試，也沒有 PR CI。
- 兩支 GitHub Actions 是會接觸正式服務/資料的營運排程，不可作一般程式 smoke test。

## 四、每批固定防故障檢查

1. 記錄 commit、dirty files、Node/npm 版本及修改前後 typecheck/build 結果。
2. 只跑受影響區域的唯讀 API/UI；正式資料寫入只可在隔離 fixture 或使用者明確核准下測試。
3. 權限修改同時驗證未授權者被擋與合法角色不被誤擋。
4. 報價/訂單價格快照、促銷伺服器驗證、追蹤可逆結案、Webhook簽章及醫事監控安全不可退步。
5. 自動化修改不得觸發 LINE push、Campaign 正式自動結案、醫事監控回寫或其他對外副作用。
6. 每批由 fresh-context 驗證者 read-back，並保留型別、建置與目標流程證據。

## 五、下一批唯讀盤點

### 工單 DB（schema、20 筆樣本與第一批修正已完成）

- 已確認 live properties、relation 目標與前 20 筆客戶/產品/技術人員 relation 分布。
- 已新增 `案件標題`、`聯絡人` 與單向 `設備資料` relation；`故障分類` 沿用既有 multi-select。
- 程式已改用正確客戶 relation、設備 relation 及 multi-select 寫法，並保留舊 `案件類型` 讀取 fallback。
- 尚須確認：Notion automation 是否依現有 title 或 status 運作，避免 schema 調整造成連動故障。

### 設備 DB

- 客戶與產品 relation 的正式欄位。
- 各歷史候選 relation 的資料分布，避免修正後讓舊設備消失。

### 拜訪與 Campaign

- REST、日報 bulk、LINE batch、LINE webhook 四入口的 payload、relation、audit 及 Campaign 副作用。
- 定義唯一命中、多重命中與無法命中的客戶配對行為。

### 指標與排程

- KPI 字典：分子、分母、期間、時區、排除條件、來源與 generatedAt。
- cron/workflow 執行履歷、冪等、重試、補跑與告警缺口。

## 六、第一批實作範圍

本批已修正工單新增後的快取失效：

- 清除所有 `tickets:list:v2:*` 第一頁快取。
- 若工單有客戶 relation，同時清除該客戶的 `customer-tickets:*` 快取。
- 不改 API contract、Notion schema、工單 payload、狀態或 UI。

驗收結果：`npx tsc --noEmit` 與 `npm run build` 通過；fresh-context 驗證快取 key 與既有清單邏輯一致。由於正式建立工單會寫 Notion，本批未以正式資料做自動寫入 smoke。
