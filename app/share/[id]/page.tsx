import Image from 'next/image'
import type { Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { getQuote } from '@/lib/notion'
import type { Quote } from '@/types'
import { COMPANY, TAX_RATE, amountInChinese, computeQuoteTotals, formatMoney, parseLayout, rocDate } from '@/lib/quote-model'

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}


export default async function SharePage({ params }: { params: { id: string } }) {
  noStore()
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

  // 公開連結只允許交付已核准內容。保留既有 URL，但未核准／退回時不回傳
  // 客戶個資、品項、價格或內部簽核意見，避免以「前端隱藏」代替資料授權。
  if (quote.status !== '已核准') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-100 px-4">
        <div className="card-soft max-w-md p-8 text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-stone-700">此報價單尚未開放</h1>
          <p className="text-stone-500 text-sm mt-2">報價內容完成核准後，原連結即可查看，不需要更換網址。</p>
        </div>
      </div>
    )
  }

  const items = quote.items ?? []
  const layout = parseLayout(quote.layout)
  const showImage = layout.showImage && items.some((i) => i.imageUrl)
  const totals = computeQuoteTotals({ items, taxMode: quote.taxMode, discount: quote.discount })
  const terms = [
    quote.taxMode === '未稅' ? `本報價單金額未稅，${Math.round(TAX_RATE * 100)}% 營業稅另計。` : `本報價單稅金內含（已含 ${Math.round(TAX_RATE * 100)}% 營業稅）。`,
    ...(quote.validUntil ? [`本報價單有效至民國 ${rocDate(quote.validUntil)}止。`] : []),
    ...(quote.note ?? '').split(/\n+/).map((t) => t.trim()).filter(Boolean),
  ]
  const info: [string, string | undefined][] = [
    ['報價單號', quote.quoteNumber],
    ['報價日期', rocDate(quote.quoteDate || quote.createdAt)],
    ['有效期限', rocDate(quote.validUntil)],
    ['業務承辦', quote.salesperson],
    ['付款條件', quote.paymentTerms],
    ['交貨條件', quote.deliveryTerms],
  ]
  const customer: [string, string | undefined][] = [
    ['聯絡人', quote.contactPerson],
    ['電話', quote.customerPhone],
    ['統一編號', quote.customerTaxId],
    ['地址', quote.customerAddress],
  ]

  // 客戶端頁面採 2026 品牌識別（與 PDF 一致）：千歲綠 #36563C、崧達綠 #62B320、Cornsilk #FEFAE0
  return (
    <div className="min-h-screen bg-[#FBFAF4] px-4 py-6 text-[#1F1D1A] sm:py-10">
      <div className="mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-3xl bg-white shadow-[0_24px_70px_-32px_rgba(54,86,60,0.28)] ring-1 ring-black/[0.04]">
          {/* 抬頭 */}
          <div className="px-6 pt-6 sm:px-8 sm:pt-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Image src="/Logo.svg" alt="崧達企業股份有限公司 SONG TAH" width={2638} height={437} priority className="h-auto w-44 sm:w-52" />
              <div className="text-right">
                <div className="text-2xl tracking-[0.3em] text-[#36563C]">報價單</div>
                <div className="text-[10px] tracking-[0.35em] text-stone-400">QUOTATION</div>
              </div>
            </div>
            <div className="mt-4 h-[2px] bg-[#36563C]" />
            <div className="mt-[3px] h-px w-16 bg-[#62B320]" />
            <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
              {COMPANY.address}　TEL {COMPANY.tel}　FAX {COMPANY.fax}　{COMPANY.email}
            </p>
          </div>

          {/* 客戶／報價資訊 */}
          <div className="grid gap-3 px-6 py-5 sm:grid-cols-[1.4fr_1fr] sm:px-8">
            <div className="rounded-2xl bg-[#FEFAE0] p-4">
              <div className="text-[11px] tracking-widest text-[#36563C]">客戶</div>
              <div className="mt-1 text-lg font-semibold">{quote.customerName}</div>
              {quote.companyTitle && quote.companyTitle !== quote.customerName && <div className="text-xs text-stone-500">{quote.companyTitle}</div>}
              <dl className="mt-2 space-y-1 text-sm">
                {customer.filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex gap-3"><dt className="w-16 shrink-0 text-xs leading-5 text-stone-400">{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
            </div>
            <div className="rounded-2xl p-4 ring-1 ring-black/[0.06]">
              <div className="text-[11px] tracking-widest text-[#36563C]">報價資訊</div>
              <dl className="mt-2 space-y-1 text-sm">
                {info.filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex gap-3"><dt className="w-16 shrink-0 text-xs leading-5 text-stone-400">{k}</dt><dd className={k === '報價單號' ? 'font-mono' : ''}>{v}</dd></div>
                ))}
              </dl>
            </div>
          </div>

          {/* 品項：桌機表格／手機卡片 */}
          <div className="px-6 sm:px-8">
            <table className="hidden w-full text-sm sm:table">
              <thead>
                <tr className="bg-[#36563C] text-xs text-white">
                  <th className="px-3 py-2.5 text-center font-normal">編號</th>
                  {showImage && <th className="px-3 py-2.5 font-normal">圖片</th>}
                  <th className="px-3 py-2.5 text-left font-normal">品名</th>
                  {layout.showSpec && <th className="px-3 py-2.5 text-left font-normal">規格</th>}
                  <th className="px-3 py-2.5 text-right font-normal">數量</th>
                  {layout.showUnit && <th className="px-3 py-2.5 text-center font-normal">單位</th>}
                  <th className="px-3 py-2.5 text-right font-normal">單價</th>
                  <th className="px-3 py-2.5 text-right font-normal">總計</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className={`border-b border-[#E3E1D3] ${i % 2 ? 'bg-[#F8F9F3]' : ''}`}>
                    <td className="px-3 py-3 text-center text-stone-400">{i + 1}</td>
                    {showImage && <td className="px-3 py-3">{item.imageUrl && <img src={item.imageUrl} alt="" className="h-12 w-12 rounded-lg object-contain ring-1 ring-black/[0.06]" />}</td>}
                    <td className="px-3 py-3">
                      <div>{item.name}</div>
                      {(layout.showBrand && item.brand) || (!layout.showSpec && item.spec) ? (
                        <div className="text-xs text-stone-400">{[layout.showBrand ? item.brand : '', layout.showSpec ? '' : item.spec].filter(Boolean).join('　')}</div>
                      ) : null}
                      {item.note && <div className="text-xs text-stone-400">{item.note}</div>}
                    </td>
                    {layout.showSpec && <td className="px-3 py-3 text-stone-500">{item.spec}</td>}
                    <td className="px-3 py-3 text-right tabular-nums">{item.quantity}</td>
                    {layout.showUnit && <td className="px-3 py-3 text-center text-stone-500">{item.unit}</td>}
                    <td className="px-3 py-3 text-right tabular-nums">{item.unitPrice.toLocaleString('zh-TW')}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{item.subtotal.toLocaleString('zh-TW')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-[#E3E1D3] border-y border-[#E3E1D3] sm:hidden">
              {items.map((item, i) => (
                <li key={i} className="flex gap-3 py-3">
                  <span className="w-5 shrink-0 pt-0.5 text-xs text-stone-400">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{item.name}</div>
                    <div className="text-xs text-stone-400">
                      {[layout.showBrand ? item.brand : '', item.spec, item.note].filter(Boolean).join('　·　')}
                    </div>
                    <div className="mt-1 flex justify-between text-xs text-stone-500">
                      <span className="tabular-nums">{item.quantity}{layout.showUnit ? ` ${item.unit}` : ''} × {formatMoney(item.unitPrice)}</span>
                      <span className="text-sm tabular-nums text-[#1F1D1A]">{formatMoney(item.subtotal)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* 說明＋金額 */}
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-[1fr_260px] sm:px-8">
            <div>
              <div className="mb-1.5 text-[11px] tracking-widest text-[#36563C]">說明</div>
              <ol className="list-decimal space-y-1 pl-4 text-sm text-stone-600">
                {terms.map((t, i) => <li key={i}>{t}</li>)}
              </ol>
            </div>
            <div className="text-sm">
              <div className="flex justify-between py-1"><span className="text-stone-500">小計</span><span className="tabular-nums">{formatMoney(totals.subtotal)}</span></div>
              {totals.discount > 0 && <div className="flex justify-between py-1"><span className="text-stone-500">折讓</span><span className="tabular-nums">− {formatMoney(totals.discount)}</span></div>}
              {quote.taxMode === '未稅' && <div className="flex justify-between py-1"><span className="text-stone-500">營業稅 {Math.round(TAX_RATE * 100)}%</span><span className="tabular-nums">{formatMoney(totals.tax)}</span></div>}
              <div className="mt-1 flex items-end justify-between border-t-2 border-[#36563C] pt-2">
                <span className="text-[#36563C]">總計金額{quote.taxMode === '未稅' ? '' : '（含稅）'}</span>
                <span className="text-2xl tabular-nums text-[#36563C]">{formatMoney(totals.total)}</span>
              </div>
              <div className="mt-1 text-right text-xs text-stone-400">{amountInChinese(totals.total)}</div>
            </div>
          </div>

          <div className="mx-6 mb-6 flex flex-wrap gap-x-5 gap-y-1 rounded-2xl bg-[#FEFAE0] px-4 py-3 text-xs sm:mx-8">
            <span className="text-[#36563C]">匯款資訊</span>
            <span>戶名 {COMPANY.bank.holder}</span>
            <span>{COMPANY.bank.name}</span>
            <span>帳號 {COMPANY.bank.account}</span>
          </div>
        </div>

        <div className="mt-6 text-center">
          <a href={`/api/quotes/${params.id}/pdf`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-[#36563C] px-6 py-3 text-sm font-medium text-white shadow-md shadow-[#36563C]/25 transition-all hover:bg-[#2c4731] active:scale-95">
            ↓ 下載 PDF（含公司用印）
          </a>
        </div>
        <p className="mt-6 text-center text-xs text-stone-400">{COMPANY.name}　{COMPANY.nameEn}</p>
      </div>
    </div>
  )
}
