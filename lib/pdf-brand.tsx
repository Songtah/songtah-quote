/**
 * lib/pdf-brand.tsx — 公司文件 PDF 共用（報價單 lib/pdf.tsx、訂購單 lib/order-pdf.tsx）
 *
 * 配色依系統設計語言（docs/rules/design-language.md）：棕金 brand 為唯一主色、cream 暖底、stone 中性色
 * （數值取自 tailwind.config.ts）；Logo 維持新版品牌標誌（public/Logo.png）。
 *
 * 字型（2026-10-11）：public/fonts/NotoSansTC-Regular／Bold.woff，由專案相依套件
 * @fontsource/noto-sans-tc（OFL）的 106 個網頁分片合併而成（12,161 字，含全形標點、有粗體）。
 * 舊版只有 6,606 字的子集、沒有全形逗號括號冒號，也沒有粗體，排版只能硬轉半形。
 */
import React from 'react'
import path from 'path'
import { Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer'
import { COMPANY } from '@/lib/quote-model'

Font.register({
  family: 'NotoSansTC',
  fonts: [
    { src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansTC-Regular.woff') },
    { src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansTC-Bold.woff'), fontWeight: 'bold' },
  ],
})
// 中文不要依英文規則斷字（會在字中間插入連字號）
Font.registerHyphenationCallback((word) => Array.from(word))

export const BRAND_DARK = '#6E503C'   // brand-800：標題、總額
export const BRAND = '#866245'        // brand-700：表頭、主線
export const BRAND_GOLD = '#B8956A'   // brand-500：點綴線（系統主色）
export const BRAND_SOFT = '#A07A52'   // brand-600：區塊小標
export const CREAM = '#FAF6F0'        // cream-100：資訊底
export const INK = '#292524'          // stone-800
export const TEXT = '#44403C'         // stone-700
export const MUTED = '#78716C'        // stone-500
export const FAINT = '#A8A29E'        // stone-400
export const LINE = '#E7E5E4'         // stone-200
export const ZEBRA = '#FAF7F2'        // brand-50

const PAD_X = 40

export const s = StyleSheet.create({
  page: { fontFamily: 'NotoSansTC', fontSize: 9, color: INK, lineHeight: 1.45, paddingTop: 32, paddingHorizontal: PAD_X, paddingBottom: 50 },

  // ── 抬頭：左 Logo＋公司資訊、右 標題＋單號日期 ──
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: 168, height: 28 },
  company: { marginTop: 9 },
  companyLine: { fontSize: 7.3, color: MUTED, lineHeight: 1.6 },
  titleBox: { alignItems: 'flex-end' },
  title: { fontSize: 22, fontWeight: 'bold', color: BRAND_DARK, letterSpacing: 3, lineHeight: 1.1 },
  titleEn: { fontSize: 6.5, color: FAINT, letterSpacing: 2.5, marginTop: 7 },
  metaRow: { flexDirection: 'row', marginTop: 8 },
  metaK: { fontSize: 7.5, color: MUTED, width: 44, textAlign: 'right', marginRight: 8 },
  metaV: { fontSize: 9, color: INK, fontWeight: 'bold', minWidth: 92, textAlign: 'right' },
  rule: { height: 1.2, backgroundColor: BRAND, marginTop: 12 },
  ruleAccent: { height: 2.5, backgroundColor: BRAND_GOLD, width: 56, marginTop: -1.8 },

  // ── 資訊面板 ──
  infoRow: { flexDirection: 'row', marginTop: 14, alignItems: 'stretch' },
  customerPanel: { flex: 1.35, backgroundColor: CREAM, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, marginRight: 10 },
  quotePanel: { flex: 1, borderWidth: 0.75, borderColor: LINE, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  panelLabel: { fontSize: 7.5, fontWeight: 'bold', color: BRAND_SOFT, marginBottom: 6 },
  customerName: { fontSize: 13.5, fontWeight: 'bold', color: INK, lineHeight: 1.3 },
  customerSub: { fontSize: 8, color: MUTED, marginTop: 1 },
  kvList: { marginTop: 7 },
  kv: { flexDirection: 'row', marginTop: 3 },
  k: { width: 48, fontSize: 7.8, color: MUTED },
  v: { flex: 1, fontSize: 8.8, color: TEXT },

  // ── 品項表 ──
  table: { marginTop: 14 },
  th: { flexDirection: 'row', backgroundColor: BRAND, borderRadius: 4, color: '#FFFFFF', fontSize: 8, fontWeight: 'bold', paddingVertical: 6 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 6, alignItems: 'flex-start' },
  cell: { paddingHorizontal: 6 },
  num: { textAlign: 'right' },
  right: { textAlign: 'right' },
  center: { textAlign: 'center' },
  idx: { color: FAINT, textAlign: 'center' },
  itemName: { fontSize: 9.5, color: INK },
  itemSub: { fontSize: 7.5, color: MUTED, marginTop: 1.5 },
  gift: { color: BRAND_SOFT, fontWeight: 'bold' },
  dash: { color: FAINT },
  imgBox: { width: 40, height: 40, borderRadius: 4, borderWidth: 0.5, borderColor: LINE, overflow: 'hidden' },
  img: { width: 40, height: 40, objectFit: 'contain' },

  // ── 說明＋金額 ──
  summary: { flexDirection: 'row', marginTop: 12 },
  terms: { flex: 1, paddingRight: 24 },
  termsLabel: { fontSize: 7.5, fontWeight: 'bold', color: BRAND_SOFT, marginBottom: 4 },
  bankLine: { flexDirection: 'row', marginBottom: 2 },
  bankK: { width: 30, fontSize: 8, color: MUTED },
  bankV: { flex: 1, fontSize: 8.3, color: TEXT },
  term: { flexDirection: 'row', marginBottom: 3 },
  termNo: { width: 13, fontSize: 8.3, color: FAINT },
  termText: { flex: 1, fontSize: 8.3, color: TEXT, lineHeight: 1.55 },
  totals: { width: 214 },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5 },
  tLabel: { fontSize: 8.5, color: MUTED },
  tValue: { fontSize: 9, color: TEXT },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: BRAND, marginTop: 5, paddingTop: 7 },
  grandLabel: { fontSize: 10, fontWeight: 'bold', color: BRAND_DARK },
  grandValue: { fontSize: 17, fontWeight: 'bold', color: BRAND_DARK, lineHeight: 1.2 },
  grandNote: { fontSize: 7.3, color: MUTED, textAlign: 'right', marginTop: 5 },

  bank: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: CREAM, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, marginTop: 16, fontSize: 8 },
  bankLabel: { fontWeight: 'bold', color: BRAND_SOFT, marginRight: 12 },
  bankText: { color: TEXT, marginRight: 16 },

  // ── 簽章（推到最後一頁底部）──
  pushDown: { flexGrow: 1, minHeight: 16 },
  sign: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  bankBox: { width: '31%', paddingBottom: 2 },
  stampBox: { width: '29%', alignItems: 'center' },
  stamp: { width: 104, height: 60, objectFit: 'contain' },
  stampCaption: { fontSize: 7.3, color: MUTED, marginTop: 3, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 4, width: '100%', textAlign: 'center' },
  signBox: { width: '36%', borderWidth: 0.75, borderColor: LINE, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  signTitle: { fontSize: 7.5, fontWeight: 'bold', color: BRAND_SOFT },
  signLine: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 18 },
  signLabel: { width: 28, fontSize: 7.8, color: MUTED },
  signRule: { flex: 1, borderBottomWidth: 0.5, borderBottomColor: FAINT },

  footer: { position: 'absolute', bottom: 22, left: PAD_X, right: PAD_X, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.8, color: FAINT },
  watermark: { position: 'absolute', top: 360, left: 40, right: 40, textAlign: 'center', fontSize: 46, fontWeight: 'bold', color: BRAND, opacity: 0.07, transform: 'rotate(-28deg)' },
})

/** 文字輸出（完整字型已含全形標點，不再轉半形；保留函式作為單一出口） */
export const T = (v: unknown) => String(v ?? '')

export const money = (n: number) => (Number(n) || 0).toLocaleString('zh-TW')
export const qty = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))))

export function KV({ k, v }: { k: string; v?: string }) {
  if (!v) return null
  return (
    <View style={s.kv}>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v}>{T(v)}</Text>
    </View>
  )
}

/** 文件抬頭：左 Logo＋公司資訊，右 標題＋單號／日期 */
export function BrandHeader({ title, titleEn, meta = [] }: { title: string; titleEn: string; meta?: [string, string][] }) {
  return (
    <View>
      <View style={s.header}>
        <View>
          <Image src={path.join(process.cwd(), 'public', 'Logo.png')} style={s.logo} />
          <View style={s.company}>
            <Text style={s.companyLine}>{COMPANY.address}</Text>
            <Text style={s.companyLine}>電話 {COMPANY.tel}　傳真 {COMPANY.fax}　{COMPANY.email}</Text>
            <Text style={s.companyLine}>統一編號 {COMPANY.taxId}</Text>
          </View>
        </View>
        <View style={s.titleBox}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.titleEn}>{titleEn}</Text>
          {meta.filter(([, v]) => v).map(([k, v]) => (
            <View key={k} style={s.metaRow}>
              <Text style={s.metaK}>{k}</Text>
              <Text style={s.metaV}>{T(v)}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={s.rule} />
      <View style={s.ruleAccent} />
    </View>
  )
}

/** 頁尾（固定每頁）：公司名＋單號＋頁碼 */
export function BrandFooter({ docLabel, docNumber }: { docLabel: string; docNumber: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{COMPANY.name}　{COMPANY.nameEn}</Text>
      <Text>{docLabel} {T(docNumber)}</Text>
      <Text render={({ pageNumber, totalPages }) => `第 ${pageNumber} / ${totalPages} 頁`} />
    </View>
  )
}

/** 把後面的區塊（簽章）推到最後一頁底部；內容已滿版時只留最小間距 */
export function PushToBottom() {
  return <View style={s.pushDown} />
}

export function Watermark({ text }: { text?: string }) {
  return text ? <Text style={s.watermark} fixed>{T(text)}</Text> : null
}
