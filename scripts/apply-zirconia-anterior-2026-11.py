#!/usr/bin/env python3
"""把 ERP 品名只寫「Anterior 95H..」的 5 個貨號併入「Prettau 4 Anterior 氧化鋯塊」系列（未染色）。
使用者 2026-11-11 確認這 5 筆是 Prettau 4 Anterior。只動系列歸屬，不改 ERP 貨號與品名。
用法：python3 scripts/apply-zirconia-anterior-2026-11.py [--write]"""
import json, re, sys
WRITE = '--write' in sys.argv
F = 'data/catalog/product_families.json'
cat = {x['code']: x for x in json.load(open('data/catalog/products_catalog.json', encoding='utf-8'))}
raw = open(F, encoding='utf-8').read()
fams = json.loads(raw)
fam = next(f for f in fams if f['id'] == 'ZZ-PRETTAU-4-ANTERIOR')
owned = {c for f in fams for c in list((f.get('skuMap') or {}).values()) + list(f.get('coveredSkuCodes') or []) + list(f.get('manualAssignedSkuCodes') or [])}
add = []
for code in ['ZZ-999-027-95H10', 'ZZ-999-027-95H12', 'ZZ-999-027-95H16', 'ZZ-999-027-95H18', 'ZZ-999-027-95H22']:
    x = cat[code]
    m = re.search(r'Anterior (9[58])H(\d{2})$', x['name'].strip())
    assert m and code not in owned and not x.get('discontinued'), code
    key = f'{m.group(1)}|{m.group(2)}|未染色'
    assert key not in fam['skuMap'], key
    add.append((key, code, x['name']))
for key, code, name in add:
    print(('寫入 ' if WRITE else '預計 ') + f'{key} → {code}｜{name}')
    fam['skuMap'][key] = code
th = next(s for s in fam['specs'] if s['key'] == '厚度')
th['options'] = sorted(set(th['options']) | {k.split('|')[1] for k, _, _ in add})
print('厚度選項：', th['options'], '｜系列貨號數：', len(fam['skuMap']))
if WRITE:
    indent = 1 if raw.startswith('[\n {') else 2
    open(F, 'w', encoding='utf-8').write(json.dumps(fams, ensure_ascii=False, indent=indent) + ('\n' if raw.endswith('\n') else ''))
    print('已寫入', F)
