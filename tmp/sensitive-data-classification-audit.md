# quote-system 敏感資料分級與最小揭露稽核

稽核日期：2026-07-20  
性質：高風險安全設計第二意見；唯讀盤點，未修改程式。  
範圍：客戶個資、拜訪內容、價格/折扣/成本/毛利、業績排行、帳號權限、稽核、token/secret、公開分享/PDF、AI 輸入與匯出。

## 結論

現況已有模組 view/edit、admin、中央管理及 accountType roles 閘道，但多個讀取 API 只要求「有 session」，未限制本人、轄區或資料列；公開報價分享 URL 可被轉傳且未見到期/撤銷控制。建議補上一層資料範圍（row scope）與欄位投影（field projection），而不是只增加頁面權限。

## 分級定義

| 等級 | 定義 | 預設處理 |
|---|---|---|
| 公開 | 預期任何取得連結者皆可知，外洩不造成實質損害 | 可匿名讀；仍禁止包含內部註記、個資與成本。 |
| 內部 | 僅公司人員，單項外洩影響有限 | 登入 + 模組 view；不預設允許批量匯出。 |
| 機密 | 個資、客情、交易價格、跨業務績效等，外洩會影響客戶或商業利益 | 登入 + 模組權限 + 本人/轄區/職務 scope；匯出另授權並稽核。 |
| 嚴格機密 | 憑證、密碼雜湊、完整權限、成本毛利、完整稽核 payload | 最小角色白名單；API 最小欄位；禁止一般匯出；所有讀寫留痕。 |

## 角色基線

| 角色 | 建議資料範圍 |
|---|---|
| 外部客戶 | 僅本人收到且仍有效的報價分享；不得看到內部備註、成本、其他客戶或業務排行。 |
| 業務本人 | 自己負責/建立/被指派客戶與相關拜訪、報價、訂單；公司公共產品資料。 |
| 業務經理 | 所屬團隊/轄區；可看團隊彙總及必要明細，但成本毛利、帳號與完整稽核仍不開放。 |
| 行政 | 訂單、報價簽核與活動行政所需全公司資料；不因「行政」自動取得帳號密碼、token 或完整稽核 payload。 |
| 中央管理 | 主檔、產品與跨區調度；可看全公司必要營運資料，敏感匯出仍需明確權限。 |
| 總經理/admin | 全公司策略指標與高風險治理；嚴格機密讀取仍應留痕、遮罩 secret，不能因 admin 回傳 secret。 |

> 現況程式只有 `role=admin`、`accountType` 與模組權限；「業務經理」沒有獨立可見的程式角色，應視為待新增的資料範圍概念，不得假裝已實作。證據：`lib/api-auth.ts:28-42`、`lib/notion/permissions-model.ts:10-57`。

## 資料分級矩陣

| 資料類型 | 等級 | 可看角色 | 遮罩/匯出/API/稽核要求 | 現況證據 |
|---|---|---|---|---|
| 公司/產品公開介紹、已核准公開素材 | 公開 | 全部含外部客戶 | 僅發布版；不得混入進價、停用狀態、Notion 管理欄位 | 產品對登入者提供價格與內容：`app/api/products/sku/[skuCode]/route.ts:21-48`。真正匿名公開範圍目前未獨立定義。 |
| 客戶名稱、類型、城市/區域 | 內部；與聯絡資料合併時升機密 | 業務本人、其經理、行政、中央管理、總經理/admin | 搜尋結果最小投影；業務僅本人/轄區；防批量列舉 | 客戶搜尋包含 address 與 salesperson：`lib/notion/customers.ts:108-161`。 |
| 客戶地址、電話、統編 | 機密 | 業務本人、其經理、業務所需行政/中央管理、總經理/admin；外部僅本人報價所載必要欄位 | UI 預設遮部分電話/統編；匯出需 `export_customer_pii`；API row scope；下載與大量查詢稽核 | 欄位來源：`lib/notion/customers.ts:63-100`；區域 CSV 含地址電話與機構代碼：`components/RegionStatsContent.tsx:906-931`。 |
| 拜訪內容、客戶反應、追蹤事項、競品 | 機密 | 業務本人、其經理；行政/中央管理僅業務必要；總經理/admin | 本人/團隊 row scope；列表先摘要；全文讀取與匯出留痕；不可送 AI 前未告知 | `lib/notion/visits.ts:13-25,172-179`；目前 GET 只需 session 且可指定任意 salesperson：`app/api/visits/route.ts:7-16`。 |
| 客戶 360（設備、工單、拜訪、報價、訂單聯集） | 機密 | 業務本人、其經理、職務必要行政/中央管理、總經理/admin | 單一客戶授權後再分欄位投影；不得因知道 ID 取得全聯集 | API 僅 session，並一次回全部關聯：`app/api/customers/[id]/route.ts:7-20`。 |
| 售價、折扣、促銷規則、報價/訂單品項 | 機密 | 業務本人、其經理、行政、中央管理、總經理/admin；外部僅該份有效報價價格 | API 依角色移除內部價源/規則細節；報價分享僅顯示對客價；禁止全庫匯出 | SKU API 回 `price/basePrice/priceSource`：`app/api/products/sku/[skuCode]/route.ts:41-48`；訂單含品項與總額：`lib/orders-notion.ts:160-183,235-270`。 |
| 辦課成本、淨利、毛利率 | 嚴格機密 | 中央管理、總經理/admin；行政僅被授權者 | 獨立 `finance_margin` 權限；一般 API 不回成本欄；讀取與匯出皆稽核 | 型別直接含 totalCost/netProfit/marginPct：`lib/notion/course-costs.ts:9-26,52-59`；GET 現況僅要求 session：`app/api/course-costs/route.ts:9-11`。 |
| 全公司業績、業務排行、個人訂單金額 | 機密 | 本人看本人；經理看團隊；行政僅作業需要；中央管理、總經理/admin看全公司 | 預設彙總；排行明細需 `performance_team/all`；禁止一般 CSV；查看排行留痕 | 排名按 amount/visits 排序：`lib/ceo-stats.ts:284-314,383-401`；CEO API 對行政、中央管理、總經理開放：`app/api/dashboard/ceo/route.ts:7-18`。 |
| 活動/追蹤名單及成員聯絡資料 | 機密 | 名單負責業務、其經理、活動行政、中央管理、總經理/admin | 名單 row scope；匯出另授權、加時間/操作者浮水印或標頭、留稽核 | CSV 含姓名、業務、地址、電話、成交單號：`components/CampaignsContent.tsx:283-287,326`。 |
| 帳號清單、角色、模組權限 | 嚴格機密 | 中央管理中被授權者、總經理/admin | 僅 accounts admin；回應不得含 password；所有建立/改權限/刪除強制稽核 | accounts/admin 預設拒絕：`lib/notion/permissions-model.ts:55-64`；帳號 API 限 admin：`app/api/accounts/route.ts:6-11`、`app/api/accounts/[id]/route.ts:6-40`。 |
| 密碼/密碼雜湊 | 嚴格機密 | 無一般人員可讀；認證服務內部比對 | 永不經 API/UI/稽核回傳；bcrypt；立即盤點並完成舊明文清除 | bcrypt 與舊值遷移：`lib/notion/accounts.ts:90-123,145,199`。遷移 update 失敗會被 catch，但函式仍回 `password: storedPw`，因此可能在認證內部繼續傳遞舊明文，不能視為遷移已完成。 |
| Token、API key、cookie、cron/webhook secret | 嚴格機密 | 執行環境/secret manager；任何角色 UI 都不可看原值 | 禁止寫 Notion/日誌/稽核；輪替；不同用途分 secret；錯誤訊息不含值 | env secret：`lib/auth.ts:144`、`lib/notion/shared.ts:21-24`；audit 會依 password/token/secret key 遮罩：`lib/audit.ts:122`。 |
| 稽核紀錄（actor、IP/UA、before/after、metadata） | 嚴格機密 | 總經理/admin；必要時中央管理的受限檢視 | payload 深層遮罩；禁止一般匯出；查閱稽核本身也記錄；保留期與不可竄改策略 | 寫入 actor/role/request/before/after：`lib/audit.ts:259-308`；列表限 admin：`app/api/audit-logs/route.ts:8-18`。 |
| 公開報價分享與 PDF | 對客公開（持有者）+ 內含機密 | 該外部客戶、內部授權角色 | 使用高熵、可撤銷、到期的 share token；PDF 同 token；移除內部 note/approvalNote；存取 rate limit/稽核；`Cache-Control: private/no-store` | 分享頁匿名取 quote，未做核准 gate，顯示電話、地址、統編、業務、品項/報價 note，且會顯示 approvalNote：`app/share/[id]/page.tsx:13-14,70-75,109-166`；PDF 雖無 session，但會拒絕未核准報價：`app/api/quotes/[id]/pdf/route.tsx:12-23`。 |
| AI 輸入/輸出（拜訪文字、反應、標籤） | 機密 | 觸發該紀錄的授權使用者；內部 AI proxy | 送出前去識別/最小化；禁止電話/地址/統編；記模型/目的/操作者但不記全文；供應商 retention 設定需確認 | 拜訪 content 直接拼 prompt 並送 Anthropic：`app/api/ai/suggest-fields/route.ts:34-70`、`app/api/ai/suggest-reaction/route.ts:27-52`。 |
| CSV/文件匯出 | 依內容繼承，通常機密 | 另有 export 權限的角色 | 不等同 view；服務端產出或一次性下載 token；限制筆數；加操作者/時間；完整稽核 | 區域客戶與 Campaign CSV 都在瀏覽器直接產生：`components/RegionStatsContent.tsx:926-931`、`components/CampaignsContent.tsx:283-287`，伺服器無法可靠記錄下載。 |

## 現有控制的正向證據

1. 統一 API 閘道支援 session/admin/central-management/roles/module view-edit（`lib/api-auth.ts:28-57`）。
2. accounts/admin 模組欄位缺失時預設拒絕，避免默認提權（`lib/notion/permissions-model.ts:55-64`）。
3. 帳號密碼採 bcrypt，且舊明文登入時遷移（`lib/notion/accounts.ts:90-123,145`）。
4. 稽核 sanitizer 會遮罩 key 名含 password/token/secret 的值（`lib/audit.ts:118-123`）。
5. LINE/cron 使用專用簽章或 secret；公開 API 並非完全失效開放（`app/api/line/webhook/route.ts:61-78`；`app/api/cron/refresh-visit-suggestions/route.ts:21-25`）。

## 優先風險與修正順序

### P0 — 立即納入改造門檻

1. **公開分享可轉傳且分享頁無核准 gate**：改成獨立高熵 share token（hash 儲存）、到期/撤銷、下載與查看稽核；分享頁必須和 PDF 共用「已核准且 token 有效」判斷，且不得匿名顯示 approvalNote/內部 note。保留舊 URL 時用舊 ID 查 token 狀態，不得永久直接放行。
2. **成本/毛利 GET 只要登入**：`/api/course-costs` 改用嚴格財務權限；回傳依欄位投影，非財務角色只看活動名稱/狀態，不回成本、淨利、毛利率。
3. **全域 session-only 讀取**：客戶 360（`app/api/customers/[id]/route.ts:7-20`）、orders（`app/api/orders/route.ts:5-8`）、quotes（`app/api/quotes/route.ts:7-13`）、visits（`app/api/visits/route.ts:7-16`）、by-area（`app/api/customers/by-area/route.ts:11-22`）需加入本人/團隊/全公司 row scope；禁止信任 client 傳 salesperson 來決定可見範圍。
4. **舊明文密碼遷移可能失敗後持續在認證內部傳遞**：盤點 Notion 密碼欄、強制完成 bcrypt 遷移並 read-back；遷移失敗時登入應失效關閉或明確告警，不得吞錯後繼續回傳 `storedPw`。

### P1 — 上線前完成

5. **CSV 匯出繞過伺服器稽核**：把客戶與 Campaign 匯出改為受控 API；view 與 export 分權；記操作者、filter、筆數與目的。
6. **AI 直接傳拜訪全文**：加入 PII 去識別器、字數/欄位 allowlist、使用告知與供應商資料保留確認；AI route 改用 module+row scope，不只 session。
7. **業績排行範圍過寬**：行政不應因職稱自動看跨業務金額排行；拆本人、團隊、全公司權限並預設只回彙總。

### P2 — 治理補強

8. 稽核已遮罩 password/token/secret/authorization/cookie/session/apiKey/credential（`lib/audit.ts:118-125`）；下一步改採可記錄欄位 allowlist，處理未知敏感鍵與非標準 header 名稱，而非重複增加既有關鍵字。
9. 對大量搜尋、公開分享/PDF、匯出加 rate limit、存取告警、保留期與資料刪除流程。
10. 建立「業務經理/團隊/轄區」權威關係；目前 accountType/module permission 無法表達誰能看哪群資料。

## API 最小揭露基準

- 列表 API：只回列表所需欄位；電話預設遮罩、地址到行政區；明細另請求並驗 row scope。
- 搜尋 API：限制 `limit`、最短 query、速率；不回統編、完整電話、完整地址，除非已選定且有權。
- 訂單/報價：業務只讀本人；經理讀團隊；行政讀作業必要；價格 API 不回內部價源欄位給一般 view。
- 財務：成本/淨利/毛利使用獨立 DTO 與權限，絕不沿用活動一般 DTO。
- 公開分享：token scope 綁單一 quote、用途與有效期；禁 index；no-store；撤銷後 PDF 同步失效。
- 匯出：服務端重新授權與查詢，不接受前端把已載資料直接打包作為唯一控制。

## 未確認事項

- Anthropic 帳號層資料保留/訓練設定、DPA 與地區未從 repo 得知：未確認。
- 外部分享連結是否已大量寄出、是否有到期/撤銷的 Notion 欄位：未確認。
- 實際組織中的業務經理名單、團隊與轄區權威來源：未確認。
- Vercel/Redis 是否已有全域 rate limit 或 WAF 規則：未確認。
