import Image from 'next/image'
import { getQuote } from '@/lib/notion'
import type { Quote } from '@/types'

function formatMoney(n: number) {
  return 'NT$ ' + n.toLocaleString('zh-TW')
}
function formatDate(d: string) {
  if (!d) return '—'
  return d.slice(0, 10).replace(/-/g, '/')
}

export default async function SharePage({ params }: { params: { id: string } }) {
  const quote: Quote | null = await getQuote(params.id)

  if (!quote) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-100">
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h1 className="text-xl font-bold text-stone-700">找不到此報價單</h1>
          <p className="text-stone-400 text-sm mt-2">連結可能已失效或不正確</p>
        </div>
      </div>
    )
  }

  const items = quote.items ?? []

  return (
    <div className="min-h-screen bg-gradient-to-br from-cream-100 to-brand-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header Card */}
        <div className="bg-white rounded-2xl shadow-[0_16px_48px_-16px_rgba(90,66,51,0.12)] border border-brand-200/40 overflow-hidden mb-4">
          <div
            className="px-8 py-7 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #6b4c2a 0%, #8b6340 25%, #7a5535 52%, #9a7248 76%, #5c3d1e 100%)',
            }}
          >
            {/* Metallic sheen sweep */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(115deg, transparent 25%, rgba(255,255,255,0.12) 50%, transparent 75%)',
              }}
            />

            <div className="relative flex justify-between items-center gap-6">
              <div className="flex flex-col justify-center">
                <div className="bg-white/90 rounded-xl px-4 py-2 inline-flex items-center mb-2.5 shadow-[0_2px_12px_rgba(0,0,0,0.25)]">
                  <Image src="/Logo.svg" alt="崧達企業" width={520} height={78} className="h-auto w-48 object-contain" />
                </div>
                <div className="text-white/60 text-[10px] font-semibold tracking-[0.22em] uppercase">
                  SONGTAH TRADING CO LTD
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black text-white tracking-wider">報　價　單</div>
                <div className="text-white/70 text-sm font-mono mt-1.5 bg-white/10 rounded-lg px-3 py-1 inline-block">
                  {quote.quoteNumber}
                </div>
              </div>
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-brand-100/50">
            {[
              ['客戶名稱', quote.customerName],
              ['電話', quote.customerPhone || '—'],
              ['地址', quote.customerAddress || '—'],
              ['統一編號', quote.customerTaxId || '—'],
              ['業務負責人', quote.salesperson || '—'],
              ['報價日期', formatDate(quote.createdAt?.slice(0, 10))],
              ['有效期限', formatDate(quote.validUntil)],
              ['付款條件', quote.paymentTerms || '—'],
              ['報價狀態', quote.status],
            ].map(([label, val]) => (
              <div key={label} className="bg-white px-5 py-4">
                <div className="text-xs text-stone-400 mb-1">{label}</div>
                <div className="font-semibold text-stone-700 text-sm">{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Items Table */}
        <div className="bg-white rounded-2xl shadow-[0_16px_48px_-16px_rgba(90,66,51,0.12)] border border-brand-200/40 overflow-hidden mb-4">
          <div className="px-6 py-4 border-b border-brand-100">
            <h2 className="font-semibold text-stone-700">報價明細</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cream-100/60 text-stone-500 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">圖片</th>
                  <th className="px-4 py-3 text-left">品名</th>
                  <th className="px-4 py-3 text-left">規格</th>
                  <th className="px-4 py-3 text-center">單位</th>
                  <th className="px-4 py-3 text-right">數量</th>
                  <th className="px-4 py-3 text-right">單價</th>
                  <th className="px-4 py-3 text-right">小計</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100/40">
                {items.map((item, i) => (
                  <tr key={i} className={i % 2 === 1 ? 'bg-cream-50/50' : ''}>
                    <td className="px-4 py-3 text-stone-400">{i + 1}</td>
                    <td className="px-4 py-3">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="h-16 w-16 rounded-xl object-cover border border-brand-200/50" />
                      ) : (
                        <div className="h-16 w-16 rounded-xl border border-dashed border-brand-200 bg-cream-50 flex items-center justify-center text-[10px] text-stone-400 text-center px-1">
                          圖片預留
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-stone-700">
                      {item.name}
                      {item.brand && <span className="ml-2 text-xs text-stone-400">{item.brand}</span>}
                    </td>
                    <td className="px-4 py-3 text-stone-500">{item.spec || '—'}</td>
                    <td className="px-4 py-3 text-center text-stone-500">{item.unit}</td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(item.unitPrice)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div className="px-6 py-5 bg-gradient-to-r from-brand-50 to-cream-100 border-t border-brand-200/40 flex justify-between items-center">
            <span className="text-stone-600 font-medium">合計金額</span>
            <span className="text-2xl font-bold text-brand-700">{formatMoney(quote.total)}</span>
          </div>
        </div>

        {/* Note */}
        {quote.note && (
          <div className="bg-cream-100 border border-brand-200/50 rounded-2xl px-6 py-4 mb-4">
            <div className="text-xs text-brand-500 font-medium mb-1">備註</div>
            <div className="text-sm text-stone-600 whitespace-pre-wrap">{quote.note}</div>
          </div>
        )}

        {/* PDF Button */}
        <div className="text-center">
          <a
            href={`/api/quotes/${params.id}/pdf`}
            className="button-primary inline-flex items-center gap-2"
          >
            ↓ 下載 PDF
          </a>
        </div>

        <div className="text-center mt-6 text-xs text-stone-400">
          SONGTAH TRADING CO LTD｜此報價單由系統自動產生
        </div>
      </div>
    </div>
  )
}
