# 2026-07-14 工單 Live Schema 唯讀盤點

> 資料來源：正式環境 `.env.local` 指向的 Notion 工單 DB。
> 操作：只讀取 database schema 與依建立日期倒序的前 20 筆；未寫入、未改 schema、未觸發通知。
> 隱私：本文件不保存 token、客戶名稱或完整 relation ID。

## 一、Live schema

| 欄位 | 型別 |
|---|---|
| 人員 | people |
| 備註 | rich_text |
| 優先級 | select |
| 原因 | rich_text |
| 品牌 | rollup |
| 客戶單位 | title |
| 建立日期 | date |
| 影像或照片資料(售後) | files |
| 影像或照片資料(客戶) | files |
| 情境描述 | rich_text |
| 技術人員 | relation |
| 技術支援對口 | select |
| 故障分類 | multi_select |
| 時效指標 | formula |
| 業務窗口 | select |
| 狀態 | status |
| 生產商 | select |
| 產品資料庫 | relation |
| 編號 | unique_id |
| 解決方案 | rich_text |
| 關鍵料件 | rich_text |
| 預計維修日期（外派） | date |
| 🏥 牙科單位資料 | relation |

schema 中沒有：`案件標題`、`案件類型`、`聯絡人`、`全台牙科相關單位名單`，也沒有設備 relation。

## 二、前 20 筆樣本分布

- 取樣數：20；查詢仍有下一頁。
- 建立日期範圍：2026-01-22 至 2026-04-15。
- 客戶 relation：19/20 有值。
- 產品 relation：17/20 有值。
- 技術人員 relation：7/20 有值。
- 優先級：20/20 皆為空白。
- 狀態：`✅ 結案` 15、`🔍 後續追蹤` 2、`⚙️ 測試中` 2、`🔧 維修中` 1。

以上只是最近 20 筆樣本，不代表全庫統計；任何全庫結論仍需分頁盤點。

## 三、程式與 schema 的已確認矛盾

| 程式行為 | Live schema | 風險 |
|---|---|---|
| 建立時寫 `案件標題` rich_text | 欄位不存在 | Notion validation error |
| 建立時寫 `案件類型` select | 正式欄位為 `故障分類` multi_select | validation error；既有分類讀取也可能為空 |
| 建立時寫 `聯絡人` rich_text | 欄位不存在 | validation error；直接移除會遺失表單資料 |
| 建立時寫 `全台牙科相關單位名單` relation | 正式欄位為 `🏥 牙科單位資料` relation | validation error或客戶 360 斷鏈 |
| 表單送出 `equipmentId` | 正式 DB 無設備 relation | 設備維修履歷無法建立 |

相關程式：`lib/notion/tickets.ts` 的 mapper 與 `createTicket`、`app/api/tickets/route.ts` 的必填驗證、`types/index.ts` 的 `CreateTicketPayload`。

## 四、決策選項

### 選項 A：補齊正式 schema（建議）

1. 新增 `案件標題` rich_text。
2. 新增 `聯絡人` rich_text。
3. 新增設備 relation，relation 目標指向正式設備 DB；欄位名稱須在建立前確認。
4. 程式改用既有 `故障分類` multi_select。
5. 客戶 relation 改用既有 `🏥 牙科單位資料`。

優點：保留表單資料並形成設備維修履歷。風險：屬正式 Notion schema 變更，需確認 automation、前 20 筆樣本與回滾策略後由使用者核准。

### 選項 B：不改 schema

移除不存在欄位，將案件標題與聯絡人合併進 `情境描述` 或 `備註`，只寫既有 relation 與分類欄位。

優點：不改正式 schema。缺點：資料失去結構化、查詢與排程能力，與技服規模化方向不一致，不建議作長期方案。

## 五、下一步安全閘門

在使用者核准選項 A 前，不改正式 Notion schema、不對正式 DB 建立測試工單。核准後仍須：

1. 唯讀確認設備 DB 的 database ID 與 relation 目標。
2. 確認 Notion automation 是否依 `客戶單位` title、狀態或分類觸發。
3. schema 變更前列出現有欄位及前 20 筆樣本（本文件已完成工單端；設備端待完成）。
4. 先新增 optional 欄位，再部署兼容程式；不批次改歷史資料。
5. 以一筆明確標示的測試工單驗證建立、列表、客戶 360、設備履歷與 read-back；測試資料的後續處理另經使用者確認，不自行刪除。
