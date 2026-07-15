## 2026-07-15 瀏覽器控制初始化重複失敗
- 現象：產品頁 UI 驗收兩次在 browser-client 初始化時出現 `Cannot redefine property: process`，前一輪產品頁工作也曾發生相同錯誤。
- 根因：本機瀏覽器控制 runtime 在設定全域 `process` 屬性時與既有環境衝突；尚未確認是外掛版本或宿主狀態造成。
- 新規則：同一工作遇到此錯誤一次重設後仍復現就停止重試，明確標示未完成點擊驗收，改做路由回應、資料契約、靜態檢查與 fresh-context 審查。
- 寫回：暫不升級

## 2026-07-15 Notion 新增後的查詢索引延遲造成假失敗
- 現象：新增 `AG-03000` 產品列成功後，立即依貨號 query 未讀到新列並回報 `Notion image URL read-back mismatch`，稍後以 page ID 與獨立查詢均確認資料已存在。
- 根因：以資料庫 filter query 當作新增後的即時 read-back，受到 Notion 搜尋索引延遲影響；失敗發生在正式寫入之後、稽核之前。
- 新規則：Notion create／update 後以回傳的 page ID 直接 GET read-back；批次一旦開始外部寫入，後續任何錯誤都 fail-stop，重跑時必須能補登缺失稽核。
- 寫回：暫不升級
