# 獨立單品名稱系列候選唯讀盤點

日期：2026-07-14  
資料來源：`public/products_catalog.json`、`public/product_families.json`、`lib/product-family-members.ts`  
本檔只做 dry-run 分析，未修改 catalog、family 或程式碼。

## 盤點基準

- 產品總數：6,084 SKU。
- 既有 family：42 組。
- 依 `skuMap`／`coveredSkuCodes` 精確唯一命中的既有系列品：2,358 SKU。
- 既有 family 衝突：0 SKU。
- 獨立單品：3,726 SKU，涵蓋 42 個品牌。
- 完全同名（NFKC、空白與大小寫正規化後）的初步候選：48 組／151 SKU。
- 只移除名稱尾端規格碼的保守候選：234 組／1,550 SKU。
- 加入「保留語意字、只抽掉 ASCII 規格碼」的名稱骨架候選：323 組／2,228 SKU。
- 廣義候選以外仍有 1,498 SKU；它們可能是真正單品，也可能需要品牌型錄或人工命名規則才能判定。

上述 323 組是「待驗證候選」而不是可無條件自動寫入的 323 組。若直接把所有數字都刪掉，會把產品世代、設備、料件與不同適用系統誤併。

## 建議分層施工

### A. 可保守自動建立的第一批

先採「尾端規格碼」規則，並只限規格型商品類別，例如瓷粉、氧化鋯塊、樹脂牙、車針、研磨耗材、染色液、PMMA、金屬材料與瓷筆。此條件得到 176 組／1,343 SKU。

每一組仍必須同時符合：

1. 品牌相同。
2. `productType`、`mainCategoryId`、`categoryId` 全部相同。
3. 去除的部分全部是尾端色號、尺寸、容量、數量或型號碼。
4. 保留後的名稱至少含一個穩定產品識別字，不得只剩「設備」「配件」「材料」等泛稱。
5. 每個 SKU 只命中一組，且不在既有 family 精確清單中。
6. 寫入仍使用完整 `coveredSkuCodes`，執行時不得改回 prefix 或名稱模糊比對。

### B. 可由 allowlist 擴充的第二批

名稱碼位於中間、後面仍有中文說明的系列，不能只用「砍尾碼」處理，但可逐組確認後加入 allowlist，例如：

- `SHT 95H14-A1` → `SHT`；共 123 SKU。
- `TTML 95H14-A2` → `TTML`；共 46 SKU。
- `MAX Build Tray 1L 料槽` → `MAX Build Tray 料槽`；4 SKU。
- `PRO Build Tray 2L 料槽` → `PRO Build Tray 料槽`；3 SKU。
- `Panther Stone Cy048 (灰)` → `Panther Stone`；15 SKU。

### C. 必須人工／官方資料覆核

設備、掃描元件、植體元件、設備配件與維修料件即使名稱近似，也不能只靠數字歸組。保守尾碼候選中，此類共有 56 組／116 SKU，建議全部標成 review，而非直接建立正式 family。

## 建議 normalization 規則

1. 僅在比對鍵使用 Unicode NFKC、大小寫折疊、連續空白合併及長短橫線統一；ERP 顯示名稱不得改寫。
2. 先依 `brand + productType + mainCategoryId + categoryId` 分區，再比名稱；任何 facet 不同就不自動合併。
3. 可視為規格的 ASCII token：`A1`、`DA3.5`、`95H14`、`98H20-A2`、`3.5/4.0`、`#10B`、`20g`、`50ml`、`104/060` 等。
4. 規格碼後的括號可保存為規格值，例如 `(灰)`、`(20g)`、`(White)`；不能把括號內資料丟棄。
5. 不得把含中文語意的混合 token 整顆刪除，例如 `專用液/200ml`、`爐心(無感溫棒)`、`底座SF43`；應先保留語意字再決定。
6. 裸數字若緊接第一個產品根名，預設是產品世代，必須保留：`Prettau 2`、`Prettau 3`、`Cure 2.5`、`Max 2` 不可互併。
7. Roman numeral 也先視為產品世代：`Vera Bond II`、`III`、`V` 不自動移除。
8. `Kit`、`Set`、`Storage Case`、`Spare Part`、`燈管`、`爐心`、`底座` 等是產品語意，不是規格碼，不得移除。
9. 價格、停售狀態、貨號前綴只供稽核，不能當 family 成員判斷的替代條件。
10. 新 family ID 應由已核准的穩定系列鍵產生並檢查碰撞；成員仍逐筆列入 `coveredSkuCodes`。

## 正例（名稱與貨號）

1. **Prettau 3**（144 SKU）：`ZZ-ZROC09110M1`「Prettau 3 98H14 0M1」、`ZZ-ZROC0911A01`「Prettau 3 98H14 A1」。必須保留世代 3。
2. **Prettau 2**（109 SKU）：`ZZ-999-ZRKC0911A01`「Prettau 2 98H14 A1」、`ZZ-999-ZRKC0921A02`「Prettau 2 98H18 A2」。必須與 Prettau 3 分開。
3. **SHT**（123 SKU）：`BS-SHT-95H12`「SHT 95H12」、`BS-SHT-95H12-A1`「SHT 95H12-A1」。尺寸與色號是規格。
4. **TTML**（46 SKU）：`BS-TTML-95H14-A2`「TTML 95H14-A2」、`BS-TTML-95H16-A1`「TTML 95H16-A1」。
5. **Prettau 4 Anterior**（44 SKU）：`ZZ-999-027-95H14`「Prettau 4 Anterior 95H14」、`ZZ-999-ZRFC0911A01`「Prettau 4 Anterior 98H14 A1」。
6. **ZEO Opaque Dentine**（37 SKU）：`YM-OA1-20`「ZEO Opaque Dentine OA1 (20g)」、`YM-OA2-50`「ZEO Opaque Dentine OA2 (50g)」。
7. **Initial MC Dentin**（28 SKU）：`GC-870052`「Initial MC Dentin DA2 20g」、`GC-870054`「Initial MC Dentin DA3.5 20g」。
8. **EFC-P 塑鋼臼齒**（24 SKU）：`YMH-T03-2`「EFC-P 塑鋼臼齒 A1-30」、`YMH-T04-1`「EFC-P 塑鋼臼齒 A2-28」。
9. **Matchmaker MC Enhancer**（19 SKU）：`DSD-EA1-50`「Matchmaker MC Enhancer A1/50g」、`DSD-EA3.5-15`「Matchmaker MC Enhancer A3.5/15g」。
10. **Prettau Aquarell**（19 SKU）：`ZZ-63-A1`「Prettau Aquarell A1 50ml」、`ZZ-63-A3.5`「Prettau Aquarell A3.5 50ml」。
11. **Panther Stone**（15 SKU）：`SUN-PSC132104F`「Panther Stone Cy048 (灰)」、`SUN-PSC151104F`「Panther Stone Wh120 (灰)」。
12. **Matchmaker Stain**（15 SKU）：`DSD-STAIN-01`「Matchmaker Stain 01 (White)」、`DSD-STAIN-10`「Matchmaker Stain 10 (Brown Olive)」。
13. **貂毛瓷筆**（5 SKU）：`SY-07150-0`「貂毛瓷筆 #0」、`SY-07150-3`「貂毛瓷筆 #3」。
14. **MAX Build Tray 料槽**（4 SKU）：`AG-02499`「MAX Build Tray 1L 料槽」、`AG-02502`「MAX Build Tray 10L 料槽」。
15. **PRO Build Tray 料槽**（3 SKU）：`AG-04569`「PRO Build Tray 2L 料槽」、`AG-04571`「PRO Build Tray 10L 料槽」。

## 高風險反例（不得依簡單去數字直接合併）

1. **產品世代**：`ZZ-999-ZRKC0911A01`「Prettau 2 98H14 A1」與 `ZZ-ZROC0911A01`「Prettau 3 98H14 A1」。若反覆刪除所有數字，兩者都會錯變成 `Prettau`。
2. **設備本體與料件**：`AG-00194`「Asiga Flash 光固化機」與 `AG-00194-1`「光固化機-燈管」。貨號前綴相同，但 productType／category 不同。
3. **料槽與收納盒**：`AG-02499`「MAX Build Tray 1L 料槽」與 `AG-04248`「MAX Build Tray Storage Case 料槽收納盒」。`Storage Case` 必須保留。
4. **材料與專用液**：`DSD-BA1-50`「Matchmaker BODY A1/50g」與 `DSD-01`「Matchmaker Body 專用液/200ml」。不能因都有 Matchmaker Body 就放同一規格 family。
5. **設備與爐心／中古機**：`DK-01`「KDF Accel-21電腦瓷爐」、`DK-01-04`「KDF 120程式瓷爐爐心(無感溫棒)」、`DK-05-01`「KDF 120程式瓷爐 (中古)」。只留下 KDF 會嚴重誤併。
6. **不同配件型態**：`DK-12-R5`「Neo Super Cascom 鐵圈R5(ψ43)」與 `DK-13-SF43`「Neo Super Cascom 底座SF43(ψ43)」。同設備生態不代表同規格系列。
7. **配方／世代差異**：`AB-02`「Vera Bond II 瓷牙金屬(不含鈹)」、`AB-03`「Vera Bond V 瓷牙金屬」、`AB-23`「Vera Bond III 鈷鉻金屬」。可否建立 Vera Bond 上位系列屬產品決策，不應自動判定。
8. **同詞出現在不同商品**：`ZZ-999-018-1L`「Sintermetall 1L (FR3011)」與 `ZZ-FR3016`「CAD/CAM Milling Bur 1 L Sintermetall (6MM)」。category facet 必須先隔離。
9. **設備不同型號**：`KM-A100`「Silence A100」、`KM-H100`「Silence H100」、`KM-K3-N`「Silence K3N 移動式吸塵器(無刷)」。A/H 是否同系列可覆核，K3N 不得只因 Silence 併入。
10. **相容系統可能藏在缺漏資料中**：`ZZ-ZBAD0132`「Set Scanmarker 3.5/4.0」與 `ZZ-ZBAD3732`「Set Scanmarker 3.5」。名稱沒寫植體系統，掃描／植體元件應以官方相容性資料覆核。

## 第一批 dry-run 候選摘要（前 20 組）

| 候選系列鍵 | SKU 數 | 代表貨號 | 判斷 |
|---|---:|---|---|
| Prettau 3 | 144 | ZZ-ZROC09110M1 | 可，保留世代 3 |
| SHT | 123 | BS-SHT-95H12 | 可，需中段碼 allowlist |
| Prettau 2 | 109 | ZZ-999-ZRKC0911A01 | 可，保留世代 2 |
| Antomic Coloured | 68 | ZZ-999-036-95H16-A1 | 可，疑似名稱拼字仍保留原文 |
| CARBIDE CUTTERS 鎢鋼 | 49 | SS-C250AQ/104040 | 可，完全同名群 |
| TTML | 46 | BS-TTML-95H14-A2 | 可，需中段碼 allowlist |
| 氧化鋯用磨石 | 45 | CA-YD-RDH011 | 可，型號與顏色為規格 |
| Prettau 4 Anterior | 44 | ZZ-999-027-95H14 | 可，保留世代 4 |
| 全鑽石針(小) | 40 | DUM-7701/035Y | 可，大小系列分開 |
| ZEO Dentine | 39 | YM-DB0-20 | 可，色號與容量為規格 |
| ZEO Opaque Dentine | 37 | YM-OA0-20 | 可 |
| Initial MC Dentin | 28 | GC-870052 | 可 |
| EFC-P 塑鋼臼齒 | 24 | YMH-T03-2 | 可 |
| Initial LiSi Press 瓷錠 | 21 | GC-010322 | 可，保留瓷錠語意 |
| FX 半塑鋼臼齒 | 21 | YMH-T29-1 | 可 |
| Matchmaker MC Enhancer | 19 | DSD-EA1-50 | 可 |
| Prettau Aquarell | 19 | ZZ-63-A1 | 可 |
| Prettau 4 Anterior Dispersive | 19 | ZZ-999-ZRFC0911A02 | 可，勿與非 Dispersive 合併 |
| Matchmaker Body | 18 | DSD-BA1-50 | 可，但排除 DSD-01 專用液 |
| ZEO Opaque膏 | 18 | YM-OPQ-A0 | 可 |

## 結論

使用名稱建立系列是可行的，但應視為「產生精確成員清單的離線輔助規則」，不能成為網站執行時的模糊歸屬邏輯。建議先施工 176 組／1,343 SKU 的保守第一批，再用逐組 allowlist 擴到名稱骨架候選；所有結果仍寫成精確 `coveredSkuCodes` 並跑衝突、缺漏、分類、價格與停售狀態不變驗證。
