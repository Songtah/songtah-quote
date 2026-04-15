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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h1 className="text-xl font-bold text-gray-700">找不到此報價單</h1>
          <p className="text-gray-400 text-sm mt-2">連結可能已失效或不正確</p>
        </div>
      </div>
    )
  }

  const items = quote.items ?? []

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-4">
          <div className="bg-green-800 px-8 py-6 text-white">
            <div className="flex justify-between items-center gap-6">
              <div className="flex flex-col justify-center">
                <div className="bg-white rounded-lg px-4 py-2 inline-flex items-center mb-2">
                  <Image src="/Logo.png" alt="崧達企業" width={220} height={74} className="object-contain" />
                </div>
                <div className="text-green-200 text-xs">Songtah Enterprise Co., Ltd.</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold">報 價 單</div>
                <div className="text-green-200 text-sm font-mono mt-1">
                  {quote.quoteNumber}
                </div>
              </div>
            </div>
          </div>

          {/* Info Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-gray-100">
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
                <div className="text-xs text-gray-400 mb-1">{label}</div>
                <div className="font-semibold text-gray-800 text-sm">{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Items Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-4">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-700">報價明細</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
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
              <tbody className="divide-y divide-gray-50">
                {items.map((item, i) => (
                  <tr key={i} className={i % 2 === 1 ? 'bg-gray-50/50' : ''}>
                    <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} className="h-16 w-16 rounded-xl object-cover border border-gray-200" />
                      ) : (
                        <div className="h-16 w-16 rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-[10px] text-gray-400 text-center px-1">
                          圖片預留
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {item.name}
                      {item.brand && <span className="ml-2 text-xs text-gray-400">{item.brand}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{item.spec || '—'}</td>
                    <td className="px-4 py-3 text-center text-gray-500">{item.unit}</td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(item.unitPrice)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div className="px-6 py-5 bg-green-50 border-t border-green-100 flex justify-between items-center">
            <span className="text-gray-600 font-medium">合計金額</span>
            <span className="text-2xl font-bold text-green-800">{formatMoney(quote.total)}</span>
          </div>
        </div>

        {/* Note */}
        {quote.note && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4 mb-4">
            <div className="text-xs text-amber-600 font-medium mb-1">備註</div>
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{quote.note}</div>
          </div>
        )}

        {/* PDF Button */}
        <div className="text-center">
          <a
            href={`/api/quotes/${params.id}/pdf`}
            className="inline-flex items-center gap-2 bg-green-800 hover:bg-green-900 text-white px-6 py-3 rounded-xl font-semibold transition text-sm"
          >
            ↓ 下載 PDF
          </a>
        </div>

        <div className="text-center mt-6 text-xs text-gray-400">
          崧達企業股份有限公司｜此報價單由系統自動產生
        </div>
      </div>
    </div>
  )
}
