#!/usr/bin/env python3
"""Prettau 2 系列改名為 Prettau 2 Dispersive（使用者 2026-11-11 確認系列內都是 Prettau 2 Dispersive），
並把 ERP 品名本來就寫「Prettau 2 Dispersive 98H30 A2」的 ZZ-ZRKC3101A02 併入。不改 ERP 貨號與品名。
用法：python3 scripts/apply-zirconia-prettau2-2026-11.py [--write]"""
import json, sys
WRITE = '--write' in sys.argv
F = 'data/catalog/product_families.json'
cat = {x['code']: x for x in json.load(open('data/catalog/products_catalog.json', encoding='utf-8'))}
raw = open(F, encoding='utf-8').read(); fams = json.loads(raw)
p2 = next(f for f in fams if f['id'] == 'ZZ-PRETTAU-2')
shades = next(s for s in p2['specs'] if s['key'] == '顏色')['options']
print('現有', len(p2['skuMap']), '筆；顏色選項', shades)
print('改名：', p2['seriesName'], '→ Prettau 2 Dispersive 氧化鋯塊')
p2['seriesName'] = 'Prettau 2 Dispersive 氧化鋯塊'
if 'Dispersive' not in p2['namePattern']: p2['namePattern'] = p2['namePattern'].replace('Prettau 2 {', 'Prettau 2 Dispersive {')
code, key = 'ZZ-ZRKC3101A02', '98|30|A2'
owned = {c for f in fams for c in list((f.get('skuMap') or {}).values()) + list(f.get('coveredSkuCodes') or []) + list(f.get('manualAssignedSkuCodes') or [])}
assert cat[code]['name'].strip() == 'Prettau 2 Dispersive 98H30 A2' and code not in owned
if key in p2['skuMap']:
    print(f'規格 {key} 已有 {p2["skuMap"][key]}｜{cat[p2["skuMap"][key]]["name"]}，{code} 不併入')
else:
    p2['skuMap'][key] = code; print(f'併入 {key} → {code}｜{cat[code]["name"]}')
    for s in p2['specs']:
        i = {'直徑': 0, '厚度': 1}.get(s['key'])
        if i is not None: s['options'] = sorted(set(s['options']) | {k.split('|')[i] for k in p2['skuMap']})
print('名稱樣式', p2['namePattern'], '｜共', len(p2['skuMap']), '筆')
if WRITE:
    indent = 1 if raw.startswith('[\n {') else 2
    open(F, 'w', encoding='utf-8').write(json.dumps(fams, ensure_ascii=False, indent=indent) + ('\n' if raw.endswith('\n') else ''))
    print('已寫入')
