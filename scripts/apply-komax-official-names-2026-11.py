#!/usr/bin/env python3
"""KO-MAX 吸塵器全系列原廠已由 Silence 改名 SORINO（https://ko-maxkorea.com/products-type/sorino，2026-11-11 查證）。
在目錄加上「官方標準名」officialName；ERP 貨號（code）與 ERP 品名（name）一個字都不動。
K3N／K4N 的現行原廠型號是 K3 Pro／K4 Pro（使用者確認）。
用法：python3 scripts/apply-komax-official-names-2026-11.py [--write]"""
import json, sys
WRITE = '--write' in sys.argv
P = 'data/catalog/products_catalog.json'
cat = json.load(open(P, encoding='utf-8'))
before = [(x['code'], x['name']) for x in cat]
n = 0
for x in cat:
    if x.get('brand') != 'KO-MAX' or 'Silence' not in x['name']: continue
    official = x['name'].replace('Silence', 'SORINO').replace('SORINO K3N', 'SORINO K3 Pro').replace('SORINO K4N', 'SORINO K4 Pro')
    print(f"{x['code']}｜ERP 品名：{x['name']}｜官方標準名：{official}")
    x['officialName'] = official; n += 1
assert before == [(x['code'], x['name']) for x in cat], 'ERP 貨號或品名被改到了'
print(('已寫入 ' if WRITE else '預計 ') + f'{n} 筆')
if WRITE: json.dump(cat, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
