/**
 * lib/pdf-brand.tsx — 公司文件 PDF 共用（報價單 lib/pdf.tsx、訂購單 lib/order-pdf.tsx）
 * 2026 品牌識別：千歲綠 #36563C、崧達綠 #62B320、Cornsilk #FEFAE0；新版 Logo（public/Logo.png）。
 * 只註冊了 NotoSansTC 400（子集字型），全檔不使用 fontWeight；文字輸出一律經 T() 轉半形。
 */
import React from 'react'
import path from 'path'
import { Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer'
import { COMPANY } from '@/lib/quote-model'

Font.register({
  family: 'NotoSansTC',
  src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansTC-400.woff'),
})
// 中文不要依英文規則斷字（會在字中間插入連字號）
Font.registerHyphenationCallback((word) => Array.from(word))

export const GREEN_DARK = '#36563C'
export const GREEN = '#62B320'
export const CORNSILK = '#FEFAE0'
export const INK = '#1F1D1A'
export const MUTED = '#77756C'
export const LINE = '#E3E1D3'
export const ZEBRA = '#F8F9F3'

export const s = StyleSheet.create({
  page: { fontFamily: 'NotoSansTC', fontSize: 9, color: INK, paddingTop: 30, paddingHorizontal: 36, paddingBottom: 58 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  logo: { width: 186, height: 31 },
  titleBox: { alignItems: 'flex-end' },
  title: { fontSize: 20, color: GREEN_DARK, letterSpacing: 8 },
  titleEn: { fontSize: 6.5, color: MUTED, letterSpacing: 3, marginTop: 1 },
  ruleDark: { height: 2, backgroundColor: GREEN_DARK, marginTop: 10 },
  ruleGreen: { height: 1, backgroundColor: GREEN, marginTop: 1.5, width: 64 },
  companyLine: { fontSize: 7.2, color: MUTED, marginTop: 5, lineHeight: 1.5 },

  infoRow: { flexDirection: 'row', marginTop: 14 },
  customerPanel: { width: '57%', backgroundColor: CORNSILK, borderRadius: 3, padding: 10, marginRight: '3%' },
  quotePanel: { width: '40%', borderWidth: 0.75, borderColor: LINE, borderRadius: 3, padding: 10 },
  panelLabel: { fontSize: 7, color: GREEN_DARK, letterSpacing: 1.5, marginBottom: 4 },
  customerName: { fontSize: 13, marginBottom: 2 },
  customerSub: { fontSize: 8, color: MUTED, marginBottom: 5 },
  kv: { flexDirection: 'row', marginTop: 2.5 },
  k: { width: 50, fontSize: 7.5, color: MUTED },
  v: { flex: 1, fontSize: 8.8 },

  table: { marginTop: 14 },
  th: { flexDirection: 'row', backgroundColor: GREEN_DARK, color: '#FFFFFF', fontSize: 8, paddingVertical: 5.5 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 6, alignItems: 'center' },
  cell: { paddingHorizontal: 5 },
  right: { textAlign: 'right' },
  center: { textAlign: 'center' },
  itemName: { fontSize: 9.2 },
  itemSub: { fontSize: 7.3, color: MUTED, marginTop: 1.5 },
  imgBox: { width: 38, height: 38, borderRadius: 2, borderWidth: 0.5, borderColor: LINE, overflow: 'hidden' },
  img: { width: 38, height: 38, objectFit: 'contain' },

  summary: { flexDirection: 'row', marginTop: 12 },
  terms: { flex: 1, paddingRight: 18 },
  termsLabel: { fontSize: 7, color: GREEN_DARK, letterSpacing: 1.5, marginBottom: 4 },
  term: { flexDirection: 'row', marginBottom: 2.5 },
  termNo: { width: 12, fontSize: 8, color: MUTED },
  termText: { flex: 1, fontSize: 8.3, lineHeight: 1.45 },
  totals: { width: 206 },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.2 },
  tLabel: { fontSize: 8.5, color: MUTED },
  tValue: { fontSize: 9 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: 1.2, borderTopColor: GREEN_DARK, marginTop: 4, paddingTop: 5 },
  grandLabel: { fontSize: 9.5, color: GREEN_DARK },
  grandValue: { fontSize: 14, color: GREEN_DARK },
  words: { fontSize: 7.5, color: MUTED, textAlign: 'right', marginTop: 3 },

  bank: { flexDirection: 'row', backgroundColor: CORNSILK, borderRadius: 3, paddingVertical: 6, paddingHorizontal: 10, marginTop: 14, fontSize: 7.8 },
  bankLabel: { color: GREEN_DARK, marginRight: 10 },
  bankText: { color: INK, marginRight: 14 },

  sign: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  stampBox: { width: '44%', alignItems: 'center' },
  stamp: { width: 130, height: 82, objectFit: 'contain' },
  stampCaption: { fontSize: 7, color: MUTED, marginTop: 2 },
  signBox: { width: '48%', borderWidth: 0.75, borderColor: LINE, borderRadius: 3, padding: 10, height: 96 },
  signTitle: { fontSize: 7.5, color: GREEN_DARK, letterSpacing: 1.5 },
  signLine: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 22 },
  signLabel: { width: 30, fontSize: 7.5, color: MUTED },
  signRule: { flex: 1, borderBottomWidth: 0.5, borderBottomColor: MUTED },

  footer: { position: 'absolute', bottom: 24, left: 36, right: 36, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.8, color: MUTED },
  watermark: { position: 'absolute', top: 360, left: 40, right: 40, textAlign: 'center', fontSize: 46, color: GREEN_DARK, opacity: 0.07, transform: 'rotate(-28deg)' },
})

/**
 * 內嵌的 NotoSansTC-400 是子集字型（6,606 字），沒有全形標點與全形英數（（），：；！？％／０…），
 * 直接輸出會整個字消失（例：「現貨，下單後」變成「現貨下單後」）。一律先轉成半形（NFKC）。
 */
export const T = (v: unknown) => String(v ?? '')
  .replace(/，/g, ', ').replace(/：/g, ': ').replace(/；/g, '; ').replace(/[・･]/g, '·')
  .normalize('NFKC')

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


/** 文件抬頭：Logo＋標題＋品牌雙線＋公司聯絡資訊 */
export function BrandHeader({ title, titleEn }: { title: string; titleEn: string }) {
  return (
    <>
      <View style={s.header}>
        <Image src={path.join(process.cwd(), 'public', 'Logo.png')} style={s.logo} />
        <View style={s.titleBox}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.titleEn}>{titleEn}</Text>
        </View>
      </View>
      <View style={s.ruleDark} />
      <View style={s.ruleGreen} />
      <Text style={s.companyLine}>
        {COMPANY.address}　TEL {COMPANY.tel}　FAX {COMPANY.fax}　{COMPANY.email}　統一編號 {COMPANY.taxId}
      </Text>
    </>
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

export function Watermark({ text }: { text?: string }) {
  return text ? <Text style={s.watermark} fixed>{T(text)}</Text> : null
}
