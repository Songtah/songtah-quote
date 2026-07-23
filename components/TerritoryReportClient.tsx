'use client'

import { ArrowLeft, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'

type ReportMode = 'both' | 'summary' | 'list'
type TerritoryCustomerType = '牙醫診所' | '牙體技術所' | '醫院'
type ReportCustomer = {
  id: string
  name: string
  type: string
  status: string
  devStage: string
  salesperson: string
  phone: string
  address: string
}

const TERRITORY_CUSTOMER_TYPES: TerritoryCustomerType[] = ['牙醫診所', '牙體技術所', '醫院']
const TYPE_OPTIONS: { value: '' | TerritoryCustomerType; label: string }[] = [
  { value: '', label: '全部類型' },
  ...TERRITORY_CUSTOMER_TYPES.map((type) => ({ value: type, label: type })),
]
const MODE_OPTIONS: { value: ReportMode; label: string }[] = [
  { value: 'both', label: '統計＋名單' },
  { value: 'summary', label: '只印數量統計' },
  { value: 'list', label: '只印客戶名單' },
]

export default function TerritoryReportClient({
  territory,
  customers,
  marketByType,
  marketTotal,
  generatedAt,
  generatedBy,
  initialType,
  hiddenOtherOwnedCount,
  hiddenOtherOwnedByType,
  ownershipIdentityAmbiguous,
}: {
  territory: { id: string; city: string; district: string; salesperson: string; status: string }
  customers: ReportCustomer[]
  marketByType: Record<TerritoryCustomerType, number>
  marketTotal: number
  generatedAt: string
  generatedBy: string
  initialType: '' | TerritoryCustomerType
  hiddenOtherOwnedCount: number
  hiddenOtherOwnedByType: Record<TerritoryCustomerType, number>
  ownershipIdentityAmbiguous: boolean
}) {
  const [type, setType] = useState<'' | TerritoryCustomerType>(initialType)
  const [mode, setMode] = useState<ReportMode>('both')
  const visibleCustomers = useMemo(() => customers.filter((customer) => !type || customer.type === type), [customers, type])
  const typeCards = type ? TERRITORY_CUSTOMER_TYPES.filter((item) => item === type) : TERRITORY_CUSTOMER_TYPES
  const customerCounts = useMemo(() => Object.fromEntries(TERRITORY_CUSTOMER_TYPES.map((item) => [
    item, customers.filter((customer) => customer.type === item).length,
  ])) as Record<TerritoryCustomerType, number>, [customers])
  const reportLabel = type || '全部類型'
  const filteredHiddenCount = type ? hiddenOtherOwnedByType[type] : hiddenOtherOwnedCount
  const printReport = () => {
    fetch('/api/audit-pageview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({
        pathname: `/bd/territories/${territory.id}/report`,
        title: `列印轄區報表：${territory.city}${territory.district}｜${reportLabel}｜${MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode}`,
      }),
    }).catch(() => {})
    window.print()
  }

  return (
    <main className="min-h-screen bg-stone-100 px-3 py-4 text-stone-800 sm:px-6 sm:py-7">
      <section className="report-controls mx-auto mb-5 max-w-[210mm] rounded-3xl bg-white p-4 shadow-lg ring-1 ring-stone-900/[0.06] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <button onClick={() => window.history.length > 1 ? window.history.back() : window.location.assign('/bd')} aria-label="返回上一頁" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-50 text-stone-500 transition-all hover:bg-stone-100 active:scale-95"><ArrowLeft className="size-4" /></button>
            <div><p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">列印前設定</p><h1 className="mt-1 text-lg font-bold">選好內容，再列印或另存 PDF</h1><p className="mt-1 text-sm text-stone-500">瀏覽器列印視窗中選擇「另存為 PDF」即可製作 PDF。</p></div>
          </div>
          <button onClick={printReport} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-500 px-6 py-3 text-sm font-bold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95"><Printer className="size-4" />列印／另存 PDF</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-stone-600">客戶類型<select className="select-soft mt-1.5 block w-full" value={type} onChange={(event) => setType(event.target.value as '' | TerritoryCustomerType)}>{TYPE_OPTIONS.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}</select></label>
          <label className="text-sm font-semibold text-stone-600">列印內容<select className="select-soft mt-1.5 block w-full" value={mode} onChange={(event) => setMode(event.target.value as ReportMode)}>{MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
      </section>

      <article className="report-page mx-auto min-h-[297mm] max-w-[210mm] bg-white px-[12mm] py-[11mm] shadow-xl">
        <header className="border-b-2 border-brand-500 pb-5">
          <div className="flex items-start justify-between gap-5">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-600">SONGTAH TERRITORY REPORT</p><h2 className="mt-2 text-2xl font-bold text-stone-900">{territory.city}{territory.district}｜轄區客戶報表</h2><p className="mt-2 text-sm text-stone-500">負責業務：<b className="text-stone-700">{territory.salesperson}</b>　轄區狀態：{territory.status}</p></div>
            <div className="rounded-full bg-stone-900 px-3 py-1.5 text-[10px] font-bold tracking-wider text-white">內部機密</div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-stone-400"><span>報表範圍：{reportLabel}</span><span>產出時間：{generatedAt}</span><span>產出人員：{generatedBy || '系統使用者'}</span></div>
        </header>

        {(mode === 'both' || mode === 'summary') && (
          <section className="avoid-break mt-6">
            <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">MARKET SUMMARY</p><h3 className="mt-1 text-lg font-bold">各類別數量統計</h3></div><p className="text-xs text-stone-400">BAS 市場資料／客戶主檔</p></div>
            {!type && <div className="mt-4 rounded-2xl bg-brand-50/70 px-4 py-3"><p className="text-xs text-stone-500">轄區市場總數</p><p className="mt-1 text-3xl font-bold text-brand-700">{marketTotal.toLocaleString()} <span className="text-sm font-medium">家</span></p></div>}
            <div className="mt-3 grid grid-cols-3 gap-3">
              {typeCards.map((item) => <div key={item} className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-semibold text-stone-500">{item}</p><p className="mt-2 text-2xl font-bold text-stone-800">{marketByType[item].toLocaleString()}</p><p className="mt-1 text-[10px] text-stone-400">主檔可列印 {customerCounts[item].toLocaleString()} 家</p></div>)}
            </div>
            {filteredHiddenCount > 0 && <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-[10px] text-stone-400">{ownershipIdentityAmbiguous ? `偵測到同名業務帳號；基於資料安全，已隱藏 ${filteredHiddenCount} 家已認領客戶明細，請主管先修正重複帳號名稱。` : `依權限已隱藏 ${filteredHiddenCount} 家由其他業務負責的客戶明細；市場總數不受影響。`}</p>}
          </section>
        )}

        {(mode === 'both' || mode === 'list') && (
          <section className="mt-7">
            <div className="avoid-break flex items-end justify-between gap-3 border-b border-stone-900/[0.08] pb-3"><div><p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">CUSTOMER LIST</p><h3 className="mt-1 text-lg font-bold">客戶名單</h3></div><p className="text-xs text-stone-400">共 {visibleCustomers.length.toLocaleString()} 家</p></div>
            <table className="mt-3 w-full table-fixed border-collapse text-left text-[9px]">
              <thead><tr className="border-b border-stone-300 text-stone-500"><th className="w-[4%] py-2 pr-1 font-semibold">#</th><th className="w-[23%] py-2 pr-2 font-semibold">客戶名稱</th><th className="w-[13%] py-2 pr-2 font-semibold">開發階段</th><th className="w-[11%] py-2 pr-2 font-semibold">負責人</th><th className="w-[17%] py-2 pr-2 font-semibold">電話</th><th className="w-[32%] py-2 font-semibold">地址</th></tr></thead>
              <tbody>
                {visibleCustomers.map((customer, index) => <tr key={customer.id} className="border-b border-stone-900/[0.06] align-top"><td className="py-2.5 pr-1 text-stone-400">{index + 1}</td><td className="py-2.5 pr-2 font-semibold text-stone-800">{customer.name}<span className="mt-0.5 block text-[8px] font-normal leading-4 text-stone-400">{customer.type || '未分類'}｜{customer.status || '機構狀態未標示'}</span></td><td className="py-2.5 pr-2 leading-4 text-stone-600">{customer.devStage || '尚未設定'}</td><td className="py-2.5 pr-2 break-words leading-4 text-stone-600">{customer.salesperson || '尚未認領'}</td><td className="py-2.5 pr-2 break-words leading-4 text-stone-600">{customer.phone || '—'}</td><td className="py-2.5 break-words leading-4 text-stone-600">{customer.address || '—'}</td></tr>)}
                {visibleCustomers.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-sm text-stone-400">此篩選條件沒有可列印的客戶</td></tr>}
              </tbody>
            </table>
          </section>
        )}

        <footer className="report-footer mt-8 flex items-center justify-between border-t border-stone-900/[0.08] pt-3 text-[9px] text-stone-400"><span>崧達企業管理系統｜轄區報表</span><span>內部機密｜請妥善保管，禁止未經授權轉寄</span></footer>
      </article>

      <style jsx global>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print {
          html, body { background: #fff !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          body { margin: 0 !important; }
          .report-controls, [data-font-size-toggle] { display: none !important; }
          .report-page { min-height: auto !important; max-width: none !important; width: 100% !important; padding: 0 !important; box-shadow: none !important; }
          .avoid-break, .report-page tr { break-inside: avoid; page-break-inside: avoid; }
          .report-page thead { display: table-header-group; }
          .report-footer { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </main>
  )
}
