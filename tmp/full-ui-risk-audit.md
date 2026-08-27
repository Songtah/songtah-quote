# 全站 UI 改版唯讀風險盤點

日期：2026-07-20  
範圍：`AppShell`、全域 CSS、共用按鈕／表單／卡片、手機導覽及全站頁面入口。未修改程式碼。

## 結論

最安全的做法不是將舊 Tailwind class 全域搜尋取代，而是先把 `AppShell` 與既有語意 token 做成穩定骨架，再按「列表 → 詳情 → 建立／編輯表單 → 管理頁 → 公開頁」分批改造。`AppShell` 已覆蓋 25 個頁面入口，是效益最大的集中改造點；但首頁使用獨立 `SalesTodayDashboard`，登入與公開報價也不走 `AppShell`，必須分開驗收。

## 集中改造順序

1. **先鎖定共用 token，不動行為。** `globals.css` 已有 `.button-primary`、`.button-secondary`、`.input`、`.panel`、`.card-soft`、`.input-soft`、`.select-soft`，可先統一白底、柔深度、焦點與 44px 觸控高度，再由頁面逐一採用；證據：`app/globals.css:142-227`。
2. **改造 AppShell 導覽骨架。** 25 個頁面共用同一 header/main，集中處理桌機側欄、手機頂欄／底部常用導覽、內容寬度與頁名即可覆蓋大部分頁面；證據：`components/AppShell.tsx:90-207`。導覽資料與權限過濾必須原封保留在同一來源；證據：`components/AppShell.tsx:53-88,125-139`。
3. **列表型頁面優先。** 客戶、報價、訂貨、工單等最符合業務日常；先將搜尋、篩選、主要 CTA、空狀態與手機卡片模式標準化，再動詳情頁。既有訂單桌機表格已有手機分支，不應硬套單一表格樣式；證據：`components/OrdersContent.tsx:194-289`。
4. **詳情頁其次。** 保留原資料請求與按鈕權限，只改資訊層級、敏感欄位分組和底部主要動作。工單詳情目前是 client fetch，UI 改版不能把載入錯誤重新變成 runtime overlay；證據：`app/tickets/[id]/page.tsx:86-111`。
5. **建立／編輯表單獨立批次。** `OrderForm` 2,209 行、`QuoteForm` 791 行，含價格、促銷、贈品、狀態與 sticky actions，不能機械換 class；證據：`components/OrderForm.tsx:1758-1965`。每一表單要測合法單據不誤擋及非法輸入確實被擋。
6. **管理與特殊工具最後。** 帳號權限矩陣、稽核表、行程時間軸、商品規格橫向矩陣各有專屬互動；證據：`components/AccountsContent.tsx:61-85`、`components/TripPlannerContent.tsx:652-673`、`components/product-series/SeriesSkuDetails.tsx:247-248`。
7. **登入與公開報價單獨驗收。** 兩者不走 AppShell；公開報價網址須保持、且只能呈現已核准內容；證據：`app/share/[id]/page.tsx:19-37`。

## 不可直接全域替換

- **不可把所有 `gray-*` 直接換成 `stone-*`。** 掃描到 1,419 個 gray/blue 類別命中，當中包含狀態色、disabled、骨架、圖片底色和破壞性確認；例如工單狀態用藍／紅／綠承載語意：`app/tickets/[id]/page.tsx:17-31`。只能替換中性色，不動狀態色。
- **不可把所有 `border` 換成 `.card-soft`。** 表格分隔線、input focus、dropzone、checkbox、時間軸與 modal 邊界不是卡片；例如上傳 dropzone：`components/AssetLibraryContent.tsx:265-375`。
- **不可把所有 `rounded*` 換成 `rounded-full`。** pills/buttons 適合 full，但面板、圖片、表格容器須維持 2xl/3xl；token 已區分：`app/globals.css:143-160,174-227`。
- **不可將所有 `<table>` 改成卡片。** 報價品項、成本試算、稽核與權限矩陣需要欄位對照；先保留桌機表格、手機才提供摘要卡或橫向捲動。例：`components/AuditLogsContent.tsx:167-199`、`components/CourseCostsContent.tsx:151-152`。
- **不可只靠隱藏導覽做授權。** AppShell 隱藏項目只是 UX；直接網址與 API 仍須 server auth。`tickets/new` 目前只查登入、`orders/[id]` 目前只 `requireSession`；證據：`app/tickets/new/page.tsx:9-18`、`app/orders/[id]/page.tsx:16-30`。改版不可誤稱已完成權限隔離。
- **不可讓 Magic UI 動畫包覆表單狀態或主流程。** 只用於視覺層／進場，避免 rerender、順序改變或延遲 CTA；AppShell 現有 pathname motion 已經是集中動畫入口：`components/AppShell.tsx:197-204`。

## 互動與手機風險

- 現行手機主導覽是頂部橫向捲動且隱藏 scrollbar，新手可能不知道仍有右側項目；證據：`components/AppShell.tsx:170-193`。建議手機底部只放 4 個常用入口＋「更多」，低頻管理收進抽屜。
- `FloatingFontSizeToggle` 固定右下，會與商品頁固定新增 CTA、表單 sticky footer 或未來 bottom nav 疊加；證據：`app/layout.tsx:26-29`、`components/FontSizeToggle.tsx:71`、`components/ProductsContent.tsx:806`、`components/OrderForm.tsx:1965`。
- 全域字級可放大到 137.5%，固定寬度與橫向導覽必須同時以 xlarge 測試；證據：`app/globals.css:24-26`。
- 表單觸控目標不能只繼承目前 `py-2`；`.btn` 與部分 select 未保證 44px 高；證據：`app/globals.css:143-156,223-227`。
- 行程、規格矩陣、商品 carousel 刻意依賴橫向捲動，改造時應保留手勢並增加可見提示，不能全域關閉 overflow；證據：`components/TripPlannerContent.tsx:654`、`components/product-series/SeriesSkuDetails.tsx:247-248`。

## 敏感資訊與權限風險

- 導覽權限集中於 `NAV_ITEMS` 是優點，但 `!permissions` 目前被視為可看所有模組，註解稱 env 帳號等同 admin；任何新的 session DTO 若漏傳 permissions 會擴大可見範圍；證據：`components/AppShell.tsx:77-88`。應在權限模型確認前避免重寫此邏輯。
- 帳號頁包含密碼輸入、角色與逐模組 view/edit 權限；改版不得在列表、toast、audit 或 query string 顯示密碼，也不能以漂亮的切換元件改變矩陣語意；證據：`components/AccountsContent.tsx:61-85,260,293-294`。
- 客戶列表可依業務篩選並顯示負責業務，屬公司內部資料；手機摘要卡不要額外展開電話、地址或其他個資，搜尋結果維持最小必要欄位；證據：`components/CustomersContent.tsx:246-268,403-405`。
- 公開報價頁為對外連結且目前以狀態阻擋未核准資料；改版不可加 AppShell、內部導覽、使用者資訊或內部簽核欄位；證據：`app/share/[id]/page.tsx:19-37`。
- 尚有「只登入即可直達」的頁面需在全站上架前逐一確認是否符合業務規則，例如行程規劃 `app/admin/trip-planner/page.tsx:7-17`。這是既有授權盤點項，不應在純 UI 改版中偷偷改行為。

## 上架閘門建議

每批頁面均須：桌機＋400px 手機＋xlarge 字級；鍵盤焦點；無權限角色直接網址；載入／空資料／fetch 失敗；主 CTA 與返回路徑；既有 URL；合法與非法寫入案例。全部頁面完成前保持本機／preview，不 commit 到部署分支；公開分享頁另做匿名瀏覽驗收。
