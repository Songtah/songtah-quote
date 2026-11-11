#!/usr/bin/env python3
"""
氧化鋯塊系列補完＋分類修正（2026-11-11，使用者逐項確認）。

絕不更動 ERP 的貨號（code）與品名（name）。只做：
  1. 3 個 Aquarell 套組由「氧化鋯塊」改歸「內染液」（使用者：它們是染色液）
  2. 為尚未歸系列的氧化鋯塊建立系列（data/catalog/product_families.json），
     以 ERP 品名的固定結構「系列 直徑H厚度 色號」拆出規格軸，skuMap 精確對應到 ERP 貨號
     - 「95XH30」視同 95H30（使用者指示）
     - 「…Dispersive 1H16/1H22 …(3pcs)」是子彈型夾具，留在氧化鋯塊分類，另成系列
  3. 不處理：只寫「Zirconia」「Anterior」的品項（無法判斷是哪一款，待確認）、單一貨號的彩色鋯塊

用法：python3 scripts/apply-zirconia-series-2026-11.py          # dry-run，只印計畫
      python3 scripts/apply-zirconia-series-2026-11.py --write  # 寫入兩個 JSON
"""
import json, re, sys
from collections import defaultdict, OrderedDict

WRITE = '--write' in sys.argv
CATALOG = 'data/catalog/products_catalog.json'
FAMILIES = 'data/catalog/product_families.json'
catalog = json.load(open(CATALOG, encoding='utf-8'))
families = json.load(open(FAMILIES, encoding='utf-8'))
names_before = {x['code']: x['name'] for x in catalog}

def member_codes(fam):
    return [v for v in list((fam.get('skuMap') or {}).values()) + list(fam.get('coveredSkuCodes') or []) + list(fam.get('manualAssignedSkuCodes') or []) if v]
owned = {c for fam in families for c in member_codes(fam)}
fam_ids = {fam['id'] for fam in families}

# ── 1. 染色液改分類 ──────────────────────────────────────────────
STAIN_CODES = ['ZZ-63-20', 'ZZ-63-21', 'ZZ-68-SET']
ref = next(x for x in catalog if x.get('category') == '內染液' and x.get('brand') == 'Zirkonzahn')
recat = []
for x in catalog:
    if x['code'] in STAIN_CODES and x.get('category') == '氧化鋯塊':
        before = (x.get('category'), x.get('mainCategory'))
        for k in ('category', 'categoryId', 'mainCategory', 'mainCategoryId', 'productType'):
            x[k] = ref[k]
        recat.append((x['code'], x['name'], before, (x['category'], x['mainCategory'])))

# ── 2. 建立系列 ──────────────────────────────────────────────────
# ERP 品名裡的系列寫法 → (系列 id, 系列名稱)。系列名稱用原廠拼法；ERP 品名一字不改。
SERIES = {
    ('Zirkonzahn', 'Prettau 3'): ('ZZ-PRETTAU-3', 'Prettau 3 氧化鋯塊'),
    ('Zirkonzahn', 'Prettau 2'): ('ZZ-PRETTAU-2', 'Prettau 2 氧化鋯塊'),
    ('Zirkonzahn', 'Prettau 2 Bleach OM1'): ('ZZ-PRETTAU-2', 'Prettau 2 氧化鋯塊'),   # Bleach 0M1 是色號
    ('Zirkonzahn', 'Antomic Coloured'): ('ZZ-ANATOMIC-COLOURED', 'Anatomic Coloured 氧化鋯塊'),
    ('Zirkonzahn', 'Prettau 4 Anterior'): ('ZZ-PRETTAU-4-ANTERIOR', 'Prettau 4 Anterior 氧化鋯塊'),
    ('Zirkonzahn', 'Prettau 4 Anterior Dispersive'): ('ZZ-PRETTAU-4-ANTERIOR-DISPERSIVE', 'Prettau 4 Anterior Dispersive 氧化鋯塊'),
    ('Zirkonzahn', 'Prettau Zirconia'): ('ZZ-PRETTAU-ZIRCONIA', 'Prettau Zirconia 氧化鋯塊'),
    ('Zirkonzahn', 'Prettau Anterior'): ('ZZ-PRETTAU-ANTERIOR', 'Prettau Anterior 氧化鋯塊'),
    ('Zirkonzahn', 'ICE PLUS'): ('ZZ-ICE-PLUS', 'ICE Plus 氧化鋯塊'),
    ('貝施美', 'SHT'): ('BS-SHT', 'SHT 氧化鋯塊'),
    ('貝施美', 'ST'): ('BS-ST', 'ST 氧化鋯塊'),
}
PENDING_STEMS = {'Zirconia', 'Anterior', 'Anterior Inlays', 'Zirconia Green', 'Zirconia Dark blue', 'Zirconia Black', 'Prettau 2 Dispersive'}
DISC = re.compile(r'^(?:[A-Z]{4}\d{4}i?\s+)?(.*?)[\s\-]*(9[58])X?H\s*(\d{2})(?:[\s\-]+(.+))?$')
BULLET = re.compile(r'^(Prettau \d Dispersive) 1H(\d{2}) (\S+) \(3pcs\)$')
def shade(s):
    s = (s or '').strip()
    return {'A35': 'A3.5'}.get(s, s) or '未染色'

unassigned = [x for x in catalog if not x.get('discontinued') and x.get('category') == '氧化鋯塊' and x['code'] not in owned]
groups = OrderedDict(); pending = []; bullets = []; collisions = []
for x in unassigned:
    name = x['name'].strip()
    b = BULLET.match(name)
    if b:
        bullets.append((x, b.group(1), b.group(2), b.group(3))); continue
    m = DISC.match(name)
    if not m: pending.append((x, '名稱結構不同')); continue
    stem = m.group(1).strip()
    key = (x['brand'], stem)
    if key not in SERIES:
        pending.append((x, '待確認是哪一款' if stem in PENDING_STEMS else f'未列入規則：{stem}')); continue
    fid, sname = SERIES[key]
    sh = 'Bleach 0M1' if stem.endswith('Bleach OM1') else shade(m.group(4))
    g = groups.setdefault(fid, {'id': fid, 'name': sname, 'brand': x['brand'], 'erp': set(), 'rows': {}})
    g['erp'].add(stem)
    k = (m.group(2), m.group(3), sh)
    if k in g['rows']: collisions.append((fid, k, g['rows'][k], x['code'])); continue
    g['rows'][k] = x['code']

SHADE_ORDER = ['未染色', 'Bleach 0M1', '0M1', '0M2', '0M3', 'OM1', 'OM2', 'OM3', 'A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4']
def order(vals, ref_order=None):
    vals = sorted(set(vals))
    if ref_order: vals.sort(key=lambda v: (ref_order.index(v) if v in ref_order else 999, v))
    return vals

new_families = []
for fid, g in groups.items():
    if fid in fam_ids: raise SystemExit(f'系列 id 已存在：{fid}')
    rows = g['rows']
    shades = order([k[2] for k in rows], SHADE_ORDER)
    has_shade = shades != ['未染色']
    specs = [{'key': '直徑', 'label': '直徑 (mm)', 'options': order(k[0] for k in rows)},
             {'key': '厚度', 'label': '厚度 (mm)', 'options': order(k[1] for k in rows)}]
    if has_shade: specs.append({'key': '顏色', 'label': '顏色', 'options': shades})
    base = g['name'].replace(' 氧化鋯塊', '')
    sku_map = OrderedDict()
    for (d, t, s) in sorted(rows, key=lambda k: (k[0], k[1], SHADE_ORDER.index(k[2]) if k[2] in SHADE_ORDER else 999, k[2])):
        sku_map['|'.join([d, t, s] if has_shade else [d, t])] = rows[(d, t, s)]
    new_families.append({
        'id': fid, 'seriesCode': fid, 'seriesName': g['name'], 'brand': g['brand'], 'productType': '材料', 'category': '氧化鋯塊',
        'skuPattern': '', 'namePattern': f"{base} {{直徑}}H{{厚度}}" + (' {顏色}' if has_shade else ''),
        'specs': specs, 'skuMap': sku_map,
    })
# 子彈型夾具：一維「規格」，與同名圓盤系列分開
by_line = defaultdict(list)
for x, line, th, sh in bullets: by_line[line].append((x, th, sh))
for line, items in by_line.items():
    fid = 'ZZ-' + line.upper().replace(' ', '-') + '-BULLET'
    if fid in fam_ids: raise SystemExit(f'系列 id 已存在：{fid}')
    opts = OrderedDict((f'H{th} {shade(sh)}（3 入）', x['code']) for x, th, sh in sorted(items, key=lambda a: (a[1], a[2])))
    new_families.append({
        'id': fid, 'seriesCode': fid, 'seriesName': f'{line} 子彈型夾具', 'brand': 'Zirkonzahn', 'productType': '材料', 'category': '氧化鋯塊',
        'skuPattern': '', 'namePattern': f'{line} 子彈型夾具 {{規格}}',
        'specs': [{'key': '規格', 'label': '規格 / 型號', 'options': list(opts.keys())}], 'skuMap': opts,
    })

# ── 檢查 ─────────────────────────────────────────────────────────
all_new = [c for fam in new_families for c in fam['skuMap'].values()]
assert len(all_new) == len(set(all_new)), '同一貨號被放進兩個系列'
assert not (set(all_new) & owned), '有貨號原本就屬於其他系列'
cat_codes = {x['code'] for x in catalog}
assert set(all_new) <= cat_codes, '系列裡有目錄不存在的貨號'
assert all(names_before[x['code']] == x['name'] for x in catalog), 'ERP 品名被改到了'
assert [x['code'] for x in catalog] == list(names_before.keys()), 'ERP 貨號或順序被改到了'

print(f"{'【寫入】' if WRITE else '【dry-run】'} 尚未歸系列的在售氧化鋯塊：{len(unassigned)}")
print(f'1. 改歸「內染液」：{len(recat)} 筆')
for c, n, b, a in recat: print(f'     {c}｜{n}｜{b[0]} → {a[0]}')
print(f'2. 新建系列：{len(new_families)} 個，涵蓋 {len(all_new)} 個貨號')
for fam in new_families:
    ax = '、'.join(f"{s['label']} {len(s['options'])} 種" for s in fam['specs'])
    first = next(iter(fam['skuMap'].items()))
    print(f"     {fam['id']}｜{fam['seriesName']}｜{len(fam['skuMap'])} 個貨號｜{ax}｜例 {first[0]} → {first[1]}")
print(f'3. 規格重複、未放入系列：{len(collisions)}')
for fid, k, a, b in collisions: print(f'     {fid} {k}: 已有 {a}，略過 {b}')
print(f'4. 先不處理：{len(pending)} 筆')
from collections import Counter
for reason, n in Counter(r for _, r in pending).items(): print(f'     {reason}：{n}')
for x, r in pending: print(f"       {x['code']}｜{x['name']}")

if WRITE:
    json.dump(catalog, open(CATALOG, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    fam_raw = open(FAMILIES, encoding='utf-8').read()
    indent = 1 if fam_raw.startswith('[\n {') else 2
    out = json.dumps(families + new_families, ensure_ascii=False, indent=indent)
    open(FAMILIES, 'w', encoding='utf-8').write(out + ('\n' if fam_raw.endswith('\n') else ''))
    print('已寫入', CATALOG, '與', FAMILIES)
