#!/usr/bin/env python3
"""ASIGA 系列重新分組（使用者 2026-11-11 確認）。只動系列歸屬與系列名稱，不改 ERP 貨號與品名。
  1. 樹脂：比照 Detax Freeprint 的分法，一個系列、用「品項／顏色」兩個規格選
  2. 料槽、配件、維修料件三類各自獨立，每類再依機型（MAX／PRO／Ultra）拆開
     - 光固化機燈管歸維修料件（使用者指示）
     - 校正工具包品名沒寫機型，維持單品不歸系列
  3. 列印機、後固化設備不動
所有貨號都保留；使用者之後要再刪減品項。
用法：python3 scripts/apply-asiga-series-2026-11.py [--write]"""
import json, sys
WRITE = '--write' in sys.argv
F = 'data/catalog/product_families.json'
cat = {x['code']: x for x in json.load(open('data/catalog/products_catalog.json', encoding='utf-8'))}
raw = open(F, encoding='utf-8').read()
fams = json.loads(raw)
by = {f['id']: f for f in fams}
before = {c for f in fams if f['id'].startswith('AG-') for c in f['skuMap'].values()}

# ── 1. 樹脂：品項（原廠材料名＋用途）／顏色 ──
RESIN = [  # (品項, 顏色或 None, 貨號)
    ('DentaTOOTH 牙冠', 'A1', 'AG-03624'), ('DentaTOOTH 牙冠', 'A2', 'AG-03625'), ('DentaTOOTH 牙冠', 'A3', 'AG-03626'),
    ('DentaTOOTH 牙冠', '未標色號', 'AG-03810'),
    ('DentaTRY 試戴', 'A1', 'AG-03768'), ('DentaTRY 試戴', 'A2', 'AG-03817'),
    ('DentaBASE 義齒基底', 'N1', 'AG-03569'),
    ('DentaGUM 牙齦', None, 'AG-03653'),
    ('DentaGUIDE 手術導板', None, 'AG-04504'),
    ('DentaCAST 鑄造', None, 'AG-04748'),
    ('DentaTRAY 個人牙托', 'Orange', 'AG-07862'),
    ('DentaMODEL 模型', None, 'AG-03000'),
    ('DentaSTUDY 研究模型', None, 'AG-05367'),
    ('DentaFORM 熱壓成型模型', 'Beige', 'AG-07876'), ('DentaFORM 熱壓成型模型', 'Grey', 'AG-05167'),
    ('Plas V2', 'Clear', 'AG-00930'), ('Plas V2', 'Gray', 'AG-00928'), ('Plas V2', 'Pink', 'AG-00929'), ('Plas V2', 'White', 'AG-00931'),
    ('FusionGRAY V2', None, 'AG-01329'),
]
resin = by['AG-PRINT-RESIN']
assert {c for _, _, c in RESIN} == set(resin['skuMap'].values()), '樹脂貨號與現有系列不一致'
items, colours, sku = [], [], {}
for item, col, code in RESIN:
    if item not in items: items.append(item)
    if col and col not in colours: colours.append(col)
    sku[f'{item}|{col}' if col else item] = code
resin['specs'] = [{'key': '品項', 'label': '品項', 'options': items}, {'key': '顏色', 'label': '顏色', 'options': colours}]
resin['skuMap'] = sku
resin['namePattern'] = '{品項} {顏色}'
print(f"1. {resin['seriesName']}：{len(sku)} 個貨號，品項 {len(items)} 種、顏色 {len(colours)} 種")
for k, c in sku.items(): print(f"     {k} → {c}｜{cat[c]['name']}")

# ── 2. 料槽／配件／維修料件：各自獨立，再依機型拆 ──
SPLIT = {
    'AG-PRINT-CONSUMABLE': [
        ('AG-TRAY-MAX', 'ASIGA MAX 料槽', ['AG-02499', 'AG-02500', 'AG-02501', 'AG-02502', 'AG-0044', 'AG-05220', 'AG-05864', 'AG-07741', 'AG-07650', 'AG-07950']),
        ('AG-TRAY-PRO', 'ASIGA PRO 料槽', ['AG-04569', 'AG-04570', 'AG-04571', 'AG-05868', 'AG-07788', 'AG-07789']),
        ('AG-TRAY-ULTRA', 'ASIGA Ultra 料槽', ['AG-07419', 'AG-07647', 'AG-07422', 'AG-07957']),
    ],
    'AG-PRINTER-ACCESSORY': [
        ('AG-ACCESSORY-MAX', 'ASIGA MAX 配件', ['AG-02479', 'AG-04248', 'AG-05359', 'AG-0077', 'AG-07951']),
        ('AG-ACCESSORY-PRO', 'ASIGA PRO 配件', ['AG-05226', 'AG-05565']),
        ('AG-ACCESSORY-ULTRA', 'ASIGA Ultra 配件', ['AG-07063', 'AG-07440', 'AG-07956']),
    ],
    'AG-SPARE-PART': [
        ('AG-SPARE-MAX', 'ASIGA MAX 維修料件', ['AG-01407', 'AG-07458']),
        ('AG-SPARE-ULTRA', 'ASIGA Ultra 維修料件', ['AG-08114', 'AG-05899', 'AG-08110', 'AG-08111', 'AG-07035']),
        ('AG-SPARE-OTHER', 'ASIGA 其他維修料件', ['AG-07446', 'AG-07391', 'AG-07514', 'AG-02551', 'AG-00194-1']),
    ],
}
STANDALONE = {'AG-07570'}  # 校正工具包：品名沒寫機型，維持單品
new_fams = []
print('2. 料槽／配件／維修料件')
for old_id, groups in SPLIT.items():
    old = by[old_id]
    label = {c: k for k, c in old['skuMap'].items()}   # 沿用原本的選項文字（即 ERP 品名）
    used = set()
    for fid, name, codes in groups:
        assert fid not in by
        m = {label[c]: c for c in codes}
        assert len(m) == len(codes)
        used |= set(codes)
        nf = {k: v for k, v in old.items() if k not in ('specs', 'skuMap')}
        nf.update({'id': fid, 'seriesCode': fid, 'seriesName': name,
                   'specs': [{'key': '規格', 'label': '規格 / 型號', 'options': list(m)}], 'skuMap': m})
        new_fams.append(nf)
        print(f'   {name}（{len(m)}）')
        for k, c in m.items(): print(f'     {c}｜{k}')
    left = set(old['skuMap'].values()) - used
    assert left <= STANDALONE, f'{old_id} 有貨號沒分到：{left}'
    for c in left: print(f"   單品（不歸系列）：{c}｜{cat[c]['name']}")
    fams.remove(old)
    print(f"   移除舊系列：{old['seriesName']}")
fams += new_fams

after = {c for f in fams if f['id'].startswith('AG-') for c in f['skuMap'].values()}
allc = [c for f in fams for c in (f.get('skuMap') or {}).values()]
assert before - after == STANDALONE and after <= before, '貨號有增減'
assert all(allc.count(c) == 1 for c in after), '有貨號重複歸系列'
print(f'ASIGA 貨號 {len(before)} 個：歸系列 {len(after)}、單品 {len(before - after)}；系列總數 {len(fams)}')
if WRITE:
    indent = 1 if raw.startswith('[\n {') else 2
    open(F, 'w', encoding='utf-8').write(json.dumps(fams, ensure_ascii=False, indent=indent) + ('\n' if raw.endswith('\n') else ''))
    print('已寫入', F)
