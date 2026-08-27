# quote-system 資料流斷鏈唯讀盤點

盤點日期：2026-07-14  
範圍：客戶主鍵／relations、拜訪多入口副作用、儀表板即時扇出  
限制：未修改程式；工作樹盤點前已有 `app/bd/VisitSuggestionsContent.tsx`、`tmp/unmatched-customers-review.csv` 與多個 `tmp/` 未追蹤檔，均未碰觸。

## 建議的最低風險第一批

先修 1、2、3、4：全部是局部資料流修補，不需搬資料庫或重做 UI。修正時先從 Notion schema 唯讀確認正式 relation 欄位，再加兼容讀取與入口一致性測試；不可直接改欄名後上線。

## 發現

### 1. [Critical] 工單建立與客戶頁查詢使用不同 relation 欄位

- 現況：建立工單寫入 `全台牙科相關單位名單`，但客戶工單查詢與 mapper 讀取 `🏥 牙科單位資料`。
- 證據：`lib/notion/tickets.ts:23`、`lib/notion/tickets.ts:53`、`lib/notion/tickets.ts:153-155`。
- 影響功能：從表單成功建立的工單，可能不會出現在客戶 360 的工單清單，名稱解析也會退回文字欄位；客戶主鍵斷鏈。
- 最小修法：唯讀查 Notion 工單 DB schema 與 20 筆樣本，確認現行正式 relation；建立、查詢、mapper 統一該欄位。遷移前保留舊欄位兼容讀取，避免歷史資料消失。
- 回歸測試：以測試客戶建立工單後，`GET /api/customers/{id}` 的 `tickets` 立即含該筆且名稱正確；歷史上只連舊欄位的工單仍可查到。

### 2. [High] 設備 relation 探測在「欄位存在但結果為 0」時過早停止

- 現況：設備查詢依四個候選 relation 欄位逐一嘗試；第一個欄位只要 schema 合法便 `break`，即使結果為空。單筆設備又只讀 `客戶名稱`。
- 證據：`lib/notion/equipment.ts:147-175`、`lib/notion/equipment.ts:238`。
- 影響功能：若資料分散在歷史 relation 欄位，客戶設備清單會錯誤顯示空白；單筆設備連回客戶的連結也可能缺失。
- 最小修法：先唯讀確認 schema 和 20 筆 relation 分布；查詢端對所有存在欄位取聯集並以 page ID 去重，單筆 mapper 共用同一個 relation 解析 helper。
- 回歸測試：為每個仍有資料的歷史 relation 欄位準備 fixture；客戶設備清單均能找到且不重複，設備詳情 `customerId` 一致。

### 3. [High] LINE 管理匯入只存客戶名稱，未存客戶 relation

- 現況：`/api/line/import/batch` 建立拜訪時沒有搜尋或傳入 `customerId`；相對地 webhook 入口會先搜尋客戶並傳 relation。
- 證據：`app/api/line/import/batch/route.ts:55-77`、`app/api/line/webhook/route.ts:135-153`、`lib/notion/visits.ts:386-388`。
- 影響功能：同一份 LINE 拜訪資料因入口不同而有不同資料品質；名稱匯入紀錄不會進入依 `customerId` 運作的客戶 360、開發漏斗、名單與建議邏輯。
- 最小修法：抽出共用的「客戶精準配對」服務；只有唯一可靠命中才寫 relation，多筆或模糊命中列入人工例外，不可直接取第一筆。
- 回歸測試：唯一命中時拜訪可由客戶 ID 查回；同名兩客戶時不得誤連；找不到時仍可保留名稱建檔並回傳未配對狀態。

### 4. [High] 拜訪入口的 Campaign「已聯絡」副作用不一致

- 現況：一般 `POST /api/visits` 會呼叫 `bumpContactedByCustomer`，但日報 bulk import、LINE batch、LINE webhook 都只建立拜訪，沒有相同連動。
- 證據：`app/api/visits/route.ts:55-58`、`app/api/visits/bulk-import/route.ts:38-70`、`app/api/line/import/batch/route.ts:59-81`、`app/api/line/webhook/route.ts:151-170`。
- 影響功能：行銷名單是否顯示已聯絡取決於業務用哪個入口回報，導致行銷與業務狀態不同步。
- 最小修法：把「建立拜訪後的可重試副作用」放到單一 application service；各入口共用。副作用失敗需留下可補跑紀錄，不能阻斷拜訪建檔。
- 回歸測試：四個入口各建一筆有 relation 的拜訪，Campaign 成員都只從未聯絡轉為已聯絡一次；副作用模擬失敗時拜訪仍成功且有失敗紀錄可補跑。

### 5. [Medium] 拜訪稽核紀錄依入口而異

- 現況：一般建立與日報 bulk import 有 `logAuditEvent`；LINE batch 和 LINE webhook 沒有同等稽核事件。
- 證據：`app/api/visits/route.ts:60-70`、`app/api/visits/bulk-import/route.ts:60-70`、`app/api/line/import/batch/route.ts:59-81`、`app/api/line/webhook/route.ts:151-176`。
- 影響功能：行政無法從系統操作紀錄完整追溯來源、操作者、失敗與補跑；自動化規模化後風險放大。
- 最小修法：共用建立服務統一產生 source、actor、sourceEventId 與 audit；webhook actor 明確標示系統／LINE user，不假裝為登入者。
- 回歸測試：四入口成功與部分失敗案例均有可對應的 audit；同一 sourceEventId 重送不重複記帳。

### 6. [Critical] 首頁儀表板的 `total` 實際只是第一頁筆數

- 現況：`querySummary` 只讀第一頁，直接以 `rows.length` 當 `total`；首頁又把此值作為各模組總數。預設 page size 100，超過只回 `hasMore=true`。
- 證據：`lib/notion/shared.ts:232-243`、`lib/notion/dashboard.ts:80-96`、`lib/notion/dashboard.ts:124-144`、`lib/notion/dashboard.ts:213-223`。
- 影響功能：客戶、工單、產品等超過 100 筆時，決策數字會固定或低估；UI 雖可知道 hasMore，`total` 名稱仍會讓人誤判為真實總數。
- 最小修法：第一批先把欄位語意改為 `loadedCount` 或 UI 顯示 `100+`，避免錯誤決策；後續以排程快照計算權威總數，不在請求路徑全掃。
- 回歸測試：101 筆 fixture 不得顯示總數 100；若尚未有快照，必須顯示 `100+`／「至少 100」，不能顯示精確 100。

### 7. [High] CEO 儀表板冷啟動一次扇出至少 10 個 Notion 查詢鏈

- 現況：冷快取會平行讀訂單、報價、本月拜訪、跨月待追蹤與 6 個月份計數；route 在 12 秒回 503。月計數每月又可分頁最多 10 頁。
- 證據：`lib/ceo-stats.ts:338-354`、`lib/ceo-stats.ts:215-232`、`app/api/dashboard/ceo/route.ts:9-16`。
- 影響功能：多人或 serverless 多 instance 同時冷啟動時放大 Notion rate limit；任何慢查詢都可能讓主管儀表板整體逾時。
- 最小修法：不先改算法；先新增排程生成月指標快照，route 只讀最後成功快照並標示 `generatedAt`。保留現有即時計算作受控重算／fallback。
- 回歸測試：模擬 Notion 延遲或限流時 API 仍在期限內回最後成功快照；重算成功後原子替換，失敗不覆蓋舊快照。

### 8. [High] CEO 30 分鐘快取是 process-local，且沒有資料變更失效機制

- 現況：CEO stats 用模組內 `Map` 快取 30 分鐘；拜訪建立只清首頁拜訪第一頁 Redis key，沒有清 CEO stats。不同 serverless instance 會各自持有不同快取。
- 證據：`lib/ceo-stats.ts:18-26`、`lib/ceo-stats.ts:319-322`、`lib/ceo-stats.ts:457`、`lib/notion/visits.ts:190-196`、`lib/notion/visits.ts:346-367`。
- 影響功能：剛完成的拜訪、訂單或報價可能 30 分鐘不進決策數字；不同使用者可能看到不同生成時間與數值。
- 最小修法：與第 7 項一起改為共享快照；所有數字顯示資料時間。若要近即時，寫入後只發送 dirty marker，由背景重算，不在交易路徑同步扇出。
- 回歸測試：兩個 process／instance 讀到相同 snapshot version；寫入後 dirty marker 可觀察，重算前仍回舊快照且清楚標時，重算後一致更新。

## 回歸保護原則

1. 任何 relation 修正都先做 schema + 前 20 筆樣本唯讀盤點，並保留舊欄位兼容讀取至少一個部署批次。
2. 每批只修一條資料流；`npx tsc --noEmit` 後實跑既有合法路徑與新修路徑。
3. 拜訪寫入與 Campaign／audit 副作用分開判定：拜訪成功不得因非核心副作用暫時失敗而回滾或向使用者假報失敗。
4. 儀表板先修「數字語意正確」再做效能重構，避免為追求即時而增加全庫掃描。

驗收: 通過
