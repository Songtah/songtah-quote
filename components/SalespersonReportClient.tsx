'use client'

import { ArrowLeft, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'

type ReportScope = 'territories' | 'customers'
type ReportMode = 'both' | 'summary' | 'list'
type CustomerType = '牙醫診所' | '牙體技術所' | '醫院'
type ReportCustomer = {
  id: string; name: string; city: string; district: string; type: string
  status: string; devStage: string; salesperson: string
}
type TerritorySummary = {
  id: string; city: string; district: string; status: string
  marketTotal: number; marketByType: Record<CustomerType, number>; customerCount: number
}

const CUSTOMER_TYPES: CustomerType[] = ['牙醫診所', '牙體技術所', '醫院']
const TYPE_OPTIONS: { value: '' | CustomerType; label: string }[] = [
  { value: '', label: '全部類型' },
  ...CUSTOMER_TYPES.map((type) => ({ value: type, label: type })),
]
const MODE_OPTIONS: { value: ReportMode; label: string }[] = [
  { value: 'both', label: '統計＋名單' },
  { value: 'summary', label: '只印數量統計' },
  { value: 'list', label: '只印客戶名單' },
]

export default function SalespersonReportClient({
  salesperson,
  scope,
  customers,
  territories,
  marketTotal,
  marketByType,
  generatedAt,
  generatedBy,
  initialType,
  hiddenOtherOwnedCount,
  hiddenOtherOwnedByType,
}: {
  salesperson: { id: string; name: string }
  scope: ReportScope
  customers: ReportCustomer[]
  territories: TerritorySummary[]
  marketTotal: number
  marketByType: Record<CustomerType, number>
  generatedAt: string
  generatedBy: string
  initialType: '' | CustomerType
  hiddenOtherOwnedCount: number
  hiddenOtherOwnedByType: Record<CustomerType, number>
}) {
  const [type, setType] = useState<'' | CustomerType>(initialType)
  const [mode, setMode] = useState<ReportMode>('both')
  const visibleCustomers = useMemo(() => customers.filter((customer) => !type || customer.type === type), [customers, type])
  const filteredHiddenCount = type ? hiddenOtherOwnedByType[type] : hiddenOtherOwnedCount
  const customerCounts = useMemo(() => Object.fromEntries(CUSTOMER_TYPES.map((item) => [
    item, customers.filter((customer) => customer.type === item).length,
  ])) as Record<CustomerType, number>, [customers])
  const filteredTerritories = useMemo(() => territories.map((territory) => ({
    ...territory,
    filteredMarket: type ? territory.marketByType[type] : territory.marketTotal,
    filteredCustomers: customers.filter((customer) =>
      customer.city === territory.city && customer.district === territory.district && (!type || customer.type === type)
    ).length,
  })), [customers, territories, type])
  const areaGroups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const customer of visibleCustomers) {
      const label = `${customer.city || '未填縣市'}${customer.district || '未填行政區'}`
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-TW'))
  }, [visibleCustomers])
  const reportLabel = type || '全部類型'
  const scopeLabel = scope === 'territories' ? '全部轄區總名單' : '既有客戶名單'

  const changeScope = (nextScope: ReportScope) => {
    const query = new URLSearchParams({ scope: nextScope })
    if (type) query.set('type', type)
    window.location.assign(`/bd/salespersons/${salesperson.id}/report?${query}`)
  }
  const printReport = () => {
    fetch('/api/audit-pageview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({
        pathname: `/bd/salespersons/${salesperson.id}/report`,
        title: `列印業務報表：${salesperson.name}｜${scopeLabel}｜${reportLabel}`,
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
            <div><p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">列印前設定</p><h1 className="mt-1 text-lg font-bold">{salesperson.name}｜{scopeLabel}</h1><p className="mt-1 text-sm text-stone-500">可切換報表種類、客戶類型及列印內容，再另存為 PDF。</p></div>
          </div>
          <button onClick={printReport} className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-500 px-6 py-3 text-sm font-bold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95"><Printer className="size-4" />列印／另存 PDF</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold text-stone-600">報表種類<select className="select-soft mt-1.5 block w-full" value={scope} onChange={(event) => changeScope(event.target.value as ReportScope)}><option value="territories">全部轄區總名單</option><option value="customers">既有客戶名單</option></select></label>
          <label className="text-sm font-semibold text-stone-600">客戶類型<select className="select-soft mt-1.5 block w-full" value={type} onChange={(event) => setType(event.target.value as '' | CustomerType)}>{TYPE_OPTIONS.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}</select></label>
          <label className="text-sm font-semibold text-stone-600">列印內容<select className="select-soft mt-1.5 block w-full" value={mode} onChange={(event) => setMode(event.target.value as ReportMode)}>{MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        </div>
      </section>

      <article className="report-page mx-auto min-h-[297mm] max-w-[210mm] bg-white px-[12mm] py-[11mm] shadow-xl" data-report-scope={scope} data-customer-count={customers.length} data-territory-count={territories.length}>
        <header className="border-b-2 border-brand-500 pb-5">
          <div className="flex items-start justify-between gap-5"><div><p className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-600">SONGTAH SALES REPORT</p><h2 className="mt-2 text-2xl font-bold text-stone-900">{salesperson.name}｜{scopeLabel}</h2><p className="mt-2 text-sm text-stone-500">{scope === 'territories' ? `合併 ${territories.length} 個有效轄區，一次查看市場與客戶名單。` : '依客戶主檔目前負責業務產出，不受轄區設定限制。'}</p></div><div className="rounded-full bg-stone-900 px-3 py-1.5 text-[10px] font-bold tracking-wider text-white">內部機密</div></div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-stone-400"><span>報表範圍：{reportLabel}</span><span>產出時間：{generatedAt}</span><span>產出人員：{generatedBy || '系統使用者'}</span></div>
        </header>

        {(mode === 'both' || mode === 'summary') && (
          <section className="mt-6">
            <div className="avoid-break flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">SUMMARY</p><h3 className="mt-1 text-lg font-bold">報表數量統計</h3></div><p className="text-xs text-stone-400">客戶主檔／轄區市場資料</p></div>
            <div className="mt-4 grid grid-cols-3 gap-3"><div className="rounded-2xl bg-brand-50/70 p-4"><p className="text-xs text-stone-500">{scope === 'territories' ? '有效轄區' : '分布行政區'}</p><p className="mt-2 text-2xl font-bold text-brand-700">{(scope === 'territories' ? territories.length : areaGroups.length).toLocaleString()}</p></div><div className="rounded-2xl bg-stone-50 p-4"><p className="text-xs text-stone-500">{scope === 'territories' ? '市場總數' : '名下客戶'}</p><p className="mt-2 text-2xl font-bold text-stone-800">{(scope === 'territories' ? (type ? marketByType[type] : marketTotal) : visibleCustomers.length).toLocaleString()}</p></div><div className="rounded-2xl bg-stone-50 p-4"><p className="text-xs text-stone-500">可列印名單</p><p className="mt-2 text-2xl font-bold text-stone-800">{visibleCustomers.length.toLocaleString()}</p></div></div>
            <div className="mt-3 grid grid-cols-3 gap-3">{CUSTOMER_TYPES.filter((item) => !type || type === item).map((item) => <div key={item} className="rounded-2xl bg-stone-50 p-4"><p className="text-xs font-semibold text-stone-500">{item}</p><p className="mt-2 text-xl font-bold text-stone-800">{customerCounts[item].toLocaleString()}</p><p className="mt-1 text-[10px] text-stone-400">主檔可列印</p></div>)}</div>
            {filteredHiddenCount > 0 && <p className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-[10px] text-stone-400">依權限已隱藏 {filteredHiddenCount.toLocaleString()} 家由其他業務負責的客戶明細；市場總數不受影響。</p>}
            <div className="mt-5 avoid-break"><p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{scope === 'territories' ? 'TERRITORIES' : 'CUSTOMER DISTRIBUTION'}</p><h4 className="mt-1 font-bold text-stone-800">{scope === 'territories' ? '轄區明細' : '客戶地區分布'}</h4><div className="mt-3 grid grid-cols-2 gap-2">{scope === 'territories' ? filteredTerritories.map((territory) => <div key={territory.id} className="rounded-xl bg-stone-50 px-3 py-2.5"><div className="flex justify-between gap-3 text-xs"><b>{territory.city}{territory.district}</b><span className="text-stone-400">市場 {territory.filteredMarket}／名單 {territory.filteredCustomers}</span></div></div>) : areaGroups.map((area) => <div key={area.label} className="rounded-xl bg-stone-50 px-3 py-2.5"><div className="flex justify-between gap-3 text-xs"><b>{area.label}</b><span className="text-stone-400">{area.count} 家</span></div></div>)}</div>{(scope === 'territories' ? filteredTerritories : areaGroups).length === 0 && <p className="mt-3 text-sm text-stone-400">目前沒有資料</p>}</div>
          </section>
        )}

        {(mode === 'both' || mode === 'list') && (
          <section className="mt-7">
            <div className="avoid-break flex items-end justify-between gap-3 border-b border-stone-900/[0.08] pb-3"><div><p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">CUSTOMER LIST</p><h3 className="mt-1 text-lg font-bold">客戶名單</h3></div><p className="text-xs text-stone-400">共 {visibleCustomers.length.toLocaleString()} 家</p></div>
            <table className="mt-3 w-full border-collapse text-left text-[10px]"><thead><tr className="border-b border-stone-300 text-stone-500"><th className="w-8 py-2 pr-2 font-semibold">#</th><th className="py-2 pr-3 font-semibold">客戶名稱</th><th className="py-2 pr-3 font-semibold">地區</th><th className="py-2 pr-3 font-semibold">類型</th><th className="py-2 pr-3 font-semibold">開發階段</th><th className="py-2 font-semibold">負責業務</th></tr></thead><tbody>{visibleCustomers.map((customer, index) => <tr key={customer.id} className="border-b border-stone-900/[0.06]"><td className="py-2.5 pr-2 text-stone-400">{index + 1}</td><td className="py-2.5 pr-3 font-semibold text-stone-800">{customer.name}<span className="mt-0.5 block text-[9px] font-normal text-stone-400">{customer.status || '機構狀態未標示'}</span></td><td className="py-2.5 pr-3 text-stone-600">{customer.city || '—'}{customer.district || ''}</td><td className="py-2.5 pr-3 text-stone-600">{customer.type || '未分類'}</td><td className="py-2.5 pr-3 text-stone-600">{customer.devStage || '尚未設定'}</td><td className="py-2.5 text-stone-600">{customer.salesperson || '尚未認領'}</td></tr>)}{visibleCustomers.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-sm text-stone-400">此篩選條件沒有可列印的客戶</td></tr>}</tbody></table>
          </section>
        )}

        <footer className="report-footer mt-8 flex items-center justify-between border-t border-stone-900/[0.08] pt-3 text-[9px] text-stone-400"><span>崧達企業管理系統｜業務報表</span><span>內部機密｜請妥善保管，禁止未經授權轉寄</span></footer>
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
