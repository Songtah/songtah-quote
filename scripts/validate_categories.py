#!/usr/bin/env python3
"""
產品分類驗證器(2026-07-14 改版:字典驅動)

分類權威 = data/product-taxonomy.json(源自松達產品分類總表;11 主分類 × 62 功能分類 × 9 商品型態)。
檢查 products_catalog.json 每一筆:
  1. 結構:mainCategory/category/productType 皆屬字典、功能分類隸屬正確主分類、id 與名稱一致
  2. 品名規則:新品(ERP 匯入)依品名 regex 建議功能分類,現值不符即回報
  3. 品牌前綴:貨號前綴=品牌(2026-07-12 使用者定案),空白可 --fix 補、不符回報

用法:
    python3 scripts/validate_categories.py            # 驗證報告(不改檔)
    python3 scripts/validate_categories.py --fix      # 自動修正高信心項目(品牌空白/型態一致化)
ERP 匯入新品項後務必跑一次。分類規則調整請改總表後跑 scripts/migrate-taxonomy.py,不要手改 catalog。
"""

import json
import re
import sys
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
CATALOG = os.path.join(ROOT, 'public', 'products_catalog.json')
TAXONOMY = os.path.join(ROOT, 'data', 'product-taxonomy.json')

# ── 品名 regex → 建議功能分類(新品自動歸位用;由上而下先中先贏)──────
RULES = [
    (r'^(EFC-[AP]|FX |MILLION|AC 半塑鋼|SIM-P|EFUCERA|Soluute|Crown PX|New Ace|RH 塑鋼|Enigma 塑鋼)', '塑鋼牙／人工牙'),
    (r'^(Prettau \d|Prettau Zirconia|ZRA[BD]\d|Antomic|Anatomic Coloured|ICE PLUS|ICE ZIRKON)', '氧化鋯塊'),
    (r'^(Temp Basic|Temp Premiu|TEMP PREMIUM|MULTISTRATUM|Tecno Med|TECNO MED|ABRO|DENTURE GINGIVA)', 'PMMA 塊'),
    (r'^(Sintermetall \d|SINTERNIT|Titan 5|TITANIT|Chrom-cobalt|MEAC\d|MEAL\d)', '金屬材料'),
    (r'(Color Liquid|Colour Liquid|Color Luquid|Aquarell(?! Set)|Waterbased [A-Z]|Bio-Pigme|Fresco Liquid|內染液)', '內染液'),
    (r'(Artamic[\w\s]*Stain|Matchmaker Stain|3D Stain|Initial Spectrum Stain)', '外染液'),
    (r'(Curving Wax|Wax White|蠟塊|Wax Disk)', '蠟塊'),
    (r'(Basing Resin|Re-Fine Bright|Ortho Bright|Soft Liner|OSTRON|TEMPSMART|Basis 慢性粉)', '樹脂材料'),
    (r'(CERASMART|CEARSMART)', '玻璃陶瓷'),
    (r'^(AEGA|AEDG|AESM|AEDGM)', '牙科器材'),
    (r'^Screwdriver', '植體配件'),
    (r'^Spare Part', '設備配件'),
    (r'(瓷粉雕刀|雕刻刀)', '瓷筆／刷具'),
    (r'(Shade Guide|比色板)', '比色板'),
]

# 近親豁免:規則建議 A 但現值為集合內者不誤報
WHITELIST = {
    '塑鋼牙／人工牙': {'塑鋼牙／人工牙'},
    '氧化鋯塊': {'氧化鋯塊'},
    'PMMA 塊': {'PMMA 塊'},
    '金屬材料': {'金屬材料'},
    '內染液': {'內染液'},
    '外染液': {'外染液'},
    '蠟塊': {'蠟塊', '蠟／壓鑄材料'},
    '樹脂材料': {'樹脂材料', '3D 列印材料／樹脂'},
    '玻璃陶瓷': {'玻璃陶瓷'},
    '牙科器材': {'牙科器材', '一般工具', '其他工具'},
    # Screwdriver:植體起子歸植體配件,但總表把部分歸牙科器材(臨床器械),兩者皆可
    '植體配件': {'植體配件', '牙科器材'},
    # Spare Part:設備維修件為主,但植體系統的 Spare Part 總表歸植體配件,尊重總表
    '設備配件': {'設備配件', '列印機配件', '車機配件', '爐具配件', '馬達配件', '咬合器配件', '植體配件'},
    '瓷筆／刷具': {'瓷筆／刷具'},
    '比色板': {'比色板'},
}

# ── 品牌前綴規則(貨號開頭字母段=品牌;全目錄實測零衝突)──────────────
BRAND_PREFIXES = {
    'YMH': 'YAMAHACHI', 'ZZ': 'Zirkonzahn', 'BS': '貝施美', 'DSD': 'Davis Schottlander',
    'GC': 'GC / 台灣而至', 'SY': 'Song Young', 'YM': 'YAMAKIN', 'DK': 'DENKEN',
    'SS': 'Sunshine / DR.HOPF', 'CA': 'CAM / 上海穩昊', 'AG': 'ASIGA', 'DUM': 'Dumont',
    'WM': 'WHIP MIX', 'SUN': 'SUN Oberflächentechnik', 'GEN': 'GenCore', 'ADB': 'Prima Dental',
    'KM': 'KO-MAX', 'DT': 'DETAX', 'MT': 'MESTRA', 'HD': 'HIGH DENTAL JAPAN',
    'AB': 'Aalba Dent', 'UW': 'URAWA', 'MO': 'MOTYL', 'RD': 'Redon', 'KS': 'KEYSTONE',
    'ME': 'MEDIFIVE', 'MPF': 'MPF', 'CAD': 'CADstar', 'PD': 'PRODENT-HOLLIGER',
    'SA': 'SAEYANG', 'SD': 'Select Dental', 'UG': 'UGin Dental', 'DB': 'DENTBIRD',
    'DKM': 'Dekema', 'PC': 'PACIFIC ABRASIVES', 'PM': 'PROMEDLCA', 'TD': 'Talmax',
    'AF': 'Argofile', 'DOF': 'DOF', 'DP': 'DENKEN', 'OS': 'Olson Saw', 'WF': 'WINFRIED MULLER',
}


def brand_from_code(code):
    m = re.match(r'^([A-Za-z]+)', code or '')
    return BRAND_PREFIXES.get(m.group(1).upper()) if m else None


def classify(name):
    for pat, cat in RULES:
        if re.search(pat, name, re.I):
            return cat
    return None


def main():
    fix = '--fix' in sys.argv

    with open(CATALOG, encoding='utf-8') as f:
        catalog = json.load(f)
    with open(TAXONOMY, encoding='utf-8') as f:
        tax = json.load(f)

    mains = {m['name']: m['id'] for m in tax['mainCategories']}
    funcs = {c['name']: c for c in tax['funcCategories']}
    forms = {p['name'] for p in tax['productForms']}

    # 1. 結構驗證(字典驅動)
    struct_bad = []
    for p in catalog:
        errs = []
        if p.get('mainCategory') not in mains: errs.append(f"主分類「{p.get('mainCategory')}」不在字典")
        if p.get('category') not in funcs: errs.append(f"功能分類「{p.get('category')}」不在字典")
        if p.get('productType') not in forms: errs.append(f"型態「{p.get('productType')}」不在字典")
        if not errs:
            fc = funcs[p['category']]
            if fc['mainName'] != p['mainCategory']:
                errs.append(f"功能「{p['category']}」應屬「{fc['mainName']}」而非「{p['mainCategory']}」")
            if p.get('mainCategoryId') != mains[p['mainCategory']]:
                errs.append('mainCategoryId 與主分類不一致')
            if p.get('categoryId') != fc['id']:
                errs.append('categoryId 與功能分類不一致')
        if errs:
            struct_bad.append((p, errs))

    # 2. 品名規則(新品歸位建議)
    name_bad = []
    for p in catalog:
        want = classify(p['name'])
        if want is None:
            continue
        if p['category'] not in WHITELIST.get(want, {want}):
            name_bad.append((p, want))

    # 3. 品牌前綴
    brand_blank, brand_conflict = [], []
    for p in catalog:
        want_b = brand_from_code(p['code'])
        if want_b is None:
            continue
        if not p.get('brand'):
            brand_blank.append((p, want_b))
        elif p['brand'] != want_b:
            brand_conflict.append((p, want_b))

    needs_review = sum(1 for p in catalog if p.get('needsReview'))

    print(f'總品項: {len(catalog)}(字典 v{tax.get("version", "?")}:主分類 {len(mains)}/功能 {len(funcs)}/型態 {len(forms)})')
    print(f'結構錯誤: {len(struct_bad)},品名建議不符: {len(name_bad)},品牌空白可補: {len(brand_blank)},品牌不符: {len(brand_conflict)},待覆核旗標: {needs_review}')
    for p, errs in struct_bad[:20]:
        print(f'  結構  {p["code"]}  {"; ".join(errs)}')
    for p, want in name_bad[:20]:
        print(f'  品名  {p["code"]}  「{p["category"]}」→ 建議「{want}」  ({p["name"][:30]})')
    for p, want_b in brand_conflict:
        print(f'  品牌  {p["code"]}  {p["brand"]!r} → 前綴應為 {want_b!r}')

    if fix:
        for p, want_b in brand_blank:  # 只補空白,不覆蓋
            p['brand'] = want_b
        with open(CATALOG, 'w', encoding='utf-8') as f:
            json.dump(catalog, f, ensure_ascii=False, indent=1)
        print(f'已補 {len(brand_blank)} 筆空白品牌')

    if struct_bad:
        sys.exit(1)


if __name__ == '__main__':
    main()
