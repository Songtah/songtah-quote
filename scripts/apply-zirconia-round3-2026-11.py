#!/usr/bin/env python3
"""氧化鋯塊系列第三輪（使用者 2026-11-11 逐項確認）。只動系列歸屬與系列名稱，不改 ERP 貨號與品名。
  1. ERP 品名「Zirconia 95H/98H..」（原廠料號 ZRAB）→ 新系列 ICE Zirkon Translucent；兩筆 98H16 使用者指示先不動
  2. 「Prettau Anterior 氧化鋯塊」5 筆 98 盤併入 Prettau 4 Anterior（未染色），原系列移除
  3. Green／Dark blue／Black → 新系列 Zirconia Creative
  4. Prettau 3 系列改名 Prettau 3 Dispersive（官網無單稱 Prettau 3 的產品線）
用法：python3 scripts/apply-zirconia-round3-2026-11.py [--write]"""
import json, re, sys
WRITE = '--write' in sys.argv
F = 'data/catalog/product_families.json'
cat = {x['code']: x for x in json.load(open('data/catalog/products_catalog.json', encoding='utf-8'))}
raw = open(F, encoding='utf-8').read()
fams = json.loads(raw)
by = {f['id']: f for f in fams}
def owned():
    return {c for f in fams for c in list((f.get('skuMap') or {}).values()) + list(f.get('coveredSkuCodes') or []) + list(f.get('manualAssignedSkuCodes') or [])}
def base(fid, name, pattern, specs, sku_map):
    assert fid not in by, fid
    return {'id': fid, 'seriesCode': fid, 'seriesName': name, 'brand': 'Zirkonzahn', 'productType': '材料', 'category': '氧化鋯塊',
            'skuPattern': '', 'namePattern': pattern, 'specs': specs, 'skuMap': sku_map}

# 1. ICE Zirkon Translucent
HOLD = {'ZZ-999-020-98H16', 'ZZ-999-025-98H16'}
ice = {}
for code, x in cat.items():
    m = re.match(r'^ZRAB\d{4} Zirconia (9[58])H(\d{2})$', x['name'].strip())
    if not m or code in HOLD: continue
    assert code not in owned() and not x.get('discontinued') and x['category'] == '氧化鋯塊', code
    k = f'{m.group(1)}|{m.group(2)}'; assert k not in ice, k
    ice[k] = code
ice = dict(sorted(ice.items()))
f_ice = base('ZZ-ICE-ZIRKON-TRANSLUCENT', 'ICE Zirkon Translucent 氧化鋯塊', 'ICE Zirkon Translucent {直徑}H{厚度}',
             [{'key': '直徑', 'label': '直徑 (mm)', 'options': sorted({k.split('|')[0] for k in ice})},
              {'key': '厚度', 'label': '厚度 (mm)', 'options': sorted({k.split('|')[1] for k in ice})}], ice)
print(f"1. 新系列 {f_ice['seriesName']}：{len(ice)} 個貨號；先不動：{sorted(HOLD)}")
for k, c in ice.items(): print(f"     {k} → {c}｜{cat[c]['name']}")

# 2. Prettau Anterior 98 盤併入 Prettau 4 Anterior
old = by['ZZ-PRETTAU-ANTERIOR']; p4 = by['ZZ-PRETTAU-4-ANTERIOR']
print(f"2. 「{old['seriesName']}」{len(old['skuMap'])} 筆併入「{p4['seriesName']}」，原系列移除")
for k, c in old['skuMap'].items():
    nk = k + '|未染色'; assert nk not in p4['skuMap'], nk
    p4['skuMap'][nk] = c; print(f"     {nk} → {c}｜{cat[c]['name']}")
for s in p4['specs']:
    i = {'直徑': 0, '厚度': 1}.get(s['key'])
    if i is not None: s['options'] = sorted(set(s['options']) | {k.split('|')[i] for k in p4['skuMap']})
fams.remove(old)
print(f"     併入後 {len(p4['skuMap'])} 個貨號；厚度 {p4['specs'][1]['options']}")

# 3. Zirconia Creative
cre = {}
for code in ['ZZ-999-033-01', 'ZZ-999-033-06', 'ZZ-999-033-08']:
    x = cat[code]; m = re.match(r'^ZRA[TYZ]\d{4} Zirconia (.+) (9[58])H(\d{2})$', x['name'].strip())
    assert m and code not in owned() and not x.get('discontinued'), code
    cre[f'{m.group(1)} {m.group(2)}H{m.group(3)}'] = code
f_cre = base('ZZ-ZIRCONIA-CREATIVE', 'Zirconia Creative 彩色氧化鋯塊', 'Zirconia Creative {規格}',
             [{'key': '規格', 'label': '規格 / 型號', 'options': list(cre)}], cre)
print(f"3. 新系列 {f_cre['seriesName']}：{len(cre)} 個貨號")
for k, c in cre.items(): print(f"     {k} → {c}｜{cat[c]['name']}")

# 4. Prettau 3 改名
p3 = by['ZZ-PRETTAU-3']
print(f"4. 改名：{p3['seriesName']} → Prettau 3 Dispersive 氧化鋯塊")
p3['seriesName'] = 'Prettau 3 Dispersive 氧化鋯塊'
p3['namePattern'] = p3['namePattern'].replace('Prettau 3 {', 'Prettau 3 Dispersive {')
print('     名稱樣式：', p3['namePattern'])

fams += [f_ice, f_cre]
allc = [c for f in fams for c in (f.get('skuMap') or {}).values()]
new = list(ice.values()) + list(cre.values())
assert len(new) == len(set(new)) and all(allc.count(c) == 1 for c in new + list(old['skuMap'].values()))
print(f'系列總數 {len(fams)}')
if WRITE:
    indent = 1 if raw.startswith('[\n {') else 2
    open(F, 'w', encoding='utf-8').write(json.dumps(fams, ensure_ascii=False, indent=indent) + ('\n' if raw.endswith('\n') else ''))
    print('已寫入', F)
