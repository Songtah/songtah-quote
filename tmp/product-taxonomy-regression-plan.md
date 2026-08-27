# 6,084 SKU Taxonomy Sidecar 機械驗收計畫

日期：2026-07-14  
性質：唯讀基線與驗收設計；未修改 catalog、family、促銷、訂單或正式資料。

## 一、驗收前提與檔案契約

以下命令假設生成物為：

- `public/product_taxonomy_map.json`：array，恰好一個 SKU 一筆；每筆至少有 `skuCode`、`businessCategoryId`、`functionCategoryId`、`productKind`、`lifecycleStatus`，`seriesId` 可為 null，另可有 `variantSpecs/facets/taxonomyVersion`。
- `public/product_taxonomy_dictionary.json`：object，至少有 `businessCategories`、`functionCategories`、`productKinds`、`lifecycleStatuses` arrays；每個 dictionary item 有唯一 `id`。
- `public/products_catalog.json` 與 `public/product_families.json` 不由 generator 寫入。

若實際欄位名不同，先調整 validator 契約再生成；不可生成後為了通過測試臨時放寬 identity、unknown 或 series 規則。

## 二、已凍結基線

### 原始檔 SHA-256

```text
public/products_catalog.json
ac025d8edff23c5550029280ef7199c1d21c5233e3b8a8af83143008fcb4b1af

public/product_families.json
ab73a40d73bc77ec87b7a305c445e95e8216e8b336a15467b93965dda89fa376
```

重算：

```bash
shasum -a 256 public/products_catalog.json public/product_families.json
```

### 不可變商業欄位 canonical hash

將 `code/name/price/discontinued/status` 按 code 排序後的 SHA-256：

```text
bfbbaed426269528850294b9f557607ca6dd3cb6e8f9f40923c03369d579d8d8
```

重算：

```bash
jq -cS '[.[]|{code,name,price,discontinued,status}]|sort_by(.code)' public/products_catalog.json | shasum -a 256
```

這個 hash 比 raw file hash 更重要：即使未來只重排 JSON 或縮排改變，五個正式欄位仍必須逐筆完全一致。

### 數量基線

```text
catalog rows             6084
distinct code            6084
has price                2759
discontinued=true         140
status=已停售               91
status=未販售               49
families                    42
distinct family id          42
```

重算：

```bash
jq -r '[length,([.[].code]|unique|length),([.[]|select(has("price"))]|length),([.[]|select(.discontinued==true)]|length),([.[]|select(.status=="已停售")]|length),([.[]|select(.status=="未販售")]|length)]|@tsv' public/products_catalog.json
jq -r '[length,([.[].id]|unique|length)]|@tsv' public/product_families.json
```

### Family identity 與顯式 membership 基線

排序後 42 個 family id hash：

```text
33f809e5b41c43f61338bb173220c9351c93e247c6009cac438ed881d1010d96
```

全部 skuMap `skuCode→familyId` pair 排序 hash：

```text
66bc9bc370c5f89225aa2a4ea18f7be958803e40fde35a5256d54079ab683872
```

目前 skuMap 對 catalog 的狀態：1,794 個 SKU 有顯式命中，其中 1,781 唯一、13 跨 family 重複；其餘 4,290 沒有 skuMap 命中。13 個衝突 SKU 在來源修正前，sidecar 的 `seriesId` 必須為 null，不得以 prefix 任選一個。

重算：

```bash
jq -cS '[.[].id]|sort' public/product_families.json | shasum -a 256
jq -r '.[] as $f | (($f.skuMap // {}) | to_entries[]) | [.value,$f.id] | @tsv' public/product_families.json | sort | shasum -a 256
```

現有 family API 仍會在沒有 skuMap 時使用 prefix（`app/api/products/families/[id]/route.ts:24-33`）；該行為不可作 sidecar series 來源。OrderForm 所稱 `coveredSkuCodes` 實際是 skuMap values 加人工 Notion assignments（`components/OrderForm.tsx:172-180`）。sidecar 只能接受來源中明確列出的 code，不可呼叫 `getFamilyByCode()` 補洞。

## 三、必過的機械驗收

建議把以下邏輯正式實作為 `scripts/validate_product_taxonomy.mjs`，CI 與每次 taxonomy 生成後執行：

```bash
node scripts/validate_product_taxonomy.mjs \
  --catalog public/products_catalog.json \
  --families public/product_families.json \
  --dictionary public/product_taxonomy_dictionary.json \
  --mapping public/product_taxonomy_map.json
```

validator 必須以任何一項失敗即 exit 1，並輸出「規則、影響筆數、前 20 筆 skuCode」。不得自動修檔。

### A. Catalog 完整性與不可變欄位

1. catalog length = 6,084。
2. catalog code 非空且 distinct = 6,084。
3. raw catalog hash 仍為基線，或若只有格式化差異，canonical five-field hash 必須等於 `bfbbae...d8d8`。
4. `code/name/price/discontinued/status` 必須逐筆與 generator 前 snapshot deep-equal；不接受只比總數。
5. price/discontinued/status 的基線數量仍是 2,759 / 140 / 91 / 49。

快速 gate：

```bash
test "$(jq 'length' public/products_catalog.json)" = "6084"
test "$(jq '[.[].code]|unique|length' public/products_catalog.json)" = "6084"
test "$(jq -cS '[.[]|{code,name,price,discontinued,status}]|sort_by(.code)' public/products_catalog.json | shasum -a 256 | awk '{print $1}')" = "bfbbaed426269528850294b9f557607ca6dd3cb6e8f9f40923c03369d579d8d8"
```

### B. Sidecar 6,084 筆完整一對一

必須同時成立：

- mapping length = 6,084。
- 6,084 個 `skuCode` 全部非空且唯一。
- sorted(mapping.skuCode) 與 sorted(catalog.code) 完全相同；不得多、少或用 name 對應。

快速 gate：

```bash
test "$(jq 'length' public/product_taxonomy_map.json)" = "6084"
test "$(jq '[.[].skuCode]|unique|length' public/product_taxonomy_map.json)" = "6084"
jq -n -e --slurpfile c public/products_catalog.json --slurpfile m public/product_taxonomy_map.json '([$c[0][].code]|sort)==([$m[0][].skuCode]|sort)'
```

### C. Dictionary reference integrity 與 unknown=0

每一筆 mapping 的 businessCategoryId、functionCategoryId、productKind、lifecycleStatus：

- 皆非 null/空字串。
- 值必須存在對應 dictionary id。
- 不允許 `unknown`、`other-review`、`其他` 或未登錄自由文字。
- dictionary 每一 namespace 的 id 自身也必須唯一。

建議 validator 輸出四個 unknown counts，全部必須為 0。migration 中間產物可以有 review queue，但「即將正式採用的 6,084 sidecar」不能以 other/unknown 假裝完成。

### D. Series 僅限精確唯一來源

允許來源集合：

1. `family.skuMap` 的 value。
2. family 若將來真的含 `coveredSkuCodes`，其中逐字相等的 code。
3. 不接受 `startsWith(seriesCode)`、名稱相似、品牌+category 推論或 `getFamilyByCode()`。

對每一筆非空 `mapping.seriesId`：

- seriesId 必須存在於現有 42 個 family id。
- pair `(skuCode, seriesId)` 必須存在顯式來源集合。
- 該 skuCode 在全部顯式來源只可命中這一個 family；命中 0 或 >1 都 exit 1。
- sidecar 不得創造第 43 個 family，family id hash仍為 `33f809...d96`。

沒有顯式唯一 series 的 SKU 可以 `seriesId:null`；「mapping 完整」是每 SKU 都有 taxonomy row，不是強迫每 SKU 有 series。

### E. 促銷穩定鍵

- sidecar identity 必須命名為 `skuCode` 且逐字等於 catalog code；不可另造 canonical SKU 後改寫促銷。
- `seriesId` 只可使用既有 family id；不可由 business/function category ID 取代。
- 促銷規則仍維持 skuCode 精準優先，且只允許 `series_discount` / `series_buy_n_get_m` 使用 seriesId（`lib/order-pricing.ts:42-64`）。
- taxonomy 生成前後執行既有促銷 9 cases；另固定斷言同 category 不同 sku 不會誤中單品促銷、同 businessCategory 不會被視為系列。

## 四、3D 列印分類固定抽樣

以下五類必須進 validator 的 exact assertions；它們刻意包含目前舊分類錯置的品項，避免 generator 只是複製 productType/category：

| 類型 | SKU | 預期 businessCategoryId | 預期 functionCategoryId | 預期 productKind |
|---|---|---|---|---|
| Printer | `AG-02391` MAX UV 3D Printer | `additive-manufacturing` | `3d-printer` | `equipment` |
| Resin | `DT-02040` Freeprint Denture Resin | `additive-manufacturing` | `3d-printing-resin` | `consumable` |
| Post-processing | `AG-00194` Asiga Flash | `additive-manufacturing` | `post-processing-curing` | `equipment` |
| Accessory | `AG-0077` MAX 2 Crown kit | `additive-manufacturing` | `3d-printer-accessory` | `accessory` |
| Spare part | `AG-00194-1` 光固化機燈管 | `additive-manufacturing` | `3d-printer-spare-part` | `spare_part` |

補充高風險抽樣：`AG-07446` CPU Board 也應為 spare_part；build tray/platform 應依是否可重複使用標 accessory，不能因舊 mainCategory=耗材就一律 consumable。

可執行斷言（dictionary 必須採上述固定 ID）：

```bash
jq -e '
  INDEX(.skuCode) as $m |
  ($m["AG-02391"]  | .businessCategoryId=="additive-manufacturing" and .functionCategoryId=="3d-printer" and .productKind=="equipment") and
  ($m["DT-02040"]  | .businessCategoryId=="additive-manufacturing" and .functionCategoryId=="3d-printing-resin" and .productKind=="consumable") and
  ($m["AG-00194"]  | .businessCategoryId=="additive-manufacturing" and .functionCategoryId=="post-processing-curing" and .productKind=="equipment") and
  ($m["AG-0077"]   | .businessCategoryId=="additive-manufacturing" and .functionCategoryId=="3d-printer-accessory" and .productKind=="accessory") and
  ($m["AG-00194-1"]| .businessCategoryId=="additive-manufacturing" and .functionCategoryId=="3d-printer-spare-part" and .productKind=="spare_part")
' public/product_taxonomy_map.json
```

## 五、執行順序與交付證據

1. 生成前保存本文件所列 hashes/counts；確認 worktree 中 catalog/family 沒有其他人變更。
2. generator 只寫 sidecar/dictionary；先執行 validator，不改任何 consumer。
3. 失敗時輸出報告到 tmp，不自動把 unknown 歸其他、不用 prefix 補 series。
4. validator 全綠後才做 UI/API 雙讀；舊搜尋結果、停售隱藏、管理頁全顯示、促銷與訂單快照另跑 smoke。
5. 最終證據至少包含：四個 SHA-256、六組 count、dictionary unknown=0、mapping 6,084/6,084、series unique/ambiguous/unmapped 統計、五個 3D exact assertions。

驗收: 通過
