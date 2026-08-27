# 牙材產品 Taxonomy 第二意見（唯讀盤點與建議）

日期：2026-07-14  
範圍：`public/products_catalog.json`、`public/product_families.json`、產品搜尋、系列、促銷與訂單資料流。  
限制：本次沒有修改 catalog、Notion、schema 或程式；所有統計均由目前工作目錄的真實檔案產生。

## 一、決策摘要

不建議把「品牌 → 產品型態 → 業務大類 → 功能類 → 系列 → SKU」硬做成單一六層樹。品牌、產品型態、生命週期、適用設備與規格都是會橫跨業務分類的 facet；若塞進樹中，同一系列會被複製到多條路徑，促銷與報表會逐漸分裂。

建議的唯一主瀏覽樹是：

`業務大類 businessCategory → 功能類 functionCategory → 系列 seriesId → SKU skuCode / variantSpecs`

同時用 facet 篩選：

`品牌 brandId`、`產品型態 productKind`、`生命週期 lifecycleStatus`、`適用設備 compatibility`、`工作流程 workflow`、`材質 material`、`適應症/用途 indication`、`規格 variantSpecs`。

最重要的相容性原則：`skuCode` 與既有 `ProductFamily.id` 永久不重編、不從分類名稱重新生成；新增 taxonomy 只做加法，現有 `productType`、`mainCategory`、`category` 在完成映射與雙讀驗證前繼續保留。

## 二、真實資料現況

### 1. Catalog 結構與量體

`public/products_catalog.json` 目前是 6,084 筆 array、每筆 `code` 皆唯一。實際存在的欄位及非空筆數：

| 欄位 | 非空筆數 | 說明 |
|---|---:|---|
| `code` | 6,084 | SKU，6,084 個 distinct；不可重編 |
| `name` | 6,084 | 5,982 個 distinct，品名不能當 identity |
| `brand` | 6,073 | 11 筆空白；現況不是 `manufacturer` |
| `productType` | 6,084 | 8 值：材料 4,603、耗材 472、設備 345、藥液 230、配件 215、工具 164、其他 52、軟體 3 |
| `mainCategory` | 6,084 | 7 值：材料 4,263、耗材 691、輔助工具 387、設備 351、染液色料 323、其他 66、軟體 3 |
| `category` | 6,084 | 56 值；目前最接近功能類 |
| `price` | 2,759 | 其餘 3,325 筆沒有 price；缺價不能自動等同停售 |
| `discontinued` / `status` | 140 | 已停售 91、未販售 49 |
| `seriesId` / `spec` / `unit` | 0 | catalog 內目前沒有這三類可用值 |

代表性基本欄位可見 `public/products_catalog.json:3-9`。既有 TypeScript contract 也只正式宣告 code/name/brand/productType/category/mainCategory/price/spec/停售欄位，見 `lib/products-catalog.ts:14-26`。

### 2. 現有三個分類欄位不是穩定層級

`productType` 與 `mainCategory` 有大量交叉，不是父子關係。例如：

- 214 筆 `productType=配件` 卻是 `mainCategory=耗材`。
- 231 筆 `productType=材料` 卻是 `mainCategory=輔助工具`。
- 19 筆 `productType=設備` 卻是 `mainCategory=耗材`。
- 32 筆 `productType=工具` 卻是 `mainCategory=設備`。

實例：Asiga 光固化機本體是設備（`public/products_catalog.json:464-469`），燈管仍被標為設備（`:472-477`），Crown kit 則是配件但 mainCategory 為耗材（`:488-494`）。因此不能直接把三欄依序當成 taxonomy 層級。

軟體目前只有 3 筆，實例見 `public/products_catalog.json:7875-7888`；未來授權、訂閱、試用與服務期間需要獨立商業屬性，不能只靠「設計軟體」分類。

停售品仍保留原本材料與功能分類，另有 `discontinued/status`，見 `public/products_catalog.json:5473-5490`。這個方向是正確的：停售是生命週期，不是分類節點。

### 3. 系列資料獨立且不能靠 prefix 猜

`public/product_families.json` 有 42 個系列；系列具備穩定 `id`、seriesCode/name、品牌、分類、規格定義與部分 skuMap，contract 見 `lib/products-catalog.ts:34-48`。

真實匹配盤點：

- 用現有 `code.startsWith(seriesCode)`：1,427 SKU 唯一命中、906 SKU 同時命中多系列、3,751 SKU 不命中。
- skuMap 中能精確對到 catalog 的 SKU 為 1,794 筆，其中 13 個 SKU 被多個 family 收錄。
- 例如 `DSD-ENIGMA` 的 prefix 是 `DSD`（`public/product_families.json:877-883`），`DSD-ENIGMALIFE` 是更窄的 `DSD-L`（`:1154-1160`）；`DSD-L-*` 會同時符合兩者。

所以 `seriesId` 必須是顯式、可審核的 SKU→family mapping。不可把 `getFamilyByCode` 的第一個 prefix 命中結果直接批次寫回；現有函式本身就是 first-match，見 `lib/products-catalog.ts:127-130`。

### 4. 現有分類驗證可重用但不能直接升格 taxonomy 引擎

`scripts/validate_categories.py` 目前以品名 regex 找高信心 `category` 錯置，且已有「設備零件 → 設備配件」等規則（`:22-59`）；品牌以 SKU prefix 做已確認映射，未知 prefix 明確不猜（`:83-102`）。它適合作為候選產生器與 migration validator，但 regex 只能提出建議，不能無人審核決定 productKind、businessCategory 或 seriesId。

## 三、不可破壞的既有業務規則

1. `skuCode` 是促銷與訂單的精確 identity。非系列促銷先比 skuCode；只有 `series_discount`、`series_buy_n_get_m` 可使用 seriesId，見 `lib/order-pricing.ts:42-64`。
2. Promotion item 明確同時保存 `skuCode` 與 `seriesId`，系列層級時 skuCode 可空，見 `lib/promotion-items-notion.ts:91-103`、`:164-173`。
3. 訂單品項在成立時保存 skuCode、品名、品牌、系列名稱、數量與單價；寫入 Notion 的是這些快照值，見 `lib/orders-notion.ts:150-163`、`:291-310`。taxonomy 更新不得回寫既成單據。
4. 訂單從 catalog 選入時，非 family 路徑目前把 `category` 暫存成 `seriesName` 且 `seriesId=''`，見 `components/OrderForm.tsx:209-219`。新 taxonomy 不能把 category 改名後直接當 seriesId。
5. 已停售/未販售只在選品器隱藏，管理頁仍全顯示，見 `lib/products-catalog.ts:81-100`、`:103-118`；migration 必須保持此行為。

## 四、建議的 canonical taxonomy

### A. Identity 與顯示欄位（不是分類）

| 欄位 | 規則 |
|---|---|
| `skuCode` | 等於現有 `code`；immutable、唯一、所有訂單/促銷相容核心 |
| `displayName` | 等於現有 `name`；可改善但不能作關聯鍵 |
| `brandId` / `brandName` | 品牌是 facet；brandId 穩定，brandName 可改顯示名/別名 |
| `taxonomyVersion` | 如 `2026.1`，讓規則與 mapping 可回溯 |

### B. 唯一主樹

#### L1：`businessCategory` 業務大類

這一層服務營收、團隊責任與主導航；每 SKU 只選一個 primary 值：

1. `digital-manufacturing` 數位製造（CAD/CAM、掃描、車削、燒結相關）。
2. `additive-manufacturing` 3D 列印（印表機、樹脂、後處理）。
3. `fixed-restorative` 固定式修復材料（氧化鋯、玻璃陶瓷、金屬、瓷粉）。
4. `removable-prosthetics` 活動式修復（塑鋼牙、PMMA、義齒床材料）。
5. `color-characterization` 比色、染色與表面處理。
6. `lab-production` 技工製程與耗材（包埋、蠟、車針、研磨、拋光、鑄造）。
7. `lab-equipment` 技工設備與基礎設施（瓷爐、技工桌、吸塵、馬達等）。
8. `clinical-tools` 臨床/技工器械與輔助工具。
9. `software-digital-service` 軟體與數位服務。
10. `after-sales-service` 技術服務、保養、維修與料件。
11. `other-review` 尚待人工分類；不得長期用作垃圾桶。

若管理層希望更少 L1，可在報表層將上述值聚合；不應為了報表短小而犧牲商品查找與責任歸屬。

#### L2：`functionCategory` 功能類

沿用現有 56 個 category 作初始候選，再清理同義詞與錯置。功能類必須描述「這個東西做什麼」，例如：

- 3D列印機、列印樹脂、光固化、清洗、列印平台/槽、列印機維修料件。
- 掃描儀、車機、燒結爐、瓷爐、設計軟體。
- 氧化鋯塊、玻璃陶瓷、PMMA、塑鋼牙、金屬材料、瓷粉。
- 內染、外染、釉材、比色。
- 車針、研磨、拋光、包埋、石膏、蠟、鑄造。

`functionCategory` 是主樹節點；相同字詞不可同時出現「瓷粉」與「瓷粉 / 陶瓷」而沒有明確父子或 alias 規則。

#### L3：`seriesId` / `seriesName`

- 沿用既有 `ProductFamily.id`；不重新編號。
- 一個 SKU 最多一個 primary seriesId；促銷需要跨系列組合時應另建 promotion group，不複製 SKU identity。
- 沒有自然系列的單品可為 null，直接落到 L4，不製造「其他系列」。
- 系列的 business/function 分類由 series master 管理；SKU 可以有 exception，但需留下原因。

#### L4：SKU 與 `variantSpecs`

`variantSpecs` 使用 key/value，而不是把尺寸、顏色塞進 category：

```json
{
  "skuCode": "BS-STML-95H12-A2",
  "seriesId": "BS-STML",
  "variantSpecs": {
    "diameterMm": "95",
    "heightMm": "12",
    "shade": "A2"
  }
}
```

spec key 必須有共用字典（資料型別、單位、允許值、顯示順序），但不同 family 可選用不同 key。現有 family `specs`/`skuMap` 是良好起點，不應把所有產品強迫成一張超寬表。

### C. `productKind` 產品型態（單值 facet，不作主樹父節點）

建議 enum：

| 值 | 定義 | 現有初始映射 |
|---|---|---|
| `equipment` | 有序號/資產履歷的完整設備 | `productType=設備` 的完整機台，需排除零件 |
| `consumable` | 使用後耗減、需補充 | 材料、耗材、藥液；部分配件實為樹脂/濾材也應移入 |
| `durable_tool` | 可重複使用但不作資產管理的器械/工具 | 工具、比色板、瓷筆、咬合器等 |
| `accessory` | 擴充完整設備能力的非核心組件 | platform、tray、holder、kit 等；需記 compatibility |
| `spare_part` | 為恢復設備功能而更換的實體料件 | 燈管、馬達軸、開關、sensor、board 等 |
| `software_license` | 軟體授權、module、subscription、trial | 現有軟體 3 筆，另加 license model |
| `service` | 無庫存的安裝、保養、維修工時、校正、教育 | 目前 catalog 幾乎未結構化，新增時仍應給 SKU |
| `other_review` | 尚未確認 | 只作 migration queue |

「套裝/組合」不另成 productKind；用 `isBundle` 與 bundle components 表示，因為材料組與設備組本質不同。

### D. 必須是 facet、不能塞進主樹的欄位

- `brandId`：品牌橫跨材料、設備、軟體與料件。
- `productKind`：同一 3D列印業務大類同時含設備、耗材、配件與料件。
- `lifecycleStatus`：active / not_sold / discontinued / superseded；停售後仍屬原功能與系列。
- `priceStatus`：priced / pending / quote_only；缺 price 不代表停售。
- `compatibility`：適用 manufacturer、equipment family、model、generation；可多值。
- `workflow` / `indication`：產品可跨固定式、活動式或多個製程步驟；secondary uses 可多值，primary businessCategory 仍唯一。
- `material`、`shade`、`size`、`unit`、`packaging`：規格/搜尋 facet，不是分類層。
- `inventoryMode`：stocked / non_stock / virtual / service；與 productKind 相關但不可混為一欄。
- `salesChannel`、`customerSegment`、`regulatoryStatus`：商業/法規 facet，不應改變 SKU 在功能樹的位置。

## 五、特殊品項的處理

### 設備

只有完整、可安裝且可進設備履歷的主機標 `equipment`。需有 `assetTrackable=true`、serial/model family 與保固資訊。設備分類節點描述功能；品牌與機型另作 facet。

### 耗材

材料、樹脂、藥液、車針、濾材等以使用後耗減為準，不以品名是否有「材料」決定。需補 `unit/packSize`；價格與庫存單位分離。

### 配件

能擴充設備但不是維修所必須者為 `accessory`，必填 compatibility。ASIGA Crown kit（`public/products_catalog.json:488-494`）可作初始案例。

### 維修料件

能恢復故障設備功能者為 `spare_part`，例如燈管（`public/products_catalog.json:472-477`）。必填 compatibility、partNumber、是否序號管理/保固；不能繼續混在 `equipment`，否則設備銷售額與裝機數會失真。

### 軟體

`software_license` 另有 `licenseModel`（perpetual/subscription/trial/module）、term、seat、platform compatibility。試用版仍是同一 software family 的 SKU variant，不用另開功能分類。

### 服務

安裝、保養、維修工時、校正與教育訓練用 `service` SKU，使報價、訂單、營收與工單可一致關聯。服務可有 duration/SLA/coverage，但不能偽裝成庫存料件。

### 停售/未販售

沿用現有 `discontinued` 與細分 status 直到全系統完成雙讀；新增 canonical `lifecycleStatus` 只做映射。停售 SKU 不可刪除、不改 code、不移出 series，既成訂單與促銷歷史仍可解析。

## 六、無破壞遷移方案

### Phase 0：凍結 identity 與字典

1. 建立 taxonomy 字典（ID、中文顯示名、父節點、alias、owner、版本）。
2. 先輸出 SKU→taxonomy dry-run；列 6,084 筆、未命中、低信心與衝突前 20 筆。
3. 保存基線：所有 code、price、discontinued/status、family id、現有搜尋 filter 計數。

### Phase 1：sidecar mapping，現有行為不變

建議先新增獨立 `product_taxonomy_map.json`（key=skuCode），而非大批覆寫 catalog。內容只放新增欄位：businessCategoryId、functionCategoryId、productKind、seriesId、variantSpecs、facets、confidence、reviewStatus、taxonomyVersion。

映射順序：

1. `mainCategory` → businessCategory 候選，不直接視為完成。
2. `category` → functionCategory 候選；用現有 validator 規則找明顯錯置。
3. `productType` → productKind 初值：材料/耗材/藥液→consumable，工具→durable_tool，軟體→software_license，配件→accessory，設備→equipment；再用零件/耗材規則送人工覆核。
4. series 只接受 skuMap 精確唯一命中或經審核的 pattern；906 個 prefix 多重命中與 13 個 skuMap 重複必須進例外清單。
5. family specs 只對已確認 series 的 SKU materialize；不從品名自由文字猜尺寸後直接寫正式值。

API 先把 taxonomy 作 optional additive response；舊 productType/mainCategory/category filters 維持原結果，新篩選放 feature flag。

### Phase 2：雙讀與人工覆核

- 管理頁同時顯示舊分類與新 taxonomy，允許逐筆核准。
- 先覆核高風險群：345 筆設備、215 筆配件、52 筆其他、11 筆空品牌、所有軟體及新服務/料件。
- 每批核准後跑現有 `validate_categories.py`、新 schema validator、SKU/family uniqueness 與產品搜尋 smoke。

### Phase 3：切換瀏覽與報表，不切 identity

- 主導航改用 business/function tree，品牌/productKind/compatibility/lifecycle 用 facet。
- `skuCode`、促銷 `seriesId`、訂單 snapshot 寫法完全不變。
- 舊欄位至少保留一個完整發版週期；確認所有 consumer 已雙讀後才討論 deprecation，不自動刪除。

## 七、驗收門檻

1. 6,084 個 skuCode 逐一相同且仍唯一；不新增名稱關聯。
2. price、discontinued、status 在 migration 前後逐筆 diff 為零。
3. 所有既有 ProductFamily.id 不變；每 SKU 最多一個 primary seriesId，衝突清單必須為 0 才可正式切換。
4. 舊 `/api/products/search` 在相同參數下 SKU 集合不變；停售品仍不進選品器、管理頁仍可查。
5. 單品促銷只認原 skuCode；系列促銷只認原 seriesId；合法與非法促銷雙向 smoke 都通過。
6. 建立一張包含品名、品牌、系列名稱與單價的測試訂單；taxonomy 更新後 read-back 快照完全相同。
7. 設備/配件/料件抽樣至少覆蓋：完整機台、燈管/馬達、列印平台、樹脂/濾材、軟體授權、服務 SKU。
8. 所有無映射或低信心項目可被查詢且不從現有 UI 消失；未知值進 review queue，不自動歸「其他」。

## 八、主要取捨

- **主樹短、facet 多**：查找與報表比較穩定，但需要搜尋 UI 支援複合 facet；值得做，因牙材天然跨品牌、設備相容性與用途。
- **series 顯式映射**：初期人工成本較高，但能保護促銷與跨規格贈品；不能用 prefix 快速填滿來換取假正確。
- **sidecar 先行**：短期存在雙欄位與同步成本，但回滾簡單、可逐批驗證，不會一次改壞 6,084 SKU 的既有搜尋與訂單。
- **服務與料件拆開**：分類多一個維度，但能正確區分工時營收、實體零件庫存、設備履歷與保固成本。

驗收: 通過
