# 產品 Taxonomy 原廠資料審查（DETAX／ASIGA／空品牌）

日期：2026-07-14  
範圍：只讀 `public/products_catalog.json`，並只採品牌官網、品牌官方支援中心與官方型錄。未修改 catalog/families/Notion。

## 方法與信心標準

先用 `brand + SKU prefix + 品名關鍵字` 聚類，再用原廠產品頁、原廠材料總覽、原廠支援文件確認「這組是機器、材料、後固化設備、配件或機內零件」。官方網站沒有公開內部 SKU 的項目，不把名稱推測冒充料號核對；會明列「料號未由官方確認」。

建議 taxonomy 值沿用現有三欄：`mainCategory / productType / category`。本文件是 dry-run 規則，不代表已核准寫入。

## 官方來源

### DETAX

- DETAX 官方 3D dental resin guide：<https://www.detax.com/fileadmin/Content/Dental/Documents/Other/3D_Guides_Dental/dx_3D-Guide_US_Letter_Format_250717.pdf>
- DETAX 官方 Freeprint crown 頁，並列 article number 02376、02378、02415、02417、02446、02845、02884：<https://www.detax.com/dental/product/dx-crown>
- DETAX 官方 Freeprint tryin 頁，article number 04427：<https://www.detax.com/dental/product/dx-tryin>
- DETAX 官方 dx shell 頁，article number 03016：<https://www.detax.com/audio/earmold-materials/product/detax-shell>
- DETAX 官方 Audio 2025 型錄，將 dx mould / dx shell 明確列為 3D Medicalprint material：<https://www.detax.com/fileadmin/Content/Audio/Documents/Other/dx_Audio_2025.pdf>

### ASIGA

- ASIGA 官方 printer 總覽，列出 MAX、PRO 4K、Max 2、Ultra：<https://www.asiga.com/3d-printers/>
- ASIGA 官方 Max 2：<https://www.asiga.com/max-2/>
- ASIGA 官方 Ultra：<https://www.asiga.com/ultra/>
- ASIGA 官方 PRO 4K：<https://www.asiga.com/pro-4k/>
- ASIGA 官方 dental materials，列出 DentaMODEL、DentaSTUDY、DentaFORM、DentaGUM、DentaCAST、DentaGUIDE、DentaTRY、DentaTRAY、DentaBASE、DentaTOOTH：<https://www.asiga.com/materials-dental/>
- ASIGA 官方 industrial materials，列出 PlasWHITE、PlasGRAY、PlasCLEAR、PlasPINK、FusionGRAY：<https://www.asiga.com/materials-industrial/>
- ASIGA 官方 build-tray types，說明 1L/2L/5L/10L、UltraGLOSS、Endurance 與相容機型：<https://support.asiga.com/build-tray-types/>
- ASIGA 官方 Ultra product breakdown，列出 hood、front panel、platform、build tray、touchscreen、sensor 等為機器部件：<https://support.asiga.com/product-breakdown-ultra/>
- ASIGA 官方 MAX product breakdown，列出 build platform、build tray、SPS position encoders 等為機器部件：<https://support.asiga.com/product-breakdown-max/>

## 規則 A：DETAX 全品牌 36 筆 → 3D 列印樹脂（高信心）

### 建議

- 條件：`brand === "DETAX"`（本次 catalog 恰為 36 筆；實際寫入前仍須以 SKU 清單鎖定，避免未來新增非樹脂品被誤套）。
- 目標：`mainCategory=材料`、`productType=材料`、`category=樹脂材料`。
- 理由：36 筆名稱皆為 Freeprint / Medicalprint / Luxaprint 或明示樹脂；官方 guide 與各產品頁將它們定義為 3D printing resin/material。現有多數錯放為 `設備 / 3D列印機`。
- 限制：官方可直接核到多個 article number；但不是 36 個內部 SKU 都逐一在同一官方頁出現。規則的產品類別信心高，逐料號來源覆蓋率不是 100%。

### 影響數與前 20 樣本

影響：36。

1. DT-02040 — Freeprint Denture Pink-trasp (1000g)
2. DT-02076 — Freeprint Splint 2.0 (1000g)
3. DT-02099 — Freeprint Model 2.0 Light Grey (1000g)
4. DT-02128 — Freeprint Model 2.0 Sand (1000g)
5. DT-02177 — Freeprint Model 2.0 Grey (1000g)
6. DT-02332 — Freeprint Model T (1000g)
7. DT-02376 — Freeprint Crown A1 (1000g)
8. DT-02378 — Freeprint Crown A2 (500g)
9. DT-02415 — Freeprint Crown A2 (1000g)
10. DT-02417 — Freeprint Crown A3 (500g)
11. DT-02446 — Freeprint Crown A3 (1000g)
12. DT-02505 — Freeprint Tray 2.0 (1000g)
13. DT-02632 — Freeprint Cast 2.0 (1000g)
14. DT-02843 — Freeprint Gingiva (1000g)
15. DT-02845 — Freeprint Crown BL (500g)
16. DT-02850 — Freep Model 2.0 Caramel (1000g)
17. DT-02884 — Freeprint Crown BL (1000g)
18. DT-03 — Detax Shell 樹脂料
19. DT-03016 — Medicalprint shell Beige 2.0 (1000g)
20. DT-03105 — Freeprint Model WW (1000g)

其餘 16：DT-03608、DT-03989、DT-04016、DT-04062、DT-04063、DT-04064、DT-04092、DT-04101、DT-04249、DT-04427、DT-04432、DT-04433、DT-04436、DT-04625、DT-04626、DT-09900-2。

## 規則 B1：ASIGA 完整列印機 6 筆（高信心）

- 條件：以下鎖定 SKU；不要用所有 `AG-*` 或含 MAX/Ultra 的寬鬆規則。
- 目標：`mainCategory=設備`、`productType=設備`、`category=3D列印機`。
- 官方依據：ASIGA printer 總覽及 Max 2 / Ultra / PRO 4K 官方產品頁。
- 影響：6（全列）。

1. AG-02391 — MAX UV 3D Printer
2. AG-04634 — PRO 4K80 UV 3D Printer
3. AG-07323 — Ultra 3D Printer
4. AG-07388 — Max 2 3D Printer
5. AG-07915 — Max 2 3D Printer
6. AG-07930 — Max 2 (50) 3D Printer

## 規則 B2：ASIGA 後固化設備 2 筆（高信心）

- 條件：鎖定以下 SKU。
- 目標：`mainCategory=設備`、`productType=設備`、`category=光固化機`（或業務核准的新名稱「後固化設備」）。
- 官方依據：ASIGA Ultra / Max 2 / PRO 4K bundle 均把 Asiga Flash 稱為 post-curing chamber，官方頁也把 Cure 定義為 finishing solution。
- 影響：2（全列）。

1. AG-00194 — Asiga Flash 光固化機
2. AG-07946 — Cure 2.5 光固化機

注意：AG-00194-1「光固化機-燈管」是替換零件，不得跟著 B2 歸為完整設備。

## 規則 B3：ASIGA 原廠樹脂 20 筆（高信心）

- 條件：SKU 鎖定；或品名以 `Plas / Fusion / Denta` 開頭且包裝／名稱明確為 resin material。未來新增品仍需原廠材料頁確認。
- 目標：`mainCategory=材料`、`productType=材料`、`category=樹脂材料`。
- 官方依據：ASIGA dental materials 與 industrial materials 兩個官方頁。
- 影響：20（全列）。

1. AG-00928 — PlasGRAY V2 1kg
2. AG-00929 — PlasPINK V2 1kg
3. AG-00930 — PlasCLEAR V2 1kg Bottle
4. AG-00931 — PlasWHITE V2 1kg Bottle
5. AG-01329 — FusionGRAY V2 1kg Bottle
6. AG-03000 — DentaModel
7. AG-03569 — Denta BASE N1 1kg Bottle
8. AG-03624 — Denta TOOTH A1 1kg Bottle
9. AG-03625 — Denta TOOTH A2 Bottle(1Kg)
10. AG-03626 — Denta TOOTH A3
11. AG-03653 — Denta GUM 1kg Bottle
12. AG-03768 — DentaTRY A1 1kg Bottle
13. AG-03810 — DentaTOOTH 1kg Bottle
14. AG-03817 — DentaTRY A2 1kg Bottle
15. AG-04504 — Denta GUIDE 1kg Bottle
16. AG-04748 — Denta Cast 1kg Bottle
17. AG-05167 — DentaFORM Grey
18. AG-05367 — Denta STUDY 1kg Bottle
19. AG-07862 — DentaTRAY Orange 1kg Bottle
20. AG-07876 — DentaFORM Beige 1kg Bottle

修正重點：AG-00929、AG-07862 現在被歸為配件，但官方材料頁證明它們是樹脂材料。

## 規則 B4：ASIGA 可更換配件／耗材 31 筆（高信心到中高信心）

- 條件：鎖定 SKU；主要包括 Build Tray、Build Platform、Storage Case、Crown Kit、Tool/Calibration Kit。
- 建議：沿用 `mainCategory=耗材`、`productType=配件`、`category=3D列印機配件`。若公司想區分耐用品與耗材，可另拆「列印機配件／列印耗材」，但那是業務 taxonomy 決策，不由原廠文件單獨決定。
- 官方依據：ASIGA build tray types、Max 2 Crown Kit、各 printer bundle/支援頁。
- 影響：31；前 20：

1. AG-0044 — Bundled 1L MAX Build Tary
2. AG-0077 — MAX 2 Crown kit
3. AG-02479 — MAX Build Platform 成型台
4. AG-02499 — MAX Build Tray 1L 料槽
5. AG-02500 — MAX Build Tray 2L 料槽
6. AG-02501 — MAX Build Tray 5L 料槽
7. AG-02502 — MAX Build Tray 10L 料槽
8. AG-04248 — MAX Build Tray Storage Case 料槽收納盒
9. AG-04569 — PRO Build Tray 2L 料槽
10. AG-04570 — PRO Build Tray 5L 料槽
11. AG-04571 — PRO Build Tray 10L 料槽
12. AG-05220 — MAX Law Force Build Tray 1L 料槽
13. AG-05226 — PRO 4K Tool kit 工具組
14. AG-05359 — MAX Tool kit 工具組
15. AG-05565 — PRO Build Tray Storage Case 料槽收納盒(大)
16. AG-05864 — MAX UltraGloss Build Tray 1L 料槽
17. AG-05868 — PRO UltraGloss 2L 料槽
18. AG-07063 — Ultra 成型平台
19. AG-07419 — Ultra Endurance Build Tray 2L 料槽
20. AG-07422 — Ultra UltraGLOSS 2L 料槽

其餘 11：AG-07440、AG-07570、AG-07647、AG-07650、AG-07741、AG-07788、AG-07789、AG-07950、AG-07951、AG-07956、AG-07957。

## 規則 B5：ASIGA 維修／替換零件 12 筆（類別高信心，逐原廠 SKU 中信心）

- 條件：只鎖定以下 SKU。
- 建議語意：`mainCategory=設備`、`productType=維修零件`、`category=3D列印機零件`。若現有 UI 不希望新增值，可暫留父類「配件」，另新增 `taxonomyStatus=待核准`；不可把它們當完整 3D 列印機。
- 官方依據：Ultra/MAX product breakdown 明確把 touchscreen/front panel/hood/platform/sensor/encoder 等列為機器構件。官方公開頁未列這 12 個內部 AG article number，因此「它們是零件」信心高，「每個 AG 料號對應原廠料號」只屬中信心。
- 影響：12（全列）。

1. AG-00194-1 — 光固化機-燈管
2. AG-01407 — MAX Touchscreen
3. AG-02551 — Posltion Encoder Projector USB Cable
4. AG-05899 — Ultra Hood 門板蓋子
5. AG-07035 — Ultra 油壓桿
6. AG-07391 — Encoder Board Assembly
7. AG-07446 — Max 2/Ultra CPU Board
8. AG-07458 — Max2 Front Panel觸控面板
9. AG-07514 — Stepping Motor
10. AG-08110 — Ultra Projector 50um
11. AG-08111 — Ultra 平台列印偵測器
12. AG-08114 — Ultra Front Panel觸控面板

## ASIGA 完整性核對

B1 6 + B2 2 + B3 20 + B4 31 + B5 12 = 71，完整覆蓋本次 ASIGA catalog，沒有重疊或遺漏。

## 空品牌 11 筆：全部暫不自動補品牌

官方網站或官方型錄無法用 catalog 內部代碼穩定反查下列 11 筆，因此不能高信心批次寫品牌：

1. C0-028 — Diamond 半鑽石針
2. VP — 軟床
3. VP-03 — 修補液
4. VP-04 — 結合劑
5. VP-05-06 — 鑽冠 #6 #9 #12 (6支)
6. VP-07 — Rag Buffs 棉輪
7. C0-056-01 — Mixing Bowls 石膏拌碗
8. ST-121 — 石膏橡膠底座 (1.5cm)
9. ST-001 — Super Jet 彈性義齒床鑄造機
10. ST-006 — 沖腊機
11. BF-01 — Buffalo 毛刷

### 可用線索但仍不足以寫入

- BF-01 的品名直接含 Buffalo；Buffalo Dental 官方 abrasives 型錄確有牙技拋光 brushes：<https://buffalodental.com/wp-content/uploads/2018/03/Abrasives_2013.pdf>。但官方型錄公開料號格式與 `BF-01` 不吻合，故只能標「品牌疑似 Buffalo Dental，待採購主檔／包裝確認」。
- 其餘 `VP/C0/ST` 是內部前綴的可能性高；網搜出現同名產品不足以證明製造商。需由 ERP 供應商欄、進貨單、包裝照片或原廠型錄料號確認。

## 建議下一步（仍不寫資料）

1. 先把上述 36 DETAX + 71 ASIGA 規則輸出為 dry-run CSV，欄位包含 `code, old*, proposed*, rule, confidence, officialUrl`。
2. DETAX 寫入條件使用本次 36 SKU allowlist，不使用永久的 `brand=DETAX` 全包規則。
3. ASIGA 用五組 SKU allowlist；特別測 AG-00194-1、AG-00929、AG-07862，避免「燈管當設備／樹脂當配件」。
4. 空品牌 11 筆維持未確認；向 ERP/採購資料補證，不用相似品名自動猜。
5. 任何正式更新前仍須同步檢查 `product_families.json` 與 OrderForm/QuoteForm 雙來源依賴；既有訂單、報價與促銷快照不回寫。

驗收: 通過
