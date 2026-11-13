#!/usr/bin/env python3
"""拆分「設備配件」（2026-11-13 使用者同意方案；超音波潔牙機算設備、噴砂機噴頭／噴筆算耗材）。
1. 實為機台換修料件 → 維修零件（依品牌）
2. 用完要補的 → 新功能分類「設備耗材」（技工製程與耗材）；除臭片 → 過濾耗材
3. 超音波潔牙機 → 清潔／吸塵設備
坩堝一律算耗材，連同原本誤標「設備」的 Super Cascom／Neo Super Cascom／K-CRUCIBLE 坩堝一起改。
只改分類欄位與字典；不改 ERP 貨號／品名、價格、停售狀態。
用法：python3 scripts/apply-equipment-accessory-split-2026-11.py [--write]"""
import json, re, sys, collections
WRITE = '--write' in sys.argv
CF, TF = 'data/catalog/products_catalog.json', 'data/product-taxonomy.json'
cat, tx = (json.load(open(p, encoding='utf-8')) for p in (CF, TF))
before = {x['code']: (x['name'], x.get('price'), x.get('discontinued')) for x in cat}
by = {x['code']: x for x in cat}

def ensure(fid, name, mid, mname):
    if not any(f['id'] == fid for f in tx['funcCategories']):
        tx['funcCategories'].append({'id': fid, 'name': name, 'mainId': mid, 'mainName': mname})
    return fid
for b, s in (('DENKEN', 'denken'), ('URAWA', 'urawa')):
    ensure(f'spare-part-{s}', f'{b} 維修零件', 'spare-parts', '維修零件')
ensure('equipment-consumable', '設備耗材', 'lab-production', '技工製程與耗材')
F = {f['id']: f for f in tx['funcCategories']}

PLAN = [  # (功能分類, 商品型態, 貨號)
  ('spare-part-ko-max', '維修料件', ['KM-013', 'KM-014', 'KM-016', 'KM-020', 'KM-021', 'KM-022', 'KM-026', 'KM-027-1']),
  ('spare-part-denken', '維修料件', ['DK-16-19', 'DK-ZRCM-020902', 'DK-ZRCM-021102', 'DK-ZRCM-020901', 'DK-ZRCM-021001', 'DK-04-03']),
  ('spare-part-urawa', '維修料件', ['UW-08']),
  ('equipment-consumable', '耗材', ['DK-04-01', 'DK-04-01-1', 'DK-04-02', 'DK-24-1', 'DK-24-2', 'DK-24-3', 'DK-24-4',
                                    'DK-08-01', 'DK-08-02', 'DK-11-1', 'DK-11-2', 'SY-04160', 'SY-04163',
                                    'YMH-22-1', 'YMH-22-2', 'DK-18', 'BS-08', 'BS-09',
                                    'MT-080240-12', 'MT-080240-13', 'MT-080262-40', 'MT-080262-41']),
  ('filter-consumable', '耗材', ['DK-02-1']),
  ('cleaning-dust-control', '設備', ['SY-04210']),
]
log = collections.Counter()
for fid, pt, codes in PLAN:
    f = F[fid]
    for c in codes:
        x = by[c]
        assert not x.get('discontinued'), c
        log[(x['category'], x['productType'], f['name'], pt)] += 1
        x.update(category=f['name'], categoryId=f['id'], mainCategory=f['mainName'], mainCategoryId=f['mainId'], productType=pt)
for (a, ap, b, bp), n in log.items(): print(f'{a}（{ap}）→ {b}（{bp}）：{n}')
print('合計', sum(log.values()), '筆')
assert all((x['name'], x.get('price'), x.get('discontinued')) == before[x['code']] for x in cat)
if WRITE:
    for p, d in ((CF, cat), (TF, tx)):
        raw = open(p, encoding='utf-8').read()
        ind = 1 if re.match(r'[\[{]\n [{"]', raw) else 2
        open(p, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=ind) + ('\n' if raw.endswith('\n') else ''))
    print('已寫入')
else:
    print('（dry-run，加 --write 才寫入）')
