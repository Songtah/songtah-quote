import React from 'react'
import path from 'path'
import {
  Document, Page, Text, View, StyleSheet, Font, Image,
} from '@react-pdf/renderer'
import type { Quote } from '@/types'

// ── Font ─────────────────────────────────────────────────────────────────────
Font.register({
  family: 'NotoSansTC',
  // Local file in public/fonts/ — avoids CDN round-trip on every PDF render
  src: path.join(process.cwd(), 'public', 'fonts', 'NotoSansTC-400.woff'),
})

// ── Brand colours (metallic coffee-brown, same as share page) ────────────────
const BRAND   = '#6b4c2a'   // primary — header border, table header, total line
const BRAND_L = '#9a7248'   // lighter — total value text
const CREAM   = '#fdf8f3'   // warm cream background for info blocks

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansTC',
    fontSize: 10,
    padding: 40,
    color: '#1a1a1a',
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    marginBottom: 18,
    borderBottomWidth: 2,
    borderBottomColor: BRAND,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    maxWidth: '58%',
  },
  headerRight: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    minWidth: '30%',
  },
  logoFrame: {
    width: 190,
    height: 52,
    marginBottom: 5,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  logo: {
    width: 190,
    height: 52,
    objectFit: 'contain',
    objectPositionX: 0,
  },
  companyEn: {
    fontSize: 7.5,
    color: '#888',
    letterSpacing: 0.5,
    marginBottom: 6,           // breathing room before Chinese block
  },
  companyBlock: {
    flexDirection: 'column',
  },
  companyNameTw: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 3,
  },
  companyDetail: {
    fontSize: 7.5,
    color: '#555',
    lineHeight: 1.6,
  },
  quoteTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
    color: '#1a1a1a',
    letterSpacing: 4,
  },
  quoteNumber: {
    fontSize: 11,
    textAlign: 'right',
    color: '#666',
    marginTop: 4,
  },

  // ── Info grid ────────────────────────────────────────────────────────────
  // Use marginRight/marginBottom instead of gap to avoid Yoga calculation drift
  infoSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  infoBlock: {
    width: '30%',
    marginRight: '3%',
    marginBottom: 10,
    backgroundColor: CREAM,
    borderRadius: 4,
    padding: 9,
  },
  infoBlockWide: {          // for address — spans two columns
    width: '63%',
    marginRight: '3%',
    marginBottom: 10,
    backgroundColor: CREAM,
    borderRadius: 4,
    padding: 9,
  },
  infoLabel: {
    fontSize: 7.5,
    color: '#999',
    marginBottom: 2.5,
  },
  infoValue: {
    fontSize: 9.5,
    fontWeight: 'bold',
    color: '#1a1a1a',
    flexWrap: 'wrap',
  },

  // ── Table ────────────────────────────────────────────────────────────────
  table: {
    marginBottom: 14,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BRAND,
    color: 'white',
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e8ddd3',
    alignItems: 'center',
    minHeight: 56,
  },
  tableRowAlt: {
    backgroundColor: CREAM,
  },
  colIndex:    { width: '5%',  textAlign: 'center' },
  colImage:    { width: '13%' },
  colName:     { width: '27%', flexWrap: 'wrap' },
  colSpec:     { width: '8%',  flexWrap: 'wrap', textAlign: 'center' },
  colUnit:     { width: '7%',  textAlign: 'center' },
  colQty:      { width: '7%',  textAlign: 'center' },
  colPrice:    { width: '17%', textAlign: 'left' },
  colSubtotal: { width: '16%', textAlign: 'left', paddingRight: 6 },
  headerCell:  { textAlign: 'center' },
  itemNote:    { fontSize: 7.5, color: '#888', marginTop: 2 },

  imageBox: {
    width: 42,
    height: 42,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#d6c9bb',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CREAM,
    overflow: 'hidden',
  },
  itemImage: {
    width: 42,
    height: 42,
    objectFit: 'cover',
  },
  imagePlaceholder: {
    fontSize: 6,
    color: '#bbb',
    textAlign: 'center',
    paddingHorizontal: 3,
  },

  // ── Total ────────────────────────────────────────────────────────────────
  totalSection: {
    alignItems: 'flex-end',
    marginBottom: 18,
    borderTopWidth: 2,
    borderTopColor: BRAND,
    paddingTop: 10,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  totalLabel: {
    fontSize: 11,
    color: '#555',
    width: 80,
    textAlign: 'right',
    marginRight: 16,
  },
  totalValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: BRAND_L,
    width: 110,
    textAlign: 'right',
  },

  // ── Note ─────────────────────────────────────────────────────────────────
  noteSection: {
    backgroundColor: '#fffbeb',
    borderLeftWidth: 3,
    borderLeftColor: '#d4a94a',
    padding: 8,
    marginBottom: 16,
  },
  noteLabel: {
    fontSize: 7.5,
    color: '#92400e',
    marginBottom: 2,
  },
  noteText: {
    fontSize: 9,
    color: '#1a1a1a',
    lineHeight: 1.5,
  },

  // ── Bank info ────────────────────────────────────────────────────────────
  bankSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f0ec',
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 14,
    gap: 16,
  },
  bankLabel: {
    fontSize: 7.5,
    color: BRAND,
    fontWeight: 'bold',
    marginRight: 4,
  },
  bankText: {
    fontSize: 8,
    color: '#444',
    letterSpacing: 0.3,
  },
  bankSep: {
    fontSize: 8,
    color: '#c8b8a8',
    marginHorizontal: 6,
  },

  // ── Signature / Stamp ────────────────────────────────────────────────────
  signatureSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    marginBottom: 52,        // clears the absolute footer
  },
  stampBox: {
    width: '44%',
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampImage: {
    width: 160,
    height: 100,
    objectFit: 'contain',
  },
  signBox: {
    width: '48%',
    height: 100,
    borderWidth: 1,
    borderColor: '#c8b8a8',
    borderRadius: 4,
    padding: 10,
    justifyContent: 'space-between',
  },
  signBoxTitle: {
    fontSize: 8.5,
    fontWeight: 'bold',
    color: BRAND,
    marginBottom: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e0d4c8',
    paddingBottom: 4,
  },
  signLine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flex: 1,
  },
  signLineLabel: {
    fontSize: 7.5,
    color: '#888',
    width: 40,
  },
  signLineRule: {
    flex: 1,
    borderBottomWidth: 0.5,
    borderBottomColor: '#c8b8a8',
    marginBottom: 1,
  },

  // ── Footer ───────────────────────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#e0d4c8',
    paddingTop: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 7.5,
    color: '#999',
    letterSpacing: 0.6,
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatMoney(n: number): string {
  return 'NT$ ' + n.toLocaleString('zh-TW')
}

function formatDate(d: string): string {
  if (!d) return '—'
  return d.replace(/-/g, '/')
}

// ── Document ──────────────────────────────────────────────────────────────────
export function QuoteDocument({ quote }: { quote: Quote }) {
  const items = quote.items ?? []

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* ── Header ── */}
        <View style={styles.header}>
          {/* Left: logo + company info */}
          <View style={styles.headerLeft}>
            <View style={styles.logoFrame}>
              <Image src={path.join(process.cwd(), 'public', 'Logo.png')} style={styles.logo} />
            </View>
            <Text style={styles.companyEn}>SONGTAH TRADING CO.,LTD.</Text>
            <View style={styles.companyBlock}>
              <Text style={styles.companyNameTw}>崧達企業股份有限公司</Text>
              <Text style={styles.companyDetail}>電話　02-2703-6465　｜　統編　30934957</Text>
              <Text style={styles.companyDetail}>臺北市大安區敦化南路1段376號12F之1</Text>
              <Text style={styles.companyDetail}>sales@songtah.com.tw</Text>
            </View>
          </View>

          {/* Right: quote title + number */}
          <View style={styles.headerRight}>
            <Text style={styles.quoteTitle}>報　價　單</Text>
            <Text style={styles.quoteNumber}>No. {quote.quoteNumber}</Text>
          </View>
        </View>

        {/* ── Customer info grid ── */}
        <View style={styles.infoSection}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>客戶名稱</Text>
            <Text style={styles.infoValue}>{quote.customerName || '—'}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>電話</Text>
            <Text style={styles.infoValue}>{quote.customerPhone || '—'}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>統一編號</Text>
            <Text style={styles.infoValue}>{quote.customerTaxId || '—'}</Text>
          </View>
          {/* Address gets wider column so it doesn't clip */}
          <View style={styles.infoBlockWide}>
            <Text style={styles.infoLabel}>地址</Text>
            <Text style={styles.infoValue}>{quote.customerAddress || '—'}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>業務負責人</Text>
            <Text style={styles.infoValue}>{quote.salesperson || '—'}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>報價日期</Text>
            <Text style={styles.infoValue}>{formatDate(quote.createdAt?.slice(0, 10))}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>有效期限</Text>
            <Text style={styles.infoValue}>{formatDate(quote.validUntil)}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>付款條件</Text>
            <Text style={styles.infoValue}>{quote.paymentTerms || '—'}</Text>
          </View>
        </View>

        {/* ── Items table ── */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colIndex,    styles.headerCell]}>#</Text>
            <Text style={[styles.colImage,    styles.headerCell]}>圖片</Text>
            <Text style={[styles.colName,     styles.headerCell]}>品名</Text>
            <Text style={[styles.colSpec,     styles.headerCell]}>規格</Text>
            <Text style={[styles.colUnit,     styles.headerCell]}>單位</Text>
            <Text style={[styles.colQty,      styles.headerCell]}>數量</Text>
            <Text style={[styles.colPrice,    styles.headerCell]}>單價</Text>
            <Text style={[styles.colSubtotal, styles.headerCell]}>小計</Text>
          </View>

          {items.map((item, i) => (
            <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={styles.colIndex}>{i + 1}</Text>
              <View style={styles.colImage}>
                <View style={styles.imageBox}>
                  {item.imageUrl ? (
                    <Image src={item.imageUrl} style={styles.itemImage} />
                  ) : (
                    <Text style={styles.imagePlaceholder}>圖片預留</Text>
                  )}
                </View>
              </View>
              <View style={styles.colName}>
                <Text>{item.name || ''}</Text>
                {!!item.note && <Text style={styles.itemNote}>{item.note}</Text>}
              </View>
              <Text style={styles.colSpec}>{item.spec || '—'}</Text>
              <Text style={styles.colUnit}>{item.unit || ''}</Text>
              <Text style={styles.colQty}>{String(item.quantity ?? '')}</Text>
              <Text style={styles.colPrice}>{formatMoney(item.unitPrice)}</Text>
              <Text style={styles.colSubtotal}>{formatMoney(item.subtotal)}</Text>
            </View>
          ))}
        </View>

        {/* ── Total ── */}
        <View style={styles.totalSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>合計金額</Text>
            <Text style={styles.totalValue}>{formatMoney(quote.total)}</Text>
          </View>
        </View>

        {/* ── Note ── */}
        {!!quote.note && (
          <View style={styles.noteSection}>
            <Text style={styles.noteLabel}>備註</Text>
            <Text style={styles.noteText}>{quote.note}</Text>
          </View>
        )}

        {/* ── Bank info ── */}
        <View style={styles.bankSection}>
          <Text style={styles.bankLabel}>匯款資訊</Text>
          <Text style={styles.bankText}>戶名：崧達企業股份有限公司</Text>
          <Text style={styles.bankSep}>｜</Text>
          <Text style={styles.bankText}>華南商業銀行（總行代號 008）</Text>
          <Text style={styles.bankSep}>｜</Text>
          <Text style={styles.bankText}>帳號：130-10-000184-7</Text>
        </View>

        {/* ── Signature & Stamp ── */}
        <View style={styles.signatureSection}>
          {/* Left: company stamp image */}
          <View style={styles.stampBox}>
            <Image
              src={path.join(process.cwd(), 'public', 'stamp.png')}
              style={styles.stampImage}
            />
          </View>

          {/* Right: countersign — signature line only */}
          <View style={styles.signBox}>
            <Text style={styles.signBoxTitle}>客戶確認回簽</Text>
            <View style={styles.signLine}>
              <Text style={styles.signLineLabel}>簽章</Text>
              <View style={styles.signLineRule} />
            </View>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>SONGTAH TRADING CO.,LTD.</Text>
          <Text style={styles.footerText}>崧達企業股份有限公司</Text>
          <Text style={styles.footerText}>有效期至 {formatDate(quote.validUntil)}</Text>
          <Text style={styles.footerText}>報價單號：{quote.quoteNumber}</Text>
        </View>

      </Page>
    </Document>
  )
}
