#!/usr/bin/env python3
"""新增兩個「ERP 還沒有料號」的品項（使用者 2026-11-11 指示：先建品項，ERP 料號留白之後處理）。
產品目錄以 code 當主鍵不能留空，所以先用 NOERP- 開頭的暫時代號並標 erpPending；
拿到 ERP 料號後把 code 換成正式料號、name 換成 ERP 品名、拿掉 erpPending 即可。
來源：https://www.zebris.de/en/welcome-to-the-world-of-functional-digital-dentistry
      https://www.straumann.com/en/dental-professionals/digital/equipment/io-scanners/straumann-sirios-x3.html
用法：python3 scripts/add-pending-erp-products-2026-11.py [--write]"""
import json, sys
WRITE = '--write' in sys.argv
P = 'data/catalog/products_catalog.json'
cat = json.load(open(P, encoding='utf-8'))
by = {x['code']: x for x in cat}
def like(ref, **kw):
    r = by[ref]
    return {**kw, **{k: r[k] for k in ('productType', 'category', 'mainCategory', 'mainCategoryId', 'categoryId')}, 'erpPending': True}
NEW = [
    like('WM-211-01', code='NOERP-ZEBRIS-JMA-OPTIC', name='zebris JMA-Optic 電子面弓', officialName='JMA-Optic 電子面弓', brand='zebris'),
    like('CAD-79051', code='NOERP-STRAUMANN-SIRIOS-X3', name='Straumann SIRIOS X3 口內掃描機', officialName='SIRIOS X3 口內掃描機', brand='Straumann'),
]
for x in NEW:
    if x['code'] in by: print('已存在，略過：', x['code']); continue
    order = ['code', 'name', 'officialName', 'brand', 'productType', 'category', 'mainCategory', 'mainCategoryId', 'categoryId', 'erpPending']
    cat.append({k: x[k] for k in order}); print(('新增 ' if WRITE else '預計新增 ') + json.dumps(x, ensure_ascii=False))
if WRITE: json.dump(cat, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
