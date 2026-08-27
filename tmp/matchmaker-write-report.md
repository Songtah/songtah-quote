# Davis Schottlander Matchmaker 系列重組 dry-run

- 模式：write
- 目錄現有欄位：brand、category、categoryId、code、discontinued、mainCategory、mainCategoryId、name、needsReview、price、productType、seriesName、status
- 系列現有欄位：brand、category、collectionName、coveredSkuCodes、id、namePattern、productType、seriesCode、seriesName、skuMap、skuNameMap、skuPattern、specs、uiVariant
- 影響 SKU：261
- 現有相關系列：38
- 預計移除空舊系列：38
- 預計建立新系列：38
- Notion 手動歸屬已載入：是
- 目標 SKU 的 Notion 手動歸屬：0
- 分類遺漏：0
- 新系列內重複規格鍵：0
- 重組後跨系列 SKU 衝突：0

## 新系列統計

- Matchmaker 套裝組：2 筆；套裝 2
- Matchmaker 專用液：3 筆；用途 3 → 重量 / 容量 1
- Matchmaker Dentine / Body 牙本質瓷粉：22 筆；色號 17 → 重量 / 容量 3
- Matchmaker Effect 效果瓷粉：2 筆；色號 2 → 重量 / 容量 1
- Matchmaker Gingival 牙齦瓷粉：3 筆；色號 3 → 重量 / 容量 1
- Matchmaker Glaze 釉材：2 筆；品項 2 → 重量 / 容量 2
- Matchmaker MC 套裝組：1 筆；套裝 1
- Matchmaker MC Coloured Translucent 透明瓷粉：5 筆；色號 5 → 重量 / 容量 1
- Matchmaker MC Enamel 琺瑯質瓷粉：14 筆；色號 8 → 重量 / 容量 3
- Matchmaker MC Enhancer 增強瓷粉：19 筆；色號 16 → 重量 / 容量 2
- Matchmaker MC Modifier 修飾瓷粉：9 筆；色號 9 → 重量 / 容量 1
- Matchmaker MC Occlusal 咬合面瓷粉：1 筆；色號 1 → 重量 / 容量 1
- Matchmaker MC Opacious Dentine 高遮色牙本質瓷粉：7 筆；色號 7 → 重量 / 容量 1
- Matchmaker MC Opal 乳光瓷粉：7 筆；色號 7 → 重量 / 容量 2
- Matchmaker MC Pontic Fill：1 筆；品項 1 → 重量 / 容量 1
- Matchmaker MC Propaque Paste Opaque 遮色膏：17 筆；色號 17 → 重量 / 容量 1
- Matchmaker Opaque 遮色瓷粉：17 筆；色號 16 → 重量 / 容量 2
- Matchmaker Press Zr 瓷錠：2 筆；色號 2
- Matchmaker Shoulder 肩台瓷粉：7 筆；色號 7 → 重量 / 容量 1
- Matchmaker Stain 0086 色組：15 筆；色號 15
- Matchmaker Stain 16 色組：16 筆；色號 16
- Matchmaker Zr 套裝組：7 筆；套裝 7 → 重量 / 容量 1
- Matchmaker Zr 專用液：2 筆；用途 2 → 重量 / 容量 2
- Matchmaker Zr Coloured Translucent 透明瓷粉：6 筆；色號 6 → 重量 / 容量 1
- Matchmaker Zr Dentine / Body 牙本質瓷粉：22 筆；色號 19 → 重量 / 容量 2
- Matchmaker Zr Enamel 琺瑯質瓷粉：13 筆；色號 8 → 重量 / 容量 2
- Matchmaker Zr Fluorescent 螢光瓷粉：1 筆；色號 1 → 重量 / 容量 1
- Matchmaker Zr Gingival 牙齦瓷粉：2 筆；色號 2 → 重量 / 容量 1
- Matchmaker Zr Glaze 釉材：1 筆；品項 1 → 重量 / 容量 1
- Matchmaker Zr Liner 襯底瓷粉：3 筆；色號 3 → 重量 / 容量 1
- Matchmaker Zr Mamelon 牙本質效果瓷粉：2 筆；色號 2 → 重量 / 容量 1
- Matchmaker Zr Modifier 修飾瓷粉：2 筆；色號 2 → 重量 / 容量 1
- Matchmaker Zr Neck Dentine 頸部瓷粉：3 筆；色號 3 → 重量 / 容量 1
- Matchmaker Zr Occlusal 咬合面瓷粉：2 筆；色號 2 → 重量 / 容量 1
- Matchmaker Zr Opal 乳光瓷粉：7 筆；色號 7 → 重量 / 容量 1
- Matchmaker Zr Opaque 遮色瓷粉：5 筆；色號 5 → 重量 / 容量 1
- Matchmaker Zr Shoulder 肩台瓷粉：3 筆；色號 3 → 重量 / 容量 1
- Matchmaker Zr Stain 上色材：8 筆；色號 8 → 重量 / 容量 1

## 前 20 筆樣本

| 貨號 | ERP 品名（不修改） | 新系列 | 第一層 | 包裝 |
|---|---|---|---|---|
| DSD-01 | Matchmaker Body 專用液/200ml | Matchmaker 專用液 | Body | 200ml |
| DSD-01-1 | Matchmaker Body Plus 專用液/200ml | Matchmaker 專用液 | Body Plus | 200ml |
| DSD-02 | Matchmaker Opaque專用液/200ml | Matchmaker 專用液 | Opaque | 200ml |
| DSD-04 | Matchmaker Glaze Powder 釉粉/10g | Matchmaker Glaze 釉材 | Powder 釉粉 | 10g |
| DSD-0438 | Matchmaker MC Pontic Fill(15g) | Matchmaker MC Pontic Fill | Pontic Fill | 15g |
| DSD-05 | Matchmaker Glaze Liquid 釉水/15ml | Matchmaker Glaze 釉材 | Liquid 釉水 | 15ml |
| DSD-19 | Matchmaker MC A3 Kit | Matchmaker MC 套裝組 | A3 | — |
| DSD-BA1-50 | Matchmaker BODY A1/50g | Matchmaker Dentine / Body 牙本質瓷粉 | A1 | 50g |
| DSD-BA2-250 | Matchmaker Dentine A2/250g | Matchmaker Dentine / Body 牙本質瓷粉 | A2 | 250g |
| DSD-BA2-50 | Matchmaker BODY A2/50g | Matchmaker Dentine / Body 牙本質瓷粉 | A2 | 50g |
| DSD-BA3-250 | Matchmaker Dentine A3/250g | Matchmaker Dentine / Body 牙本質瓷粉 | A3 | 250g |
| DSD-BA3-50 | Matchmaker BODY A3/50g | Matchmaker Dentine / Body 牙本質瓷粉 | A3 | 50g |
| DSD-BA3.5-15 | Matchmaker BODY A3.5/15g | Matchmaker Dentine / Body 牙本質瓷粉 | A3.5 | 15g |
| DSD-BA3.5-250 | Matchmaker Dentine A3.5/250g | Matchmaker Dentine / Body 牙本質瓷粉 | A3.5 | 250g |
| DSD-BA3.5-50 | Matchmaker BODY A3.5/50g | Matchmaker Dentine / Body 牙本質瓷粉 | A3.5 | 50g |
| DSD-BA4-50 | Matchmaker BODY A4/50g | Matchmaker Dentine / Body 牙本質瓷粉 | A4 | 50g |
| DSD-BB1-50 | Matchmaker BODY B1/50g | Matchmaker Dentine / Body 牙本質瓷粉 | B1 | 50g |
| DSD-BB2-50 | Matchmaker BODY B2/50g | Matchmaker Dentine / Body 牙本質瓷粉 | B2 | 50g |
| DSD-BB3-50 | Matchmaker BODY B3/50g | Matchmaker Dentine / Body 牙本質瓷粉 | B3 | 50g |
| DSD-BB4-50 | Matchmaker BODY B4/50g | Matchmaker Dentine / Body 牙本質瓷粉 | B4 | 50g |

## 將移除的空舊系列

- DSD-MATCHMAKER-BASE-KIT｜Matchmaker 套裝組｜原有 2 筆目標 SKU
- DSD-MATCHMAKER-BASE-LIQUID｜Matchmaker 專用液｜原有 3 筆目標 SKU
- DSD-MATCHMAKER-BASE-DENTINE｜Matchmaker Dentine / Body 牙本質瓷粉｜原有 22 筆目標 SKU
- DSD-MATCHMAKER-BASE-EFFECT｜Matchmaker Effect 效果瓷粉｜原有 2 筆目標 SKU
- DSD-MATCHMAKER-BASE-GINGIVAL｜Matchmaker Gingival 牙齦瓷粉｜原有 3 筆目標 SKU
- DSD-MATCHMAKER-BASE-GLAZE｜Matchmaker Glaze 釉材｜原有 2 筆目標 SKU
- DSD-MATCHMAKER-MC-KIT｜Matchmaker MC 套裝組｜原有 1 筆目標 SKU
- DSD-MATCHMAKER-MC-TRANSLUCENT｜Matchmaker MC Coloured Translucent 透明瓷粉｜原有 5 筆目標 SKU
- DSD-MATCHMAKER-MC-ENAMEL｜Matchmaker MC Enamel 琺瑯質瓷粉｜原有 14 筆目標 SKU
- DSD-MATCHMAKER-MC-ENHANCER｜Matchmaker MC Enhancer 增強瓷粉｜原有 19 筆目標 SKU
- DSD-MATCHMAKER-MC-MODIFIER｜Matchmaker MC Modifier 修飾瓷粉｜原有 9 筆目標 SKU
- DSD-MATCHMAKER-MC-OCCLUSAL｜Matchmaker MC Occlusal 咬合面瓷粉｜原有 1 筆目標 SKU
- DSD-MATCHMAKER-MC-OPACIOUS-DENTINE｜Matchmaker MC Opacious Dentine 高遮色牙本質瓷粉｜原有 7 筆目標 SKU
- DSD-MATCHMAKER-MC-OPAL｜Matchmaker MC Opal 乳光瓷粉｜原有 7 筆目標 SKU
- DSD-MATCHMAKER-MC-PONTIC-FILL｜Matchmaker MC Pontic Fill｜原有 1 筆目標 SKU
- DSD-MATCHMAKER-MC-PROPAQUE｜Matchmaker MC Propaque Paste Opaque 遮色膏｜原有 17 筆目標 SKU
- DSD-MATCHMAKER-BASE-OPAQUE｜Matchmaker Opaque 遮色瓷粉｜原有 17 筆目標 SKU
- DSD-MATCHMAKER-PRESS-ZR-PRESS-INGOT｜Matchmaker Press Zr 瓷錠｜原有 2 筆目標 SKU
- DSD-MATCHMAKER-BASE-SHOULDER｜Matchmaker Shoulder 肩台瓷粉｜原有 7 筆目標 SKU
- DSD-MATCHMAKER-BASE-STAIN-0086｜Matchmaker Stain 0086 色組｜原有 15 筆目標 SKU
- DSD-MATCHMAKER-BASE-STAIN-16｜Matchmaker Stain 16 色組｜原有 16 筆目標 SKU
- DSD-MATCHMAKER-ZR-KIT｜Matchmaker Zr 套裝組｜原有 7 筆目標 SKU
- DSD-MATCHMAKER-ZR-LIQUID｜Matchmaker Zr 專用液｜原有 2 筆目標 SKU
- DSD-MATCHMAKER-ZR-TRANSLUCENT｜Matchmaker Zr Coloured Translucent 透明瓷粉｜原有 6 筆目標 SKU
- DSD-MATCHMAKER-ZR-DENTINE｜Matchmaker Zr Dentine / Body 牙本質瓷粉｜原有 22 筆目標 SKU
- DSD-MATCHMAKER-ZR-ENAMEL｜Matchmaker Zr Enamel 琺瑯質瓷粉｜原有 13 筆目標 SKU
- DSD-MATCHMAKER-ZR-FLUORESCENT｜Matchmaker Zr Fluorescent 螢光瓷粉｜原有 1 筆目標 SKU
- DSD-MATCHMAKER-ZR-GINGIVAL｜Matchmaker Zr Gingival 牙齦瓷粉｜原有 2 筆目標 SKU
- DSD-MATCHMAKER-ZR-GLAZE｜Matchmaker Zr Glaze 釉材｜原有 1 筆目標 SKU
- DSD-MATCHMAKER-ZR-LINER｜Matchmaker Zr Liner 襯底瓷粉｜原有 3 筆目標 SKU
- DSD-MATCHMAKER-ZR-MAMELON｜Matchmaker Zr Mamelon 牙本質效果瓷粉｜原有 2 筆目標 SKU
- DSD-MATCHMAKER-ZR-MODIFIER｜Matchmaker Zr Modifier 修飾瓷粉｜原有 2 筆目標 SKU
- DSD-MATCHMAKER-ZR-NECK-DENTINE｜Matchmaker Zr Neck Dentine 頸部瓷粉｜原有 3 筆目標 SKU
- DSD-MATCHMAKER-ZR-OCCLUSAL｜Matchmaker Zr Occlusal 咬合面瓷粉｜原有 2 筆目標 SKU
- DSD-MATCHMAKER-ZR-OPAL｜Matchmaker Zr Opal 乳光瓷粉｜原有 7 筆目標 SKU
- DSD-MATCHMAKER-ZR-OPAQUE｜Matchmaker Zr Opaque 遮色瓷粉｜原有 5 筆目標 SKU
- DSD-MATCHMAKER-ZR-SHOULDER｜Matchmaker Zr Shoulder 肩台瓷粉｜原有 3 筆目標 SKU
- DSD-MATCHMAKER-ZR-STAIN｜Matchmaker Zr Stain 上色材｜原有 8 筆目標 SKU
