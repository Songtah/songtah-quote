#!/usr/bin/env python3
"""維修零件獨立成大分類（2026-11-13 使用者指示：「零件都幫我歸類到獨立分類」「維修料件的分類可以依照品牌分」）。
- 新增主分類 spare-parts「維修零件」，底下依品牌分功能分類（例：ASIGA 維修零件）。
- 商品型態＝維修料件的在售品項移過去；Zirkonzahn 植體螺絲不是設備零件，改回「配件」、留在植體配件。
- 只改分類欄位與字典；不改 ERP 貨號／品名、價格、停售狀態。
用法：python3 scripts/apply-spare-parts-category-2026-11.py [--write]"""
import json, re, sys, collections
WRITE = '--write' in sys.argv
CF, FF, TF = 'data/catalog/products_catalog.json', 'data/catalog/product_families.json', 'data/product-taxonomy.json'
cat, fams, tx = (json.load(open(p, encoding='utf-8')) for p in (CF, FF, TF))
before = {x['code']: (x['name'], x.get('price'), x.get('discontinued')) for x in cat}
MAIN_ID, MAIN_NAME = 'spare-parts', '維修零件'
slug = lambda b: re.sub(r'[^a-z0-9]+', '-', b.lower()).strip('-')

parts = [x for x in cat if not x.get('discontinued') and x.get('productType') == '維修料件']
screws = [x for x in parts if x['code'].startswith('ZZ-') and x['category'] == '植體配件']
move = [x for x in parts if x not in screws]

# 字典：主分類插在「待人工確認」前；品牌功能分類
if not any(m['id'] == MAIN_ID for m in tx['mainCategories']):
    i = next(k for k, m in enumerate(tx['mainCategories']) if m['id'] == 'other-review')
    tx['mainCategories'].insert(i, {'id': MAIN_ID, 'name': MAIN_NAME})
fc = {f['id']: f for f in tx['funcCategories']}
newcat = {}
for b in sorted({x['brand'] for x in move}):
    fid = f'spare-part-{slug(b)}'
    newcat[b] = fc.get(fid) or {'id': fid, 'name': f'{b} 維修零件', 'mainId': MAIN_ID, 'mainName': MAIN_NAME}
    if fid not in fc: tx['funcCategories'].append(newcat[b])

moved = collections.Counter()
for x in move:
    f = newcat[x['brand']]
    moved[(x['category'], f['name'])] += 1
    x.update(category=f['name'], categoryId=f['id'], mainCategory=MAIN_NAME, mainCategoryId=MAIN_ID)
for x in screws: x['productType'] = '配件'

# 舊的「列印機維修料件」清空後從字典移除
left = [x for x in cat if x.get('categoryId') == 'printer-spare-part' or x.get('category') == '列印機維修料件']
if not left: tx['funcCategories'] = [f for f in tx['funcCategories'] if f['id'] != 'printer-spare-part']

# 系列：ASIGA 維修料件三個 family 的分類跟著改
famfix = []
for f in fams:
    if f.get('category') == '列印機維修料件':
        f['category'] = newcat['ASIGA']['name']; famfix.append(f['id'])

print(f'維修料件在售 {len(parts)} 筆：移到「{MAIN_NAME}」{len(move)} 筆；植體螺絲改回配件 {len(screws)} 筆')
for (a, b), n in moved.items(): print(f'   {a} → {b}：{n}')
print('   新功能分類：', '、'.join(f['name'] for f in newcat.values()))
print('   系列分類同步：', famfix, '｜列印機維修料件剩', len(left), '筆')
assert all((x['name'], x.get('price'), x.get('discontinued')) == before[x['code']] for x in cat)
if WRITE:
    for p, d in ((CF, cat), (FF, fams), (TF, tx)):
        raw = open(p, encoding='utf-8').read()
        ind = 1 if re.match(r'[\[{]\n [{"]', raw) else 2
        open(p, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=ind) + ('\n' if raw.endswith('\n') else ''))
    print('已寫入')
else:
    print('（dry-run，加 --write 才寫入）')
