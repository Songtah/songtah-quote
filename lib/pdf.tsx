/**
 * lib/pdf.tsx — 報價單 PDF（@react-pdf/renderer）
 *
 * 欄位依公司紙本報價單（T-11510071）：公司地址／電話／傳真／Email、客戶名稱／地址／電話、報價單號、
 * 民國報價日期、編號／品名／數量／單價／總計、稅金說明、有效期限、公司章；
 * 補強：聯絡人、統編、付款／交貨條件、折讓、未稅另計營業稅、金額中文大寫、客戶回簽、頁碼。
 * 欄位依每張報價單的「版面設定」顯示（圖片／規格／單位／品牌）。
 *
 * 版面（2026-10-11 改版）：抬頭左 Logo＋公司資訊、右標題＋單號日期；客戶資料／報價條件兩欄等高；
 * 表格細分隔線；總計粗體；用印與客戶回簽固定在最後一頁底部。
 * 字型、色票、共用元件在 lib/pdf-brand.tsx（與訂購單共用）。
 */
import React from 'react'
import path from 'path'
import { Document, Page, Text, View, Image } from '@react-pdf/renderer'
import type { Quote } from '@/types'
import { COMPANY, computeQuoteTotals, parseLayout, rocDate, amountInChinese, TAX_RATE } from '@/lib/quote-model'
import { s, T, money, qty, KV, BrandHeader, BrandFooter, PushToBottom, Watermark } from '@/lib/pdf-brand'

/** watermark：未核准時的內部預覽浮水印（例如「內部預覽 · 待行政審核」） */
export function QuoteDocument({ quote, watermark }: { quote: Quote; watermark?: string }) {
  const items = quote.items ?? []
  const layout = parseLayout(quote.layout)
  const showImage = layout.showImage && items.some((i) => i.imageUrl)
  const totals = computeQuoteTotals({ items, taxMode: quote.taxMode, discount: quote.discount })
  const taxPct = Math.round(TAX_RATE * 100)

  // 欄寬（%）：品名吃剩下的寬度
  const cols = [
    { key: 'no', label: '#', w: 5, align: s.center },
    ...(showImage ? [{ key: 'img', label: '圖片', w: 10, align: s.center }] : []),
    { key: 'name', label: '品名', w: 0, align: {} },
    ...(layout.showSpec ? [{ key: 'spec', label: '規格', w: 16, align: {} }] : []),
    { key: 'qty', label: '數量', w: 8, align: s.right },
    ...(layout.showUnit ? [{ key: 'unit', label: '單位', w: 7, align: s.center }] : []),
    { key: 'price', label: '單價', w: 12, align: s.right },
    { key: 'amount', label: '金額', w: 14, align: s.right },
  ]
  const fixed = cols.reduce((sum, c) => sum + c.w, 0)
  const width = (c: { w: number }) => `${c.w || 100 - fixed}%`

  const terms = [
    quote.taxMode === '未稅'
      ? `本報價單金額未稅，${taxPct}% 營業稅另計（列於右方）。`
      : `本報價單金額已含 ${taxPct}% 營業稅。`,
    ...(quote.validUntil ? [`本報價單有效至民國 ${rocDate(quote.validUntil)}止。`] : []),
    ...(quote.note ?? '').split(/\n+/).map((t) => t.trim()).filter(Boolean),
  ]

  return (
    <Document title={`報價單 ${quote.quoteNumber} ${quote.customerName}`} author={COMPANY.name}>
      <Page size="A4" style={s.page}>
        <Watermark text={watermark} />

        <BrandHeader
          title="報價單"
          titleEn="QUOTATION"
          meta={[['報價單號', quote.quoteNumber], ['報價日期', rocDate(quote.quoteDate || quote.createdAt)]]}
        />

        {/* 客戶資料／報價條件 */}
        <View style={s.infoRow}>
          <View style={s.customerPanel}>
            <Text style={s.panelLabel}>客戶資料</Text>
            <Text style={s.customerName}>{T(quote.customerName)}</Text>
            {!!quote.companyTitle && quote.companyTitle !== quote.customerName && (
              <Text style={s.customerSub}>{T(quote.companyTitle)}</Text>
            )}
            <View style={s.kvList}>
              <KV k="聯絡人" v={quote.contactPerson} />
              <KV k="電話" v={quote.customerPhone} />
              <KV k="統一編號" v={quote.customerTaxId} />
              <KV k="地址" v={quote.customerAddress} />
            </View>
          </View>
          <View style={s.quotePanel}>
            <Text style={s.panelLabel}>報價條件</Text>
            <KV k="有效期限" v={rocDate(quote.validUntil)} />
            <KV k="業務承辦" v={quote.salesperson} />
            <KV k="付款條件" v={quote.paymentTerms} />
            <KV k="交貨條件" v={quote.deliveryTerms} />
            <KV k="稅別" v={quote.taxMode === '未稅' ? `未稅（另計 ${taxPct}%）` : '含稅'} />
          </View>
        </View>

        {/* 品項 */}
        <View style={s.table}>
          <View style={s.th} fixed>
            {cols.map((c) => (
              <Text key={c.key} style={[s.cell, c.align, { width: width(c) }]}>{c.label}</Text>
            ))}
          </View>
          {items.map((item, i) => {
            const sub = [layout.showBrand ? item.brand : '', layout.showSpec ? '' : item.spec].filter(Boolean).join('　')
            return (
              <View key={i} style={s.tr} wrap={false}>
                {cols.map((c) => {
                  const st = [s.cell, c.align, { width: width(c) }]
                  switch (c.key) {
                    case 'no': return <Text key={c.key} style={[...st, s.idx]}>{i + 1}</Text>
                    case 'img': return (
                      <View key={c.key} style={[...st, { alignItems: 'center' }]}>
                        {item.imageUrl ? <View style={s.imgBox}><Image src={item.imageUrl} style={s.img} /></View> : null}
                      </View>
                    )
                    case 'name': return (
                      <View key={c.key} style={st}>
                        <Text style={s.itemName}>{T(item.name)}</Text>
                        {!!sub && <Text style={s.itemSub}>{T(sub)}</Text>}
                        {!!item.note && <Text style={s.itemSub}>{T(item.note)}</Text>}
                      </View>
                    )
                    case 'spec': return <Text key={c.key} style={st}>{T(item.spec)}</Text>
                    case 'qty': return <Text key={c.key} style={st}>{qty(item.quantity)}</Text>
                    case 'unit': return <Text key={c.key} style={st}>{T(item.unit)}</Text>
                    case 'price': return <Text key={c.key} style={st}>{money(item.unitPrice)}</Text>
                    default: return <Text key={c.key} style={st}>{money(item.subtotal)}</Text>
                  }
                })}
              </View>
            )
          })}
        </View>

        {/* 說明＋金額 */}
        <View style={s.summary} wrap={false}>
          <View style={s.terms}>
            <Text style={s.termsLabel}>說明</Text>
            {terms.map((t, i) => (
              <View key={i} style={s.term}>
                <Text style={s.termNo}>{i + 1}.</Text>
                <Text style={s.termText}>{T(t)}</Text>
              </View>
            ))}
          </View>
          <View style={s.totals}>
            <View style={s.tRow}><Text style={s.tLabel}>小計</Text><Text style={s.tValue}>NT$ {money(totals.subtotal)}</Text></View>
            {totals.discount > 0 && (
              <View style={s.tRow}><Text style={s.tLabel}>折讓</Text><Text style={s.tValue}>− NT$ {money(totals.discount)}</Text></View>
            )}
            {quote.taxMode === '未稅' && (
              <View style={s.tRow}><Text style={s.tLabel}>營業稅 {taxPct}%</Text><Text style={s.tValue}>NT$ {money(totals.tax)}</Text></View>
            )}
            <View style={s.grand}>
              <Text style={s.grandLabel}>總計</Text>
              <Text style={s.grandValue}>NT$ {money(totals.total)}</Text>
            </View>
            <Text style={s.grandNote}>{amountInChinese(totals.total)}{quote.taxMode === '未稅' ? '' : `（含稅）`}</Text>
          </View>
        </View>

        {/* 匯款資訊 */}
        <View style={s.bank} wrap={false}>
          <Text style={s.bankLabel}>匯款資訊</Text>
          <Text style={s.bankText}>戶名　{COMPANY.bank.holder}</Text>
          <Text style={s.bankText}>{COMPANY.bank.name}</Text>
          <Text style={s.bankText}>帳號　{COMPANY.bank.account}</Text>
        </View>

        {/* 用印／客戶回簽：推到最後一頁底部 */}
        <PushToBottom />
        <View style={s.sign} wrap={false}>
          <View style={s.stampBox}>
            {/* stamp-transparent.png：由 stamp.png 去除方格底圖並縮小（原檔背景是畫上去的灰白方格） */}
            <Image src={path.join(process.cwd(), 'public', 'stamp-transparent.png')} style={s.stamp} />
            <Text style={s.stampCaption}>{COMPANY.name}　用印</Text>
          </View>
          <View style={s.signBox}>
            <Text style={s.signTitle}>客戶確認回簽</Text>
            <View style={s.signLine}><Text style={s.signLabel}>簽章</Text><View style={s.signRule} /></View>
            <View style={s.signLine}><Text style={s.signLabel}>日期</Text><View style={s.signRule} /></View>
          </View>
        </View>

        <BrandFooter docLabel="報價單號" docNumber={quote.quoteNumber} />
      </Page>
    </Document>
  )
}
