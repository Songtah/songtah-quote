/**
 * lib/pdf-brand.tsx — 公司文件 PDF 共用（報價單 lib/pdf.tsx、訂購單 lib/order-pdf.tsx）
 * 2026-10-11 改依系統設計語言（docs/rules/design-language.md）：棕金 brand 為唯一主色、
 * cream 暖底、stone 中性色（數值取自 tailwind.config.ts）；Logo 維持新版品牌標誌（public/Logo.png）。
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

export const BRAND_DARK = '#6E503C'   // brand-800：標題、總額
export const BRAND = '#866245'        // brand-700：表頭、主線
export const BRAND_GOLD = '#B8956A'   // brand-500：點綴線（系統主色）
export const BRAND_SOFT = '#A07A52'   // brand-600：區塊小標
export const CREAM = '#FAF6F0'        // cream-100：資訊底
export const INK = '#292524'          // stone-800
export const MUTED = '#78716C'        // stone-500
export const LINE = '#E7E5E4'         // stone-200
export const ZEBRA = '#FAF7F2'        // brand-50

export const s = StyleSheet.create({
  page: { fontFamily: 'NotoSansTC', fontSize: 9, color: INK, paddingTop: 30, paddingHorizontal: 36, paddingBottom: 58 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  logo: { width: 186, height: 31 },
  titleBox: { alignItems: 'flex-end' },
  title: { fontSize: 20, color: BRAND_DARK, letterSpacing: 8 },
  titleEn: { fontSize: 6.5, color: MUTED, letterSpacing: 3, marginTop: 1 },
  ruleDark: { height: 2, backgroundColor: BRAND, marginTop: 10 },
  ruleGreen: { height: 1.5, backgroundColor: BRAND_GOLD, marginTop: 1.5, width: 64 },
  companyLine: { fontSize: 7.2, color: MUTED, marginTop: 5, lineHeight: 1.5 },

  infoRow: { flexDirection: 'row', marginTop: 14 },
  customerPanel: { width: '57%', backgroundColor: CREAM, borderRadius: 8, padding: 10, marginRight: '3%' },
  quotePanel: { width: '40%', borderWidth: 0.75, borderColor: LINE, borderRadius: 8, padding: 10 },
  panelLabel: { fontSize: 7, color: BRAND_SOFT, letterSpacing: 1.5, marginBottom: 4 },
  customerName: { fontSize: 13, marginBottom: 2 },
  customerSub: { fontSize: 8, color: MUTED, marginBottom: 5 },
  kv: { flexDirection: 'row', marginTop: 2.5 },
  k: { width: 50, fontSize: 7.5, color: MUTED },
  v: { flex: 1, fontSize: 8.8 },

  table: { marginTop: 14 },
  th: { flexDirection: 'row', backgroundColor: BRAND, borderRadius: 4, color: '#FFFFFF', fontSize: 8, paddingVertical: 5.5 },
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
  termsLabel: { fontSize: 7, color: BRAND_SOFT, letterSpacing: 1.5, marginBottom: 4 },
  term: { flexDirection: 'row', marginBottom: 2.5 },
  termNo: { width: 12, fontSize: 8, color: MUTED },
  termText: { flex: 1, fontSize: 8.3, lineHeight: 1.45 },
  totals: { width: 206 },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.2 },
  tLabel: { fontSize: 8.5, color: MUTED },
  tValue: { fontSize: 9 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: 1.2, borderTopColor: BRAND, marginTop: 4, paddingTop: 5 },
  grandLabel: { fontSize: 9.5, color: BRAND_DARK },
  grandValue: { fontSize: 14, color: BRAND_DARK },
  words: { fontSize: 7.5, color: MUTED, textAlign: 'right', marginTop: 3 },

  bank: { flexDirection: 'row', backgroundColor: CREAM, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, marginTop: 14, fontSize: 7.8 },
  bankLabel: { color: BRAND_SOFT, marginRight: 10 },
  bankText: { color: INK, marginRight: 14 },

  sign: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  stampBox: { width: '44%', alignItems: 'center' },
  stamp: { width: 130, height: 82, objectFit: 'contain' },
  stampCaption: { fontSize: 7, color: MUTED, marginTop: 2 },
  signBox: { width: '48%', borderWidth: 0.75, borderColor: LINE, borderRadius: 8, padding: 10, height: 96 },
  signTitle: { fontSize: 7.5, color: BRAND_SOFT, letterSpacing: 1.5 },
  signLine: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 22 },
  signLabel: { width: 30, fontSize: 7.5, color: MUTED },
  signRule: { flex: 1, borderBottomWidth: 0.5, borderBottomColor: MUTED },

  footer: { position: 'absolute', bottom: 24, left: 36, right: 36, borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.8, color: MUTED },
  watermark: { position: 'absolute', top: 360, left: 40, right: 40, textAlign: 'center', fontSize: 46, color: BRAND, opacity: 0.08, transform: 'rotate(-28deg)' },
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
