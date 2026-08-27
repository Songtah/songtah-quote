# 產品分類資料唯讀盤點

盤點日期：2026-07-14  
資料：`public/products_catalog.json`、`public/product_families.json`  
限制：只做 JSON 統計，未修改 catalog、families 或正式資料。

## 1. 規模與欄位覆蓋

### products_catalog.json

- 總品項：6,084。
- 6,084/6,084 皆有：`code`、`name`、`brand`、`productType`、`mainCategory`、`category`（但 brand 有 11 筆空字串）。
- `price`：2,759 筆有值，皆為正數；3,325 筆沒有此欄位。
- `status`、`discontinued`：各只出現在同一批 140 筆；其中 `已停售` 91、`未販售` 49，且 140 筆全部 `discontinued=true`。其餘 5,944 筆兩欄皆缺省；未發現 status/discontinued 互相矛盾。
- catalog 沒有 `series`、`seriesId` 或 `seriesCode` 欄位，6,084 筆均無法直接以系列欄位分組。
- 貨號重複群組：0；品名重複群組：48（品名重複不必然是錯誤，例如同名不同尺寸／貨號）。

### product_families.json

- 系列定義：42 筆；`seriesCode` 有 41 個唯一值。
- 重複 seriesCode：`YMH-T0` 2 筆（family id：`YMH-EFCA`、`YMH-EFCP`），需確認是兩個子系列共用代碼或識別衝突。
- 品牌 12 值、productType 5 值、category 12 值，均無空值。
- 25/42 families 有 `skuMap`；共 1,807 個 map entry、1,794 個唯一 SKU，全部可在 catalog 找到。
- families 沒有 `mainCategory`、`status`、`discontinued`；因此它不是 catalog 完整分類的直接權威來源。

## 2. Catalog 唯一值與數量

### productType（8）

| 值 | 筆數 |
|---|---:|
| 材料 | 4,603 |
| 耗材 | 472 |
| 設備 | 345 |
| 藥液 | 230 |
| 配件 | 215 |
| 工具 | 164 |
| 其他 | 52 |
| 軟體 | 3 |

### mainCategory（7）

| 值 | 筆數 |
|---|---:|
| 材料 | 4,263 |
| 耗材 | 691 |
| 輔助工具 | 387 |
| 設備 | 351 |
| 染液色料 | 323 |
| 其他 | 66 |
| 軟體 | 3 |

### brand（42 個非空值，另 11 筆空白）

YAMAHACHI 1,685；Zirkonzahn 1,211；貝施美 731；Davis Schottlander 594；GC / 台灣而至 569；Song Young 255；YAMAKIN 220；DENKEN 92；Sunshine / DR.HOPF 73；CAM / 上海穩昊 72；ASIGA 71；Dumont 64；WHIP MIX 54；SUN Oberflächentechnik 51；GenCore 46；Prima Dental 38；KO-MAX 37；DETAX 36；DENTAL ESPAN 32；HIGH DENTAL JAPAN 23；Aalba Dent 18；URAWA 16；MOTYL 15；Redon 15；KEYSTONE 9；MEDIFIVE 8；MPF 8；CADstar 3；PRODENT-HOLLIGER 3；SAEYANG 3；Select Dental 3；UGin Dental 3；DENTBIRD 2；Dekema 2；PACIFIC ABRASIVES 2；PROMEDLCA 2；Talmax 2；Argofile 1；DOF 1；Olson Saw 1；WINFRIED MULLER 1；其他 1；空白 11。

### category（56）

塑鋼牙 1,858；氧化鋯塊 996；瓷粉 / 陶瓷 915；車針 / 鑽針 307；植體配件 232；染液 - 內染 185；設備配件 144；掃描儀 136；PMMA 塊 130；染液 - 外染 106；磨石 / 研磨工具 99；樹脂材料 71；其他材料 68；包埋 / 石膏 65；金屬材料 56；其他 51；咬合器 / 配件 48；3D列印機 41；蠟 / 壓鑄材 40；3D列印機配件 39；牙科器材 34；釉材 28；馬達 / 手機 26；瓷筆 / 刷具 25；專用液 / 藥劑 24；玻璃陶瓷 24；壓鑄 / 鑄造機 23；煮模 / 壓模工具 22；瓷爐 21；清潔 / 吸塵 20；蠟塊 20；印模材料 19；切片 / 鋸片 17；比色板 16；爐具配件 16；研磨砂 / 拋光砂 16；設備 16；馬達配件 16；套裝組 15；光學設備 13；燒結爐 11；車機 / 研磨機 11；技工桌 10；光固化機 8；蠟工設備 7；其他工具 6；工具 6；瓷粉 5；咬合器 4；車機配件 4；過濾耗材 4；設計軟體 3；其他設備 2；拋光 / 研磨 2；模型配件 2；切片 1。

## 3. 前 20 大 brand × category

| 品牌 | category | 筆數 |
|---|---|---:|
| YAMAHACHI | 塑鋼牙 | 1,549 |
| 貝施美 | 氧化鋯塊 | 553 |
| Zirkonzahn | 氧化鋯塊 | 443 |
| GC / 台灣而至 | 瓷粉 / 陶瓷 | 430 |
| Davis Schottlander | 塑鋼牙 | 309 |
| Zirkonzahn | 植體配件 | 232 |
| YAMAKIN | 瓷粉 / 陶瓷 | 220 |
| Davis Schottlander | 瓷粉 / 陶瓷 | 150 |
| Zirkonzahn | 掃描儀 | 132 |
| Zirkonzahn | 染液 - 內染 | 104 |
| Zirkonzahn | PMMA 塊 | 93 |
| 貝施美 | 染液 - 內染 | 81 |
| Song Young | 設備配件 | 77 |
| Davis Schottlander | 其他材料 | 68 |
| Zirkonzahn | 車針 / 鑽針 | 65 |
| Dumont | 車針 / 鑽針 | 63 |
| Zirkonzahn | 瓷粉 / 陶瓷 | 62 |
| CAM / 上海穩昊 | 磨石 / 研磨工具 | 61 |
| Sunshine / DR.HOPF | 車針 / 鑽針 | 56 |
| Song Young | 咬合器 / 配件 | 45 |

## 4. 前 20 大 productType × mainCategory

| productType | mainCategory | 筆數 |
|---|---|---:|
| 材料 | 材料 | 4,228 |
| 耗材 | 耗材 | 441 |
| 設備 | 設備 | 318 |
| 材料 | 輔助工具 | 231 |
| 配件 | 耗材 | 214 |
| 藥液 | 染液色料 | 189 |
| 材料 | 染液色料 | 134 |
| 工具 | 輔助工具 | 111 |
| 其他 | 其他 | 51 |
| 藥液 | 輔助工具 | 36 |
| 工具 | 設備 | 32 |
| 耗材 | 材料 | 31 |
| 設備 | 耗材 | 19 |
| 工具 | 其他 | 15 |
| 材料 | 耗材 | 10 |
| 設備 | 輔助工具 | 8 |
| 工具 | 耗材 | 6 |
| 藥液 | 材料 | 4 |
| 軟體 | 軟體 | 3 |
| 其他 | 設備 | 1 |

## 5. 同義、拼字與模型不一致候選

以下只列「需人工確認」，不直接判定或改資料。

1. 品牌大小寫：catalog 使用 `DETAX`，families 使用 `Detax`；正規化後是同一品牌候選。
2. families 特有 productType：`3D列印樹脂`；catalog 的 8 個 productType 沒有此值。
3. families 特有 category：`材料`、`染液 / 色料`、`玻璃陶瓷塊`；catalog category 沒有完全相同值。
4. catalog 疑似同義或粒度混用：`瓷粉` 5 vs `瓷粉 / 陶瓷` 915、`咬合器` 4 vs `咬合器 / 配件` 48、`切片` 1 vs `切片 / 鋸片` 17、`設備` 16 vs `其他設備` 2。
5. category 名稱同時混合「用途」「產品實體」「設備類型」與「主類＋配件」，不適合直接當唯一第二層分類。

## 6. 疑似誤分類／軸衝突

1. `productType=設備` 但 `mainCategory!=設備`：27 筆；其中 19 筆落在 mainCategory=耗材、8 筆落在輔助工具。
2. `mainCategory=設備` 但 `productType!=設備`：33 筆；其中 32 筆是工具、1 筆是其他。
3. category 名稱含「配件」但 `productType!=配件`：286 筆。這不一定錯，例如植體配件可能被視為材料；但證明「配件」目前同時是 productType 與 category 語意，無法直接拿來做互斥階層。
4. DETAX 36 筆中，28 筆 Freeprint 樹脂被 catalog 分為 `設備 / 設備 / 3D列印機`，另 8 筆為 `其他 / 其他 / 其他`；family `DT-ALL` 卻定義為 `3D列印樹脂 / 材料`。這是高可信的分類衝突候選。
5. 空品牌 11 筆，包含設備、材料、耗材與工具；重整品牌導覽前必須補上或明確歸入「未確認品牌」。

## 7. 決策含意

- 現有 `productType`、`mainCategory`、`category` 不是乾淨的三層樹，而是三種曾經疊加的分類觀點。
- 「品牌」適合作為獨立 facet，不建議固定成所有瀏覽路徑的第一層；使用者可能先找品類，再找品牌。
- 建議先定義互斥的商品角色軸，例如：設備、材料/耗材、零件/配件、工具、軟體/服務；再定義用途/技術類別與品牌 facet。
- 在使用者確認 taxonomy 前，不應批次重寫 6,084 筆。下一步先產生舊值→新值 mapping dry-run，列影響筆數與前 20 筆樣本，再核准寫入。

## 8. 重現命令摘要

- 總數／欄位：`jq` 的 `length`、`keys` 分組。
- 唯一值：`[.[] | .FIELD] | group_by(.) | map({value:.[0], count:length})`。
- 交叉分布：將 `[brand, category]`、`[productType, mainCategory]` 分組排序取前 20。
- 一致性：檢查 status/discontinued 組合、貨號重複、families skuMap 對 catalog code 的集合差。

驗收: 通過
