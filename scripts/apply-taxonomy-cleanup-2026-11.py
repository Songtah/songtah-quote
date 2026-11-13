#!/usr/bin/env python3
"""產品分類清理（2026-11-13，依全品項找圖時查到的原廠資料）。只改分類欄位、補官方名稱、把散落單品收進既有系列；
不改 ERP 貨號與 ERP 品名、不改價格與停售狀態。
用法：python3 scripts/apply-taxonomy-cleanup-2026-11.py [--write]"""
import json, re, sys, collections
WRITE = '--write' in sys.argv
CF, FF = 'data/catalog/products_catalog.json', 'data/catalog/product_families.json'
craw, fraw = open(CF, encoding='utf-8').read(), open(FF, encoding='utf-8').read()
cat, fams = json.loads(craw), json.loads(fraw)
by = {x['code']: x for x in cat}
tx = json.load(open('data/product-taxonomy.json', encoding='utf-8'))
F = {f['id']: f for f in tx['funcCategories']}
act = [x for x in cat if not x.get('discontinued')]

# ── A. 分類放錯 ──（功能分類 id, 商品型態, 選取條件, 依據）
RULES = [
  ('bur-drill', '耗材', lambda x: x['category'] == 'PMMA 塊' and re.search(r'\bbur\b', x['name'], re.I), 'Zirkonzahn PMMA 用銑刀，不是 PMMA 塊'),
  ('wax-pressing-material', '材料', lambda x: x['code'].startswith('YMH-') and x['category'] == '瓷粉／陶瓷材料' and re.search(r'\bwax\b', x['name'], re.I), '山八石蠟／鑄造蠟／蠟條（日本通路品名パラフィンワックス等）'),
  ('wax-pressing-material', '材料', lambda x: x['code'] == 'YMH-23', 'Pattern Bright 為鑄造用圖樣樹脂（官網パターンブライト）'),
  ('resin-material', '材料', lambda x: x['code'].startswith('YMH-24-') and x['category'] == '瓷粉／陶瓷材料', 'RE-Fine EX 為義齒修補樹脂'),
  ('investment-gypsum', '材料', lambda x: x['code'] in ('YMH-19', 'YMH-20'), 'Neo White 為磷酸鹽系鑄造包埋材（包裝標示 Phosphate-Bonded Casting Investment）'),
  ('dental-instrument', '耐用工具／器械', lambda x: x['code'] in ('ZZ-SIAK0001', 'ZZ-SIAK1001', 'ZZ-SIAK6001'), '扭力扳手／起子組為器械'),
  ('pmma-blank', '材料', lambda x: x['code'] == 'ZZ-TMAR0216', 'Screw Blank 為 Temp Basic 樹脂盤（官網 TMAR 編號）'),
  ('implant-component', '配件', lambda x: x['category'] == '掃描儀' and re.search(r'scan ?marker|scan ?analog|scan ?body', x['name'], re.I), '掃描桿／掃描替代體為植體掃描配件，不是掃描機'),
  ('optical-equipment', '設備', lambda x: x['code'] in ('OT-COBRA',) or (x['category'] == '掃描儀' and re.search(r'shade scan|比色機', x['name'], re.I)), '比色機為光學量測設備'),
  ('optical-equipment', '設備', lambda x: x['code'] == 'SY-08100', '比色燈為光學設備'),
  ('polishing-consumable', '耗材', lambda x: x['code'].startswith('CA-YD-T') and x['category'] == '套裝組', 'Youdent 瓷／樹脂拋光套裝（經銷商 Dentalkart 標 Porcelain Polishing Kit）'),
  ('metal-material', '材料', lambda x: x['code'] in ('GEN-10-14T', 'GEN-10-20T'), '鈦盤為切削用金屬材料'),
  ('process-liquid', '耗材', lambda x: x['code'] == 'DK-26', '車機冷卻液為製程藥劑'),
  ('external-stain', '材料', lambda x: x['code'].startswith('DSD-ZR-STAIN') or x['code'] == 'DSD-ZR-06', 'ZR Stain 為氧化鋯外染色料'),
  ('ceramic-brush', '耐用工具／器械', lambda x: x['code'] == 'DSD-03', 'Propaque Brush 為瓷筆'),
]
changes = collections.defaultdict(list)
for fid, pt, cond, why in RULES:
    f = F[fid]
    for x in act:
        if not cond(x): continue
        new = dict(category=f['name'], categoryId=f['id'], mainCategory=f['mainName'], mainCategoryId=f['mainId'], productType=pt)
        if all(x.get(k) == v for k, v in new.items()): continue
        changes[why].append((x['code'], x['name'], x['category'], f['name']))
        if WRITE: x.update(new)
print('A. 分類修正')
for why, xs in changes.items():
    print(f'   {why}：{len(xs)} 筆（{xs[0][2]} → {xs[0][3]}）例：{xs[0][0]} {xs[0][1]}')
print(f'   合計 {sum(len(v) for v in changes.values())} 筆')

# ── B. 錯字 → 官方名稱（只修正錯字本身，其餘照 ERP 品名；已有官方名稱者不覆蓋）──
FIX = [(r'Antomic', 'Anatomic'), (r'Pcrcelain', 'Porcelain'), (r'Mastra', 'Mestra'), (r'Provfine', 'Provifine'), (r'Color Luquid', 'Colour Liquid'),
       (r'Luquid', 'Liquid'), (r'Paralell', 'Parallel'), (r'Nertral', 'Neutral'), (r'Primner', 'Primer'), (r'lnstrument', 'Instrument'),
       (r'[Ff]unace', 'Furnace'), (r'Posltion', 'Position'), (r'Liquide\b', 'Liquid'), (r'Coollant', 'Coolant'), (r'Premiun', 'Premium')]
fixed = []
for x in act:
    if x.get('officialName'): continue
    n = x['name']
    for a, b in FIX: n = re.sub(a, b, n)
    if n != x['name']:
        fixed.append((x['code'], x['name'], n))
        if WRITE: x['officialName'] = n
print(f'B. 錯字修正為官方名稱：{len(fixed)} 筆；例：', '；'.join(f'{a}「{b}」→「{c}」' for a, b, c in fixed[:5]))

# ── C. 散落單品收進既有系列（一維規格系列，key＝ERP 品名）──
ADD = {'NAME-620459BB27D6': [c for c in by if re.fullmatch(r'ZZ-62-\w+', c)], 'NAME-55CFCD77514D': ['YMH-05-5']}
famby = {f['id']: f for f in fams}
inany = {c for f in fams for c in list((f.get('skuMap') or {}).values()) + (f.get('coveredSkuCodes') or []) + (f.get('manualAssignedSkuCodes') or [])}
added = []
for fid, codes in ADD.items():
    f = famby[fid]; assert len(f['specs']) == 1
    for c in codes:
        if c not in by or by[c].get('discontinued') or c in inany: continue
        k = by[c]['name']
        assert k not in f['skuMap']
        added.append((fid, c, k))
        if WRITE: f['skuMap'][k] = c; f['specs'][0]['options'].append(k)
# YMH-PMMA 三維：PMMA Clear 98.5×20
if 'YMH-40-20' in by and 'YMH-40-20' not in inany and '98.5|Clear|20' not in famby['YMH-PMMA']['skuMap']:
    added.append(('YMH-PMMA', 'YMH-40-20', '98.5|Clear|20'))
    if WRITE: famby['YMH-PMMA']['skuMap']['98.5|Clear|20'] = 'YMH-40-20'
print(f'C. 散落單品收進系列：{len(added)} 筆')
for a in added: print('   ', a)

allc = [c for f in fams for c in (f.get('skuMap') or {}).values()]
dup = [c for c, n in collections.Counter(allc).items() if n > 1]
print('系列重複歸屬檢查：', dup[:5] or '無')
if WRITE:
    orig = {x['code']: x for x in json.loads(craw)}
    assert all(by[c]['name'] == orig[c]['name'] and by[c].get('price') == orig[c].get('price') and by[c].get('discontinued') == orig[c].get('discontinued') for c in orig), 'ERP 品名／價格／停售被改到'
    open(CF, 'w', encoding='utf-8').write(json.dumps(cat, ensure_ascii=False, indent=1 if craw.startswith('[\n {') else 2) + ('\n' if craw.endswith('\n') else ''))
    open(FF, 'w', encoding='utf-8').write(json.dumps(fams, ensure_ascii=False, indent=1 if fraw.startswith('[\n {') else 2) + ('\n' if fraw.endswith('\n') else ''))
    print('已寫入')
