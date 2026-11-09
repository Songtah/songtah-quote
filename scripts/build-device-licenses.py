#!/usr/bin/env python3
"""
建立牙科類醫療器材許可證索引（法規合規監測用）。

來源：食藥署開放資料「醫療器材許可證資料集」（InfoId=68）
  https://data.fda.gov.tw/opendata/exportDataList.do?method=ExportData&InfoId=68&logType=2
只收主類別含「F 牙科學」者；輸出 data/compliance/device-licenses-dental.json（server-only 讀取）。
限制：只含「許可證」。2021 年後改採「登錄」制的第一等級品項不在此資料集，查無不等於違法。

用法：python3 scripts/build-device-licenses.py
"""
import csv, io, json, sys, subprocess, zipfile, datetime, pathlib

URL = 'https://data.fda.gov.tw/opendata/exportDataList.do?method=ExportData&InfoId=68&logType=2'
OUT = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'compliance' / 'device-licenses-dental.json'

def main():
    # 用 curl 下載（本機 Python 常缺根憑證；不關閉憑證驗證）
    raw = subprocess.run(['curl', '-sSL', '--fail', '-m', '300', '-A', 'Mozilla/5.0', URL], check=True, capture_output=True).stdout
    z = zipfile.ZipFile(io.BytesIO(raw))
    name = next(n for n in z.namelist() if n.endswith('.csv'))
    rows = csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig', newline=''))
    out, total = [], 0
    for d in rows:
        total += 1
        cats = [d.get('醫器主類別一', ''), d.get('醫器主類別二', ''), d.get('醫器主類別三', '')]
        if not any(c.startswith('F') for c in cats):
            continue
        out.append({
            'no': d['許可證字號'].strip(),
            'st': d['註銷狀態'].strip(),          # ''＝有效、已註銷、已廢止
            'exp': d['有效日期'].strip(),
            'zh': d['中文品名'].strip(),
            'en': d['英文品名'].strip(),
            'eff': d['效能'].strip()[:240],
            'app': d['申請商名稱'].strip(),
            'mfr': d['製造商名稱'].strip(),
            'cls': d['醫療器材級數'].strip(),
            'cat': d['醫器次類別一'].strip(),
        })
    if total < 50000 or len(out) < 5000:
        sys.exit(f'資料筆數異常（全部 {total}、牙科 {len(out)}），不覆寫')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        'source': URL, 'builtAt': datetime.date.today().isoformat(), 'total': total, 'licenses': out,
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'全部 {total} 筆，牙科類 {len(out)} 筆 → {OUT}（{OUT.stat().st_size/1e6:.1f} MB）')

if __name__ == '__main__':
    main()
