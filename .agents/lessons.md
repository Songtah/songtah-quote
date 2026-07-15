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

## 2026-07-15 公開 Blob 覆寫後立即讀到舊索引
- 現象：產品圖片索引 `put` 成功後，立即 `get` 仍回傳前一版內容，造成 `Blob image index read-back mismatch` 並讓批次在正式 Notion 寫入後中止。
- 根因：Vercel 公開 Blob CDN 在覆寫後有快取更新窗；`cache: no-store` 與 query string 不能保證避開舊內容，逐筆 read-modify-write 可能以舊 body 覆蓋新索引。
- 新規則：公開 Blob RMW 前必須核對 GET response ETag 與控制面 HEAD ETag；批次匯入不逐筆改 Blob 索引，完成後由 Notion 權威資料全量重建並做 SHA-256 read-back。
- 寫回：暫不升級
