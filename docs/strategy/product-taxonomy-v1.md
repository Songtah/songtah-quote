# 產品分類 Taxonomy v1

> 狀態：2026-07-14 經使用者確認開始全品項分類。
> 適用範圍：`public/products_catalog.json`、`public/product_families.json`、產品管理頁、訂貨／報價選品與未來官方網站。
> 原則：先以 additive sidecar 建立新分類，不直接覆寫既有 catalog 欄位；完成雙讀與驗收後才討論切換。
> **2026-07-14 更新:使用者確認總表後指示直接切換**——`scripts/migrate-taxonomy.py` 已將 category/mainCategory/productType 換為新體系值(additive 加上 mainCategoryId/categoryId/seriesName/needsReview),字典落在 `data/product-taxonomy.json`,validator 改字典驅動。第一節「不可變」條款全數遵守(skuCode/價格/停售/families/既成單據快照未動,81 筆標 needsReview)。

## 一、不可變的識別與歷史資料

- `skuCode` 等於既有 `code`，永久不重編。
- `ProductFamily.id`、`seriesCode`、`skuMap` 與已保存的 `seriesId` 不因分類名稱重建。
- `price`、`discontinued`、`status` 不由 taxonomy 產生器修改。
- 既成訂單、報價與促銷中的品名、品牌、系列名稱及價格維持成立時快照，不批次回寫。
- 無法判別的品項標記 `reviewRequired`；可查品牌官方網站、型錄或原廠文件，查不到仍維持待確認，不猜測。

## 二、唯一主瀏覽樹

`businessCategory → functionCategory → seriesId → skuCode / variantSpecs`

品牌、產品型態、生命週期、相容設備、材質、色號與尺寸是獨立 facet，不是主樹父節點。

### Business categories

| ID | 顯示名稱 |
|---|---|
| `digital-manufacturing` | CAD/CAM 數位製造 |
| `additive-manufacturing` | 3D 列印 |
| `fixed-restorative` | 固定式修復材料 |
| `removable-prosthetics` | 活動義齒與人工牙 |
| `color-characterization` | 比色、染色與表面處理 |
| `lab-production` | 技工製程與耗材 |
| `lab-equipment` | 技工設備與基礎設施 |
| `clinical-tools` | 臨床／技工器械與輔助工具 |
| `software-digital-service` | 軟體與數位服務 |
| `technical-service` | 技術服務 |
| `other-review` | 待人工確認 |

### Product kinds

| ID | 判斷原則 |
|---|---|
| `equipment` | 完整、可安裝且可進設備履歷的機台 |
| `material` | 會成為修復體、模型或列印成品的一部分 |
| `consumable` | 製程使用後耗減、需補充但不成為最終成品 |
| `durable_tool` | 可重複使用、通常不作資產管理的工具／器械 |
| `accessory` | 擴充設備或系統功能的非核心組件 |
| `spare_part` | 為恢復設備功能而更換的料件 |
| `software_license` | 軟體、模組、授權或訂閱 |
| `service` | 安裝、保養、維修工時、校正或教育服務 |
| `other_review` | 尚無足夠依據，等待人工確認 |

「藥液」不是 product kind：染色／釉面液通常是材料；清潔、分離或維護藥劑通常是耗材。「套裝組」以 `isBundle` facet 表示，不另成 product kind。

## 三、官方網站的 3D 列印分類

`3D 列印` 是可公開的集合頁，下分：

1. `3d-printer`：3D 列印機。
2. `print-resin`：3D 列印材料／樹脂。
3. `post-processing`：清洗與後固化設備。
4. `printer-accessory`：平台、kit、holder 等可重複使用配件。
5. `printing-consumable`：有使用壽命的料槽、膜、濾材與製程耗材。
6. `printer-spare-part`：燈管、螢幕、感測器、線材與維修料件。
7. `printing-software-service`：軟體、安裝、教育與技術服務。

原廠依據：

- ASIGA MAX 官方規格將 3D printer、Composer software、Asiga material、build tray 與 Flash post-curing chamber 列為不同內容：[ASIGA MAX specification](https://www.asiga.com/downloads/printers/Asiga-MAX-usen-web.pdf)。
- ASIGA 官方說明 build tray 承裝樹脂且有可計量壽命，達上限必須更換：[MAX build tray life](https://support.asiga.com/maintaining-the-build-tray-max/)。
- ASIGA 官方將 build platform、build tray、position encoders 等分為機體組件：[MAX product breakdown](https://support.asiga.com/product-breakdown-max/)。
- DETAX 官方文件將 FREEPRINT MODEL 2.0 定義為 DLP 牙科模型用光固化樹脂：[DETAX Freeprint Model 2.0](https://www.detax.de/de-wAssets/docs/dental/IFU-dental/IFU_3D-Kunststoffe/IFU_Freeprint_dental_model-2.0.pdf)。
- DETAX medicalprint shell 官方頁明確定義為 385nm 3D 列印樹脂：[medicalprint shell](https://www.detax.de/en/shop/produkte/medicalprint-shell.php)。
- DENKEN 的 `DH Print Tray` 名稱雖含 Tray，原廠定義是 3D 列印用印模托盤樹脂，因此歸材料而非配件：[DENKEN DH Print Tray](https://denken-highdental.co.jp/3d/dh-print-tray/)。
- GC `OPTIGLAZE Color Set` 是光固化染色／上釉材料，不是 3D 後固化設備：[GC OPTIGLAZE Color](https://www.gc.dental/america/products/laboratory/indirect-composites/optiglaze-color)。
- MEDIFIVE 原廠產品說明將 Twin Tornado、Twin Cure 與 Printing Resin 分別定義為列印件洗淨機、後固化機與列印樹脂：[MEDIFIVE product overview](https://medifive.gobizkorea.com/mini/site/miniSiteMain.do)。
- Song Young `DIE LOCK TRAY` 是技工模型托盤，不是 3D 列印機料槽：[Song Young product page](https://songyoung.com.tw/product_detail.php?productID=230)。

分類器不得只憑 `print`、`tray`、`固化` 等單一關鍵字判定 3D 類別；舊分類與名稱衝突時，優先採 SKU 級原廠證據，否則維持待覆核。

### 品牌正規化與 SUN Panther 系列

- `MT-*` 的 32 筆產品原標為內部代稱 `DENTAL ESPAN`；原廠 SKU、品名與官方資料均指向西班牙 `MESTRA`（Talleres Mestraitua, S.L.），品牌正規化為 `MESTRA`，但不越權修改 ERP 擁有的貨號與品名：[MESTRA 官方網站](https://mestra.es/en/)。
- SUN Oberflächentechnik 的 51 筆 Panther 產品都是牙科技工用旋轉研磨／拋光耗材，主分類統一為 `lab-production`、商品型態為 `consumable`。
- 依 SUN 官方產品索引的器械類型分群：`Panther Stone`（PSC）歸 `grinding-tool`；`Panther Green`（PGS）、Panther ceramic（TCP）及 Panther polymer（XPL）歸 `polishing-consumable`。Green 雖用於預燒結氧化鋯修整，原廠仍明列為 `Polierer`，因此不以加工動作自行改稱研磨工具：[SUN Panther 系列](https://www.sun-dental.de/produkte/panther-serie)、[SUN Panther 產品索引](https://www.sun-dental.de/artikelgruppe/panther)。
- 目前 ERP 貨號 `SUN-PSCSET104/05` 與原廠索引的 `PSCSET105/05` 不一致；不越權修改 ERP 貨號，先依 Panther Stone 系列歸 `grinding-tool`，同時保留 `official_sku_code_mismatch` 待覆核標記。
- SUN 商品名稱只要含 `Kit`，即標記 `facets.packageForm=kit`（中文顯示「套裝組」）；套裝標記不取代原本的研磨／拋光功能分類與 `consumable` 商品型態。
- SUN 規則使用 51 個精確 SKU allowlist；新增 SUN SKU 若未列入規則，分類器必須失敗並要求重新查證，不可用品牌或名稱概括套用。

## 四、系列歸屬規則

- 只接受 `skuMap` 或 `coveredSkuCodes` 的精確唯一命中。
- 同一 SKU 精確命中多個 family 時標記 `conflict`，不得自行選第一筆。
- 不使用 `startsWith(seriesCode)` 批次回填；現有 prefix 會產生多重命中及大量未命中。
- 沒有自然系列的單品允許 `seriesId=null`，不製造「其他系列」。
- 名稱自動歸組只處理高信心規格軸：`brand`、`productType`、`mainCategoryId`、`categoryId` 皆相同，名稱只差可辨識的色號、容量、包裝數或尺寸尾碼，且 SKU 具共同結構。
- 同名異貨號、設備世代、`Kit` / `Set`、牙位方向、車針／鑽針不透明代碼及任意字碼不自動歸組；維持獨立或進入人工覆核。
- 自動建立的 family 使用一維「規格／型號」與精確 `skuMap`，確保產品頁與訂貨選品器都能選擇具體 SKU。
- 依業務規則，現有 `AB-*` 貨號統一歸入 `AB`（系列名稱「金屬材料」）；只收錄當次確認存在的精確 SKU，不使用執行期前綴自動納入未來新品。
- 依業務規則，現有 `AG-*`（ASIGA）依 `categoryId` 拆成 3D 列印機、後固化設備、3D 列印樹脂、列印料槽／耗材、列印機配件及維修料件 6 個 family；同樣只收錄已確認的精確 SKU，不把設備、材料與零件混成單一規格軸。

## 五、分類信心與人工覆核

| 狀態 | 意義 |
|---|---|
| `approved_rule` | 已由明確 category／SKU／官方系列規則判定 |
| `needs_review` | 有候選值，但語意混用、規則衝突或需官方資料確認 |
| `unresolved` | 無足夠依據，只保留舊值與待確認標記 |

優先覆核：完整設備、3D 樹脂、配件、維修料件、軟體、服務、空品牌、舊分類「其他」，以及系列衝突。

## 六、安全遷移順序

1. 產生 `data/product_taxonomy_dictionary.json` 與 `data/product_taxonomy_map.json`，不改 catalog。
2. dry-run 必須列總數、所有分布、未命中／衝突數與前 20 筆樣本。
3. API 先 additive 回傳新 taxonomy，舊 `brand/productType/mainCategory/category` 查詢維持相容。
4. 產品管理頁同時顯示舊分類、新分類與覆核狀態。
5. 報價與訂貨統一產品來源；Campaign 改用 canonical key 比對後，才切換新分類。
6. catalog 與 families 如需改顯示標籤，必須同一 commit 原子更新。
7. 切換前後逐筆確認 SKU、價格、停售狀態、family ID、訂單／報價快照與促銷命中不變。

## 七、系列內容頁資料契約

- 搜尋結果先依 `skuMap`／`coveredSkuCodes` 將同系列 SKU 收合；衝突 SKU 與未歸屬 SKU 維持獨立顯示，不以貨號前綴猜測。
- 系列層內容沿用「產品系列資料庫」：系列名稱、品牌、整體介紹、主圖、技術參數與適用範圍。
- 規格層內容沿用既有 SKU 商品資料：商品照片與圖庫、目錄售價、技術規格表、商品介紹及技術文件。
- 使用者在同一系列頁選規格後，就地切換 SKU 資源區，不另開第二層詳情視窗。
- 清單層直接顯示系列簡介、價格區間、貨號、品名與各 SKU 售價；獨立單品在原列展開介紹，不再使用單一 SKU 詳情 Modal。
- 系列內容頁只承接需要深讀的照片、完整技術規格與技術文件，避免手機使用者為確認貨號或價格多跳一層。
- 售價優先讀 `products_catalog.json`；未定價顯示「待定價」，既成報價與訂單仍以單據價格快照為準。
- 手機採底部全寬內容頁、至少 44px 觸控目標、橫向規格選項與固定主要動作；平板以上再展開為多欄版面。
- 未經 schema dry-run 與明確核准，不在系列資料庫新增文件或圖庫欄位；目前文件與多圖先由選定 SKU 的既有欄位提供。
