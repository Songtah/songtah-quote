# 2026-07-14 工單 Live Schema 唯讀盤點

> 資料來源：正式環境 `.env.local` 指向的 Notion 工單 DB。
> 操作：只讀取 database schema 與依建立日期倒序的前 20 筆；未寫入、未改 schema、未觸發通知。
> 隱私：本文件不保存 token、客戶名稱或完整 relation ID。

> 2026-07-14 執行狀態：使用者明確核准選項 A；schema、程式 mapping、一筆正式測試工單 read-back，以及受權限控管的工單更新流程均已完成。

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

初次盤點時 schema 中沒有：`案件標題`、`案件類型`、`聯絡人`、`全台牙科相關單位名單`，也沒有設備 relation。

依明確授權新增後，read-back 已確認：

- `案件標題`：rich_text。
- `聯絡人`：rich_text。
- `設備資料`：指向正式設備 DB 的 single-property relation。
- 既有 `故障分類` 仍為 multi_select；既有 `🏥 牙科單位資料` relation 未改動。

## 二、前 20 筆樣本分布

- 取樣數：20；查詢仍有下一頁。
- 建立日期範圍：2026-01-22 至 2026-04-15。
- 客戶 relation：19/20 有值。
- 產品 relation：17/20 有值。
- 技術人員 relation：7/20 有值。
- 優先級：20/20 皆為空白。
- 狀態：`✅ 結案` 15、`🔍 後續追蹤` 2、`⚙️ 測試中` 2、`🔧 維修中` 1。

以上只是最近 20 筆樣本，不代表全庫統計；任何全庫結論仍需分頁盤點。

### Live options 快照

- 狀態：`尚未處理`、`👌 已受理`、`🔍 診斷問題中`、`🔧 維修中`、`⚙️ 測試中`、`🔍 後續追蹤`、`✅ 結案`。
- 優先級：`P1`、`P2`、`P3`、`P4`。
- 技術支援對口：`小黃`、`Paul`、`Aaron`、`Ted`、`Luca`、`Brain`、`致廷`。
- 業務窗口：`公司直營`、`Duncan`、`Gus`、`Hank`、`James`、`Eason`、`Amy`、`小郭`、`Paul`、`Chloe`。
- 生產商：`ASIGA`、`Zirkonzhan`、`金泰`、`KO-MAX`、`BSM`、`普登`、`AR Loupe`、`ACTILINK`、`Graphy`、`HANAU`。
- 初次盤點時 `故障分類` 無既有 option；正式測試建立 `技術支援` option 成功。

## 三、初次盤點時的程式與 schema 矛盾（已修正）

下表記錄修正前狀態；相關 schema 與 mapping 已依第五、六節完成更新與 read-back。

| 當時的程式行為 | 初次盤點時的 Live schema | 當時風險 |
|---|---|---|
| 建立時寫 `案件標題` rich_text | 欄位不存在 | Notion validation error |
| 建立時寫 `案件類型` select | 正式欄位為 `故障分類` multi_select | validation error；既有分類讀取也可能為空 |
| 建立時寫 `聯絡人` rich_text | 欄位不存在 | validation error；直接移除會遺失表單資料 |
| 建立時寫 `全台牙科相關單位名單` relation | 正式欄位為 `🏥 牙科單位資料` relation | validation error或客戶 360 斷鏈 |
| 表單送出 `equipmentId` | 正式 DB 無設備 relation | 設備維修履歷無法建立 |

相關程式：`lib/notion/tickets.ts` 的 mapper 與 `createTicket`、`app/api/tickets/route.ts` 的必填驗證、`types/index.ts` 的 `CreateTicketPayload`。

## 四、設備 DB 盤點

正式設備 DB 標題為「持有的數位牙材設備」。新增工單 relation 前的前 20 筆樣本結果：

- 客戶 relation：18/20 有值。
- 機型 relation：20/20 有值。
- 軟體模組 relation：0/20 有值。
- 產品狀態：18/20 有值。

設備 DB 的正式客戶 relation 為 `客戶名稱`，機型 relation 為 `機型`。工單新增的 `設備資料` 採單向 relation，未新增或改動設備 DB 欄位。

## 五、決策與執行

### 選項 A：補齊正式 schema（已採用）

1. 新增 `案件標題` rich_text。
2. 新增 `聯絡人` rich_text。
3. 新增設備 relation，relation 目標指向正式設備 DB；欄位名稱須在建立前確認。
4. 程式改用既有 `故障分類` multi_select。
5. 客戶 relation 改用既有 `🏥 牙科單位資料`。

已依使用者明確授權執行。只新增 optional 欄位，不刪除、改名或批次改寫既有資料。

### 選項 B：不改 schema（未採用）

移除不存在欄位，將案件標題與聯絡人合併進 `情境描述` 或 `備註`，只寫既有 relation 與分類欄位。

優點：不改正式 schema。缺點：資料失去結構化、查詢與排程能力，與技服規模化方向不一致，不建議作長期方案。

## 六、正式測試工單 read-back

測試工單 page ID：`39ddcdaa-fb2a-818a-9655-fafdc9ebade5`。

已驗證且全部通過：

1. 案件標題 rich_text。
2. 聯絡人 rich_text。
3. 故障分類 multi-select（技術支援）。
4. 客戶 relation。
5. 設備 relation。
6. 產品 relation。
7. 初始狀態（尚未處理）。

同一筆測試工單再補齊其餘欄位，read-back 全部通過：

- 優先級：P4。
- 技術支援對口：Paul。
- 業務窗口：公司直營。
- 生產商：ASIGA。
- 預計維修日期：2026-07-15。
- 關鍵料件、原因及解決方案 rich_text。

read-back 後已將測試工單狀態改為 `✅ 結案`，未刪除，以保留稽核軌跡。

API 防呆同步補強：POST 會在呼叫 Notion 前驗證案件類型、狀態、優先級、技術支援對口、業務窗口、生產商、三個 relation ID 格式及日期格式；無效輸入回 400。

後續以同一筆已結案測試工單驗證 PATCH 資料層：暫時修改狀態與備註、立即 read-back，再精確還原原值並二次 read-back。快取一致性修正前後各執行一輪，兩輪皆通過；最終狀態皆為 `✅ 結案`。

工單更新流程的安全邊界：

- `GET` 需 `rma.view`，`PATCH` 需 `rma.edit`。
- PATCH 僅接受狀態、優先級、技術支援對口、業務窗口、預計維修日期、原因、解決方案、備註及設備 relation。
- malformed JSON、未知欄位、非字串、無效 option/date/relation 與超過 2000 字的處理文字會回 400。
- 正常路徑記錄 before/after 與 changed fields；read-back 暫時失敗時仍以驗證後變更建立 after、記錄稽核並回更新成功。
- 為避免 Vercel 多 instance 回傳舊工單，本領域不再使用 process-local 詳情與清單快取。

## 七、仍待後續處理

1. 確認現有 Notion automation 是否依 `客戶單位` title、狀態或分類觸發。
2. 工單詳情已可連至設備詳情；設備詳情尚未呈現反向工單維修履歷。
3. 工單狀態、優先級、對口、業務窗口、預計日期與處理紀錄已可人工更新；SLA、正式改派規則與排程衝突控制仍屬下一批。
