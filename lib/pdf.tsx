import React from 'react'
import path from 'path'
import {
  Document, Page, Text, View, StyleSheet, Font, Image,
} from '@react-pdf/renderer'
import type { Quote } from '@/types'

// 中文字體：@fontsource woff (woff2 不被 fontkit 支援)
Font.register({
  family: 'NotoSansTC',
  src: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-tc@5/files/noto-sans-tc-chinese-traditional-400-normal.woff',
})

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansTC',
    fontSize: 10,
    padding: 40,
    color: '#1a1a1a',
  },
  header: {
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#166534',
    paddingBottom: 12,
  },
  logoFrame: {
    width: 230,
    height: 64,
    overflow: 'hidden',
    marginBottom: 4,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  logo: {
    width: 250,
    height: 64,
    objectFit: 'contain',
    marginLeft: -34,
  },
  companyName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#166534',
    marginBottom: 4,
  },
  companyInfo: {
    fontSize: 8,
    color: '#666',
  },
  companyBlock: {
    marginTop: 6,
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
  },
  quoteNumber: {
    fontSize: 11,
    textAlign: 'right',
    color: '#555',
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  infoSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    marginBottom: 20,
  },
  infoBlock: {
    width: '30%',
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    padding: 10,
  },
  infoLabel: {
    fontSize: 8,
    color: '#888',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  table: {
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#166534',
    color: 'white',
    paddingVertical: 6,
    paddingHorizontal: 4,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    alignItems: 'center',
  },
  tableRowAlt: {
    backgroundColor: '#f8fafc',
  },
  colIndex:   { width: '5%',  textAlign: 'center' },
  colImage:   { width: '14%' },
  colName:    { width: '20%' },
  colSpec:    { width: '13%' },
  colUnit:    { width: '7%',  textAlign: 'center' },
  colQty:     { width: '8%',  textAlign: 'right' },
  colPrice:   { width: '12%', textAlign: 'right' },
  colSubtotal:{ width: '12%', textAlign: 'right', paddingRight: 8 },
  colNote:    { width: '9%', paddingLeft: 8 },
  imageBox: {
    width: 44,
    height: 44,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
  },
  itemImage: {
    width: 44,
    height: 44,
    objectFit: 'cover',
  },
  imagePlaceholder: {
    fontSize: 6,
    color: '#9ca3af',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  totalSection: {
    alignItems: 'flex-end',
    marginBottom: 20,
    borderTopWidth: 2,
    borderTopColor: '#166534',
    paddingTop: 8,
  },
  totalRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 4,
  },
  totalLabel: {
    fontSize: 11,
    color: '#555',
    width: 80,
    textAlign: 'right',
  },
  totalValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#166534',
    width: 100,
    textAlign: 'right',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 8,
    color: '#888',
  },
  noteSection: {
    backgroundColor: '#fffbeb',
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    padding: 8,
    marginBottom: 16,
  },
  noteLabel: {
    fontSize: 8,
    color: '#92400e',
    marginBottom: 2,
  },
  noteText: {
    fontSize: 9,
    color: '#1a1a1a',
  },
})

function formatMoney(n: number): string {
  return 'NT$ ' + n.toLocaleString('zh-TW')
}

function formatDate(d: string): string {
  if (!d) return '—'
  return d.replace(/-/g, '/')
}

export function QuoteDocument({ quote }: { quote: Quote }) {
  const items = quote.items ?? []

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.row}>
            <View style={styles.headerLeft}>
              <View style={styles.logoFrame}>
                <Image src={path.join(process.cwd(), 'public', 'Logo.png')} style={styles.logo} />
              </View>
              <Text style={styles.companyInfo}>SONGTAH TRADING CO.,LTD.</Text>
              <View style={styles.companyBlock}>
                <Text style={styles.companyNameTw}>崧達企業股份有限公司</Text>
                <Text style={styles.companyDetail}>電話　02-2703-6465　｜　統編　30934957</Text>
                <Text style={styles.companyDetail}>臺北市大安區敦化南路1段376號12F之1</Text>
                <Text style={styles.companyDetail}>sales@songtah.com.tw</Text>
              </View>
            </View>
            <View>
              <Text style={styles.quoteTitle}>報　價　單</Text>
              <Text style={styles.quoteNumber}>No. {quote.quoteNumber}</Text>
            </View>
          </View>
        </View>

        {/* Info */}
        <View style={styles.infoSection}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>客戶名稱</Text>
            <Text style={styles.infoValue}>{quote.customerName}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>電話</Text>
            <Text style={styles.infoValue}>{quote.customerPhone || '—'}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>統一編號</Text>
            <Text style={styles.infoValue}>{quote.customerTaxId || '—'}</Text>
          </View>
          <View style={styles.infoBlock}>
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

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colIndex}>#</Text>
            <Text style={styles.colImage}>圖片</Text>
            <Text style={styles.colName}>品名</Text>
            <Text style={styles.colSpec}>規格</Text>
            <Text style={styles.colUnit}>單位</Text>
            <Text style={styles.colQty}>數量</Text>
            <Text style={styles.colPrice}>單價</Text>
            <Text style={styles.colSubtotal}>小計</Text>
            <Text style={styles.colNote}>備註</Text>
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
              <Text style={styles.colName}>{item.name || ''}</Text>
              <Text style={styles.colSpec}>{item.spec || '—'}</Text>
              <Text style={styles.colUnit}>{item.unit || ''}</Text>
              <Text style={styles.colQty}>{String(item.quantity ?? '')}</Text>
              <Text style={styles.colPrice}>{formatMoney(item.unitPrice)}</Text>
              <Text style={styles.colSubtotal}>{formatMoney(item.subtotal)}</Text>
              <Text style={styles.colNote}>{item.note || ''}</Text>
            </View>
          ))}
        </View>

        {/* Total */}
        <View style={styles.totalSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>合計金額</Text>
            <Text style={styles.totalValue}>{formatMoney(quote.total)}</Text>
          </View>
        </View>

        {/* Note */}
        {!!quote.note && (
          <View style={styles.noteSection}>
            <Text style={styles.noteLabel}>備註</Text>
            <Text style={styles.noteText}>{quote.note}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>SONGTAH TRADING CO.,LTD.｜本報價單有效期至 {formatDate(quote.validUntil)}</Text>
          <Text style={styles.footerText}>報價單號：{quote.quoteNumber}</Text>
        </View>
      </Page>
    </Document>
  )
}
