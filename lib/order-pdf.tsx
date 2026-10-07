/**
 * lib/order-pdf.tsx — 訂購單 PDF（2026-10-07 取代 OrderForm 內的 HTML 列印）
 *
 * 與報價單共用 lib/pdf-brand.tsx（新版 Logo、千歲綠／Cornsilk、子集字型半形轉換）。
 * 原列印版：沒有 Logo、贈品／樣品沒標示、使用者輸入直接拼進 HTML（未跳脫）。
 * 草稿／已取消加浮水印，避免被當成已確認的單據。
 */
import React from 'react'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Order, OrderItem } from '@/lib/orders-notion'
import { COMPANY, rocDate, amountInChinese } from '@/lib/quote-model'
import { s, T, money, qty, KV, ZEBRA, GREEN_DARK, LINE, MUTED, BrandHeader, BrandFooter, Watermark } from '@/lib/pdf-brand'

const TYPE_LABEL: Record<string, string> = { gift: '贈品', sample: '樣品' }
const isFree = (i: OrderItem) => i.itemType === 'gift' || i.itemType === 'sample'

const sign = {
  row: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, marginTop: 18 },
  box: { width: '31.5%', borderWidth: 0.75, borderColor: LINE, borderRadius: 3, padding: 9, height: 78 },
  title: { fontSize: 7.5, color: GREEN_DARK, letterSpacing: 1.5 },
  line: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, marginTop: 16 },
  label: { width: 26, fontSize: 7.3, color: MUTED },
  rule: { flex: 1, borderBottomWidth: 0.5, borderBottomColor: MUTED },
}

export function OrderDocument({ order }: { order: Order }) {
  const items = order.items ?? []
  const paid = items.filter((i) => !isFree(i))
  const free = items.filter(isFree)
  const total = paid.reduce((a, i) => a + i.quantity * (i.unitPrice || 0), 0)
  const totalQty = items.reduce((a, i) => a + i.quantity, 0)
  const freeQty = free.reduce((a, i) => a + i.quantity, 0)
  const watermark = order.status === '草稿' ? '草稿 · 尚未送出' : order.status === '已取消' ? '已取消' : undefined

  const cols = [
    { key: 'no', label: '編號', w: 6, align: s.center },
    { key: 'sku', label: '貨品碼', w: 15, align: {} },
    { key: 'name', label: '品名', w: 0, align: {} },
    { key: 'qty', label: '數量', w: 8, align: s.right },
    { key: 'price', label: '單價', w: 12, align: s.right },
    { key: 'amount', label: '金額', w: 13, align: s.right },
  ]
  const fixed = cols.reduce((a, c) => a + c.w, 0)
  const width = (c: { w: number }) => `${c.w || 100 - fixed}%`
  const notes = (order.note ?? '').split(/\n+/).map((t) => t.trim()).filter(Boolean)

  return (
    <Document title={`訂購單 ${order.orderNumber} ${order.customerName}`} author={COMPANY.name}>
      <Page size="A4" style={s.page}>
        <Watermark text={watermark} />
        <BrandHeader title="訂購單" titleEn="PURCHASE ORDER" />

        <View style={s.infoRow}>
          <View style={s.customerPanel}>
            <Text style={s.panelLabel}>收貨客戶</Text>
            <Text style={s.customerName}>{T(order.customerName || '（未填客戶）')}</Text>
            {!!order.companyTitle && order.companyTitle !== order.customerName && (
              <Text style={s.customerSub}>{T(order.companyTitle)}</Text>
            )}
            <KV k="聯絡人" v={order.contactPerson} />
            <KV k="電話" v={order.customerPhone} />
            <KV k="統一編號" v={order.customerTaxId} />
            <KV k="送貨地址" v={order.customerAddress} />
          </View>
          <View style={s.quotePanel}>
            <Text style={s.panelLabel}>訂購資訊</Text>
            <KV k="訂單編號" v={order.orderNumber} />
            <KV k="訂購日期" v={rocDate(order.date)} />
            <KV k="希望到貨" v={rocDate(order.requestedDate)} />
            <KV k="業務承辦" v={order.salesperson} />
            <KV k="付款方式" v={order.paymentMethod} />
            <KV k="送貨方式" v={order.deliveryMethod} />
            <KV k="促銷活動" v={order.promotionName} />
          </View>
        </View>

        <View style={s.table}>
          <View style={s.th} fixed>
            {cols.map((c) => <Text key={c.key} style={[s.cell, c.align, { width: width(c) }]}>{c.label}</Text>)}
          </View>
          {items.map((item, i) => {
            const freeRow = isFree(item)
            const sub = [item.brand, item.seriesName && item.seriesName !== item.brand ? item.seriesName : ''].filter(Boolean).join('　')
            return (
              <View key={i} style={[s.tr, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]} wrap={false}>
                <Text style={[s.cell, s.center, { width: width(cols[0]) }]}>{i + 1}</Text>
                <Text style={[s.cell, { width: width(cols[1]), fontSize: 7.8, color: MUTED }]}>{T(item.skuCode || '—')}</Text>
                <View style={[s.cell, { width: width(cols[2]) }]}>
                  <Text style={s.itemName}>{freeRow ? `[${TYPE_LABEL[item.itemType!]}] ` : ''}{T(item.skuName)}</Text>
                  {!!sub && <Text style={s.itemSub}>{T(sub)}</Text>}
                  {!!item.note && <Text style={s.itemSub}>{T(item.note)}</Text>}
                </View>
                <Text style={[s.cell, s.right, { width: width(cols[3]) }]}>{qty(item.quantity)}</Text>
                <Text style={[s.cell, s.right, { width: width(cols[4]) }]}>{freeRow ? '—' : money(item.unitPrice)}</Text>
                <Text style={[s.cell, s.right, { width: width(cols[5]) }]}>{freeRow ? TYPE_LABEL[item.itemType!] : money(item.quantity * (item.unitPrice || 0))}</Text>
              </View>
            )
          })}
        </View>

        <View style={s.summary} wrap={false}>
          <View style={s.terms}>
            {notes.length > 0 && (
              <>
                <Text style={s.termsLabel}>備註</Text>
                {notes.map((t, i) => (
                  <View key={i} style={s.term}>
                    <Text style={s.termNo}>{notes.length > 1 ? `${i + 1}.` : ''}</Text>
                    <Text style={s.termText}>{T(t)}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
          <View style={s.totals}>
            <View style={s.tRow}><Text style={s.tLabel}>品項 · 總件數</Text><Text style={s.tValue}>{items.length} 項 · {qty(totalQty)} 件</Text></View>
            {freeQty > 0 && (
              <View style={s.tRow}><Text style={s.tLabel}>{T('其中贈品／樣品')}</Text><Text style={s.tValue}>{qty(freeQty)} 件</Text></View>
            )}
            <View style={s.grand}>
              <Text style={s.grandLabel}>合計金額</Text>
              <Text style={s.grandValue}>NT$ {money(total)}</Text>
            </View>
            <Text style={s.words}>{amountInChinese(total)}</Text>
          </View>
        </View>

        <View style={sign.row} wrap={false}>
          {['業務', '行政確認', '客戶簽收'].map((t) => (
            <View key={t} style={sign.box}>
              <Text style={sign.title}>{t}</Text>
              <View style={sign.line}><Text style={sign.label}>簽章</Text><View style={sign.rule} /></View>
              <View style={sign.line}><Text style={sign.label}>日期</Text><View style={sign.rule} /></View>
            </View>
          ))}
        </View>

        <BrandFooter docLabel="訂單編號" docNumber={order.orderNumber} />
      </Page>
    </Document>
  )
}
