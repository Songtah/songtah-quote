'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type Row = {
  city: string; district: string; type: string; status: string
  salesperson: string; devStage: string; count: number
}
type Data = { rows: Row[]; updatedAt: string }
type Territory = {
  id: string; name: string; city: string; district: string; salesperson: string; salespersonId: string
  status: string; startDate: string; note: string; creator: string; createdAt: string
}
type ClaimedCustomer = { id: string; name: string; type: string; status: string; devStage: string; previousDevStage?: string }
type CustomerType = '牙醫診所' | '牙體技術所' | '醫院'
type AreaOption = { city: string; district: string; marketTotal: number; byType: Record<CustomerType, number> }
const CUSTOMER_TYPES: { value: '' | CustomerType; label: string }[] = [
  { value: '', label: '全部類型' },
  { value: '牙醫診所', label: '牙醫診所' },
  { value: '牙體技術所', label: '牙體技術所' },
  { value: '醫院', label: '醫院' },
]

const CITY_ORDER = [
  '臺北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣',
  '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣',
  '臺南市', '高雄市', '屏東縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣',
]
const INACTIVE_STATUS = new Set(['已歇業', '停業', '撤銷'])
const EXCLUDED_OWNERS = new Set(['公司', '盤商'])
const cityRank = (city: string) => {
  const index = CITY_ORDER.indexOf(city)
  return index < 0 ? 999 : index
}

export default function TerritoryContent({
  initialData,
  canAssign = false,
  canManageCompany = false,
  canClaim = false,
  currentUserId = '',
  accountOptions = [],
  maintenanceAccounts = [],
  reportAccounts = [],
}: {
  initialData: Data | null
  canAssign?: boolean
  canManageCompany?: boolean
  canClaim?: boolean
  currentUserId?: string
  accountOptions?: { id: string; name: string }[]
  maintenanceAccounts?: { id: string; name: string }[]
  reportAccounts?: { id: string; name: string }[]
}) {
  const [rows, setRows] = useState<Row[]>(initialData?.rows ?? [])
  const [statsReady, setStatsReady] = useState(initialData !== null)
  const [areaOptions, setAreaOptions] = useState<AreaOption[]>([])
  const [updatedAt, setUpdatedAt] = useState(initialData?.updatedAt ?? '')
  const [territories, setTerritories] = useState<Territory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [salespersonFilter, setSalespersonFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'' | CustomerType>('')
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Territory | null>(null)
  const [claimTarget, setClaimTarget] = useState<Territory | null>(null)
  const [companyOpen, setCompanyOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const accountNames = useMemo(() => accountOptions.map((account) => account.name), [accountOptions])

  const loadTerritories = useCallback(async () => {
    setError('')
    try {
      const response = await fetch('/api/territories')
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取轄區失敗')
      setTerritories(json.items ?? [])
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const response = await fetch('/api/customers/region-stats')
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取區域統計失敗')
      setRows(json.rows ?? [])
      setUpdatedAt(json.updatedAt ?? '')
      setStatsReady(true)
    } catch (caught: any) {
      setError(caught.message)
    }
  }, [])

  const loadAreas = useCallback(async () => {
    try {
      const response = await fetch('/api/territories/areas')
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取轄區選項失敗')
      setAreaOptions(json.items ?? [])
    } catch (caught: any) {
      setError(caught.message)
    }
  }, [])

  useEffect(() => {
    loadTerritories()
    loadAreas()
    if (!initialData) loadStats()
  }, [initialData, loadAreas, loadStats, loadTerritories])

  const allAreas = useMemo(() => {
    const map = new Map<string, { city: string; district: string }>()
    for (const area of areaOptions) map.set(`${area.city}|${area.district}`, { city: area.city, district: area.district })
    for (const row of rows) {
      if (!row.city || !row.district || row.city.startsWith('(') || row.district.startsWith('(')) continue
      map.set(`${row.city}|${row.district}`, { city: row.city, district: row.district })
    }
    return Array.from(map.values()).sort((a, b) =>
      cityRank(a.city) - cityRank(b.city) || a.district.localeCompare(b.district, 'zh-TW')
    )
  }, [areaOptions, rows])

  const marketTotals = useMemo(() => new Map(areaOptions.map((area) => [
    `${area.city}|${area.district}`, typeFilter ? area.byType[typeFilter] : area.marketTotal,
  ])), [areaOptions, typeFilter])

  const salespersons = useMemo(() => Array.from(new Set([
    ...accountNames,
    ...territories.map((item) => item.salesperson),
    ...rows.map((row) => row.salesperson).filter((name) => name && !EXCLUDED_OWNERS.has(name)),
  ])).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-TW')), [accountNames, rows, territories])

  const statsFor = useCallback((territory: Territory) => {
    const areaRows = rows.filter((row) =>
      row.city === territory.city && row.district === territory.district && !INACTIVE_STATUS.has(row.status) &&
      (!typeFilter || row.type === typeFilter)
    )
    return {
      total: marketTotals.get(`${territory.city}|${territory.district}`) ?? areaRows.reduce((sum, row) => sum + row.count, 0),
      unassigned: statsReady ? areaRows.filter((row) => !row.salesperson).reduce((sum, row) => sum + row.count, 0) : null,
      developing: statsReady ? areaRows.filter((row) =>
        row.salesperson === territory.salesperson && row.devStage && !['已成交', '流失'].includes(row.devStage)
      ).reduce((sum, row) => sum + row.count, 0) : null,
      converted: statsReady ? areaRows.filter((row) =>
        row.salesperson === territory.salesperson && row.devStage === '已成交'
      ).reduce((sum, row) => sum + row.count, 0) : null,
      otherOwned: statsReady ? areaRows.filter((row) =>
        row.salesperson && row.salesperson !== territory.salesperson
      ).reduce((sum, row) => sum + row.count, 0) : null,
    }
  }, [marketTotals, rows, statsReady, typeFilter])

  const visibleTerritories = useMemo(() => territories.filter((item) =>
    !salespersonFilter || item.salesperson === salespersonFilter
  ), [salespersonFilter, territories])

  const summary = useMemo(() => visibleTerritories.reduce((result, territory) => {
    const stats = statsFor(territory)
    result.total += stats.total
    result.unassigned += stats.unassigned ?? 0
    result.developing += stats.developing ?? 0
    result.converted += stats.converted ?? 0
    return result
  }, { total: 0, unassigned: 0, developing: 0, converted: 0 }), [statsFor, visibleTerritories])

  const maintenanceCounts = useMemo(() => new Map(maintenanceAccounts.map((account) => [
    account.id,
    rows.filter((row) => row.salesperson === account.name).reduce((sum, row) => sum + row.count, 0),
  ])), [maintenanceAccounts, rows])

  const patchClaimedRows = useCallback((territory: Territory, customers: ClaimedCustomer[]) => {
    if (!statsReady) return
    setRows((current) => {
      const next = current.map((row) => ({ ...row }))
      for (const customer of customers) {
        const oldIndex = next.findIndex((row) =>
          row.city === territory.city && row.district === territory.district &&
          row.type === (customer.type || '(未分類)') && row.status === (customer.status || '(空白)') &&
          !row.salesperson && row.devStage === (customer.previousDevStage || '') && row.count > 0
        )
        if (oldIndex >= 0) next[oldIndex].count--
        const newIndex = next.findIndex((row) =>
          row.city === territory.city && row.district === territory.district &&
          row.type === (customer.type || '(未分類)') && row.status === (customer.status || '(空白)') &&
          row.salesperson === territory.salesperson && row.devStage === customer.devStage
        )
        if (newIndex >= 0) next[newIndex].count++
        else next.push({
          city: territory.city, district: territory.district,
          type: customer.type || '(未分類)', status: customer.status || '(空白)',
          salesperson: territory.salesperson, devStage: customer.devStage, count: 1,
        })
      }
      return next.filter((row) => row.count > 0)
    })
  }, [statsReady])

  return (
    <div className="space-y-6">
      <section className="card-soft overflow-hidden">
        <div className="p-5 sm:p-7 bg-gradient-to-br from-white via-white to-brand-50/45">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600">轄區與客戶分開管理</p>
              <h2 className="mt-2 text-xl sm:text-2xl font-bold text-stone-800">先劃分市場，再由業務逐筆認領</h2>
              <p className="mt-2 text-sm leading-6 text-stone-500">
                新增轄區只指定誰負責開發這個地區，不會替任何客戶掛名，也不會改變客戶與轉化統計。
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row lg:ml-auto lg:w-auto">
              {canAssign && reportAccounts.length > 0 && (
                <button onClick={() => setReportOpen(true)} className="px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all">
                  列印業務總表
                </button>
              )}
              {canManageCompany && (
                <button onClick={() => setCompanyOpen(true)} className="px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all">
                  公司客戶調度
                </button>
              )}
              {canAssign && (
                <button onClick={() => setAddOpen(true)} className="px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all">
                  ＋ 新增轄區
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-stone-900/[0.05] sm:grid-cols-4">
          <Metric label="市場客戶" value={summary.total} />
          <Metric label="尚未認領" value={statsReady ? summary.unassigned : null} accent />
          <Metric label="開發中" value={statsReady ? summary.developing : null} />
          <Metric label="已成交階段" value={statsReady ? summary.converted : null} />
        </div>
      </section>

      {maintenanceAccounts.length > 0 && (
        <section className="card-soft p-5 sm:p-6">
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">不參與新轄區</p>
          <h2 className="mt-1 text-lg font-bold text-stone-800">只維護既有客戶</h2>
          <p className="mt-1 text-sm leading-6 text-stone-500">保留名下客戶與日常服務，不會出現在新增轄區、未認領客戶或陌生開發的承接選項。</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {maintenanceAccounts.map((account) => (
              <div key={account.id} className="rounded-full bg-stone-50 px-4 py-2 text-sm text-stone-600">
                <b className="text-stone-800">{account.name}</b>
                <span className="ml-2 text-stone-400">主檔名下 {maintenanceCounts.get(account.id)?.toLocaleString() ?? '—'} 家</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="card-soft p-4 sm:p-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:w-64">
          <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">查看哪位業務</label>
          <select className="select-soft mt-1 block w-full" value={salespersonFilter} onChange={(event) => setSalespersonFilter(event.target.value)}>
            <option value="">全部業務</option>
            {salespersons.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <p className="text-sm text-stone-500 sm:pb-2">
          顯示 {visibleTerritories.length} 個有效轄區
          {updatedAt && <span className="ml-2 text-xs text-stone-400">市場資料 {updatedAt.slice(0, 10)}</span>}
        </p>
        <div className="flex w-full gap-1 overflow-x-auto sm:ml-auto sm:w-auto sm:pb-1">
          {CUSTOMER_TYPES.map((option) => (
            <button
              key={option.value || 'all'}
              onClick={() => setTypeFilter(option.value)}
              className={`min-w-max rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 ${
                typeFilter === option.value
                  ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20'
                  : 'bg-stone-50 text-stone-500 hover:bg-brand-50 hover:text-brand-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {!canAssign && (
        <div className="card-soft p-4 text-sm text-stone-500">
          你可以查看轄區；新增、調整與結束轄區限管理員、中央管理與總經理。
        </div>
      )}
      {error && <div className="card-soft p-4 text-sm text-red-600">{error}</div>}
      {loading && <div className="card-soft p-10 text-center text-sm text-stone-400">載入轄區設定…</div>}

      {!loading && visibleTerritories.length === 0 && (
        <div className="card-soft p-10 text-center">
          <p className="font-semibold text-stone-700">目前還沒有轄區設定</p>
          <p className="mt-1 text-sm text-stone-400">建立第一個轄區也不會修改任何客戶資料。</p>
          {canAssign && <button onClick={() => setAddOpen(true)} className="mt-4 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all">＋ 新增轄區</button>}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {visibleTerritories.map((territory) => {
          const stats = statsFor(territory)
          const mayClaim = canClaim && (canAssign || (!!territory.salespersonId && territory.salespersonId === currentUserId))
          const mayReport = canAssign || (!!territory.salespersonId && territory.salespersonId === currentUserId)
          return (
            <article key={territory.id} className="card-soft card-soft-hover p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-stone-800">{territory.city}{territory.district}</h3>
                    <StatusChip status={territory.status} />
                  </div>
                  <p className="mt-1 text-sm text-stone-500">負責開發：<span className="font-semibold text-stone-700">{territory.salesperson}</span></p>
                </div>
                {canAssign && (
                  <button onClick={() => setEditTarget(territory)} className="px-3.5 py-1.5 rounded-full text-xs font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all">管理</button>
                )}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SmallMetric label="市場" value={stats.total} />
                <SmallMetric label="未認領" value={stats.unassigned} accent />
                <SmallMetric label="開發中" value={stats.developing} />
                <SmallMetric label="已成交" value={stats.converted} />
              </div>

              {(territory.startDate || territory.note || (stats.otherOwned ?? 0) > 0) && (
                <div className="mt-4 space-y-1 text-xs text-stone-400">
                  {territory.startDate && <p>生效日：{territory.startDate}</p>}
                  {territory.note && <p className="line-clamp-2">備註：{territory.note}</p>}
                  {(stats.otherOwned ?? 0) > 0 && <p>此區另有 {stats.otherOwned ?? 0} 家由其他業務／公司負責，保持原歸屬。</p>}
                </div>
              )}

              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                {mayClaim && territory.status !== '暫停' ? (
                  <button onClick={() => setClaimTarget(territory)} className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all">
                    查看未開發名單 {(stats.unassigned ?? 0) > 0 ? `(${stats.unassigned})` : ''}
                  </button>
                ) : (
                  <div className="flex-1 rounded-2xl bg-stone-50 px-4 py-2.5 text-center text-xs text-stone-400">
                    {territory.status === '暫停' ? '轄區已暫停認領' : '只有負責業務可認領此區客戶'}
                  </div>
                )}
                {mayReport && <Link href={`/bd/territories/${territory.id}/report${typeFilter ? `?type=${encodeURIComponent(typeFilter)}` : ''}`} target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 rounded-full text-center text-sm font-semibold border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all">列印報表</Link>}
              </div>
            </article>
          )
        })}
      </div>

      {addOpen && (
        <TerritoryFormModal
          title="新增轄區" accounts={accountOptions} areas={areaOptions} existing={territories}
          onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); loadTerritories() }}
        />
      )}
      {editTarget && (
        <TerritoryEditModal
          territory={editTarget}
          accounts={accountOptions.some((account) => account.id === editTarget.salespersonId)
            ? accountOptions
            : [...accountOptions, { id: editTarget.salespersonId, name: editTarget.salesperson }]}
          onClose={() => setEditTarget(null)} onDone={() => { setEditTarget(null); loadTerritories() }}
        />
      )}
      {claimTarget && (
        <ClaimModal
          territory={claimTarget} onClose={() => setClaimTarget(null)}
          initialType={typeFilter}
          onClaimed={(customers) => { patchClaimedRows(claimTarget, customers); setClaimTarget(null) }}
        />
      )}
      {companyOpen && (
        <CompanyModal
          salespersons={accountNames} allAreas={allAreas} onClose={() => setCompanyOpen(false)}
          onDone={() => { setCompanyOpen(false); loadStats() }}
        />
      )}
      {reportOpen && (
        <SalespersonReportModal
          accounts={reportAccounts}
          initialType={typeFilter}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  )
}

function Metric({ label, value, accent = false }: { label: string; value: number | null; accent?: boolean }) {
  return <div className="bg-white px-4 py-4 text-center"><p className={`text-xl font-bold ${accent ? 'text-brand-600' : 'text-stone-800'}`}>{value === null ? '—' : value.toLocaleString()}</p><p className="mt-0.5 text-xs text-stone-400">{label}</p></div>
}

function SmallMetric({ label, value, accent = false }: { label: string; value: number | null; accent?: boolean }) {
  return <div className="rounded-2xl bg-stone-50/80 px-3 py-3"><p className={`text-lg font-bold ${accent ? 'text-brand-600' : 'text-stone-700'}`}>{value === null ? '—' : value.toLocaleString()}</p><p className="text-[11px] text-stone-400">{label}</p></div>
}

function StatusChip({ status }: { status: string }) {
  const tone = status === '開發中' ? 'bg-brand-100 text-brand-700' : status === '暫停' ? 'bg-amber-50 text-amber-700' : 'bg-stone-100 text-stone-500'
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{status}</span>
}

function SalespersonReportModal({ accounts, initialType, onClose }: {
  accounts: { id: string; name: string }[]
  initialType: '' | CustomerType
  onClose: () => void
}) {
  const [salespersonId, setSalespersonId] = useState(accounts[0]?.id ?? '')
  const query = (scope: 'territories' | 'customers') => {
    const params = new URLSearchParams({ scope })
    if (initialType) params.set('type', initialType)
    return `/bd/salespersons/${salespersonId}/report?${params}`
  }
  return (
    <Modal title="列印業務總表" onClose={onClose}>
      <div className="space-y-4">
        <p className="rounded-2xl bg-stone-50 p-4 text-sm leading-6 text-stone-500">先選擇業務，再決定要合併列印其全部轄區，或列印目前客戶主檔中掛名給他的既有客戶。</p>
        <Field label="選擇業務"><select className="select-soft block w-full" value={salespersonId} onChange={(event) => setSalespersonId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <a href={query('territories')} target="_blank" rel="noopener noreferrer" className="rounded-2xl bg-white p-4 text-left ring-1 ring-stone-900/[0.08] transition-all hover:bg-brand-50/50 hover:ring-brand-300 active:scale-[0.98]"><b className="text-stone-800">全部轄區總名單</b><span className="mt-1 block text-xs leading-5 text-stone-400">合併該業務所有有效轄區的市場統計與客戶名單。</span></a>
          <a href={query('customers')} target="_blank" rel="noopener noreferrer" className="rounded-2xl bg-white p-4 text-left ring-1 ring-stone-900/[0.08] transition-all hover:bg-brand-50/50 hover:ring-brand-300 active:scale-[0.98]"><b className="text-stone-800">既有客戶名單</b><span className="mt-1 block text-xs leading-5 text-stone-400">列印目前負責業務為此人的客戶，不受轄區限制。</span></a>
        </div>
        <div className="flex justify-end"><button onClick={onClose} className="px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">關閉</button></div>
      </div>
    </Modal>
  )
}

function TerritoryFormModal({ title, accounts, areas, existing, onClose, onDone }: {
  title: string; accounts: { id: string; name: string }[]; areas: AreaOption[]; existing: Territory[]
  onClose: () => void; onDone: () => void
}) {
  const [salespersonId, setSalespersonId] = useState(accounts[0]?.id ?? '')
  const [city, setCity] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState('規劃中')
  const [startDate, setStartDate] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<{ marketTotal: number; districts: AreaOption[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const occupied = useMemo(() => new Map(existing.map((item) => [`${item.city}|${item.district}`, item])), [existing])
  const cities = useMemo(() => Array.from(new Set(areas.map((area) => area.city))), [areas])
  const districts = useMemo(() => areas.filter((area) => area.city === city), [areas, city])
  const availableDistricts = useMemo(() => districts.filter((area) => !occupied.has(`${area.city}|${area.district}`)), [districts, occupied])

  const resetPreview = () => setPreview(null)
  const toggleDistrict = (district: string) => {
    setSelected((current) => {
      const next = new Set(current)
      next.has(district) ? next.delete(district) : next.add(district)
      return next
    })
    resetPreview()
  }

  const submit = async (dryRun: boolean) => {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/territories/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, districts: Array.from(selected), salespersonId, status, startDate, note, dryRun }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '建立轄區失敗')
      if (dryRun) setPreview({ marketTotal: json.marketTotal, districts: json.districts ?? [] })
      else onDone()
    } catch (caught: any) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="rounded-2xl bg-brand-50/70 p-4 text-sm leading-6 text-stone-600">
          <b className="text-brand-700">一次設定多區：</b>選一個縣市後，可同時勾選多個行政區；客戶資料異動仍為 <b>0</b> 筆。
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="負責開發業務"><select className="select-soft block w-full" value={salespersonId} onChange={(event) => { setSalespersonId(event.target.value); resetPreview() }}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
          <Field label="縣市"><select className="select-soft block w-full" value={city} onChange={(event) => { setCity(event.target.value); setSelected(new Set()); resetPreview() }}><option value="">請選擇縣市</option>{cities.map((name) => <option key={name}>{name}</option>)}</select></Field>
        </div>

        {city && (
          <div className="rounded-2xl bg-stone-50/70 p-3 ring-1 ring-stone-900/[0.05]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><p className="text-sm font-bold text-stone-700">選擇行政區</p><p className="text-xs text-stone-400">已選 {selected.size} 區</p></div>
              <div className="flex gap-2 text-xs font-semibold"><button onClick={() => { setSelected(new Set(availableDistricts.map((area) => area.district))); resetPreview() }} className="rounded-full bg-white px-3 py-1.5 text-brand-700 ring-1 ring-stone-900/[0.06] active:scale-95 transition-all">全選可用區域</button><button onClick={() => { setSelected(new Set()); resetPreview() }} className="rounded-full px-3 py-1.5 text-stone-500 hover:bg-white active:scale-95 transition-all">清除</button></div>
            </div>
            <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
              {districts.map((area) => {
                const owner = occupied.get(`${area.city}|${area.district}`)
                const checked = selected.has(area.district)
                return <button key={area.district} disabled={!!owner} onClick={() => toggleDistrict(area.district)} className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all ${owner ? 'cursor-not-allowed bg-stone-100/70 text-stone-300' : checked ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'bg-white text-stone-600 ring-1 ring-stone-900/[0.06] hover:bg-brand-50 active:scale-[0.99]'}`}><span className={`flex size-5 items-center justify-center rounded-full text-xs ${checked ? 'bg-white/20' : 'bg-stone-100'}`}>{checked ? '✓' : ''}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{area.district}</span><span className={`block text-[11px] ${checked ? 'text-white/70' : 'text-stone-400'}`}>{owner ? `已由 ${owner.salesperson} 負責` : `市場 ${area.marketTotal} 家`}</span></span></button>
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="狀態"><select className="select-soft block w-full" value={status} onChange={(event) => { setStatus(event.target.value); resetPreview() }}><option>規劃中</option><option>開發中</option><option>暫停</option></select></Field>
          <Field label="生效日"><input className="input-soft block w-full" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); resetPreview() }} /></Field>
        </div>
        <Field label="備註"><textarea className="input-soft block min-h-20 w-full resize-y" value={note} maxLength={1000} onChange={(event) => { setNote(event.target.value); resetPreview() }} placeholder="例如：本季優先開發數位牙科客戶" /></Field>
        {preview && <div className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-600"><p>將建立 <b className="text-brand-700">{preview.districts.length}</b> 個轄區，涵蓋市場約 <b>{preview.marketTotal}</b> 家。</p><p className="mt-1 text-xs text-stone-400">{preview.districts.map((area) => area.district).join('、')}</p><p className="mt-2 text-xs font-semibold text-brand-700">不會修改任何客戶的負責業務或開發階段。</p></div>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">取消</button>
          {!preview ? <button onClick={() => submit(true)} disabled={busy || !salespersonId || !city || selected.size === 0} className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all disabled:opacity-40">{busy ? '檢查中…' : `下一步：確認 ${selected.size} 區`}</button> : <button onClick={() => submit(false)} disabled={busy} className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-40">{busy ? '建立中…' : `確認建立 ${preview.districts.length} 區`}</button>}
        </div>
      </div>
    </Modal>
  )
}

function TerritoryEditModal({ territory, accounts, onClose, onDone }: { territory: Territory; accounts: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [salespersonId, setSalespersonId] = useState(territory.salespersonId)
  const [status, setStatus] = useState(territory.status)
  const [startDate, setStartDate] = useState(territory.startDate)
  const [note, setNote] = useState(territory.note)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/territories/${territory.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ salespersonId, status, startDate, note }) })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '更新失敗')
      onDone()
    } catch (caught: any) { setError(caught.message) } finally { setBusy(false) }
  }
  const end = async () => {
    if (!window.confirm(`確定結束 ${territory.city}${territory.district} 的轄區設定？既有客戶歸屬與紀錄都會保留。`)) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/territories/${territory.id}`, { method: 'DELETE' })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '結束轄區失敗')
      onDone()
    } catch (caught: any) { setError(caught.message) } finally { setBusy(false) }
  }
  return <Modal title={`管理 ${territory.city}${territory.district}`} onClose={onClose}><div className="space-y-4">
    <div className="rounded-2xl bg-stone-50 p-4 text-sm leading-6 text-stone-500">調整負責人或狀態只會修改轄區設定，既有客戶不會轉移或解除掛名。</div>
    <Field label="負責開發業務"><select className="select-soft block w-full" value={salespersonId} onChange={(event) => setSalespersonId(event.target.value)}>{accounts.filter((account) => account.id).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="狀態"><select className="select-soft block w-full" value={status} onChange={(event) => setStatus(event.target.value)}><option>規劃中</option><option>開發中</option><option>暫停</option></select></Field><Field label="生效日"><input className="input-soft block w-full" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field></div>
    <Field label="備註"><textarea className="input-soft block min-h-20 w-full resize-y" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
    {error && <p className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-2"><button onClick={end} disabled={busy} className="px-4 py-2.5 rounded-full text-sm font-medium border border-red-200 bg-white text-red-600 hover:bg-red-50 active:scale-95 transition-all">結束轄區</button><button onClick={onClose} className="ml-auto px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">取消</button><button onClick={save} disabled={busy} className="px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all disabled:opacity-40">{busy ? '儲存中…' : '儲存設定'}</button></div>
  </div></Modal>
}

function ClaimModal({ territory, initialType, onClose, onClaimed }: { territory: Territory; initialType: '' | CustomerType; onClose: () => void; onClaimed: (customers: ClaimedCustomer[]) => void }) {
  const [items, setItems] = useState<ClaimedCustomer[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'' | CustomerType>(initialType)
  const [preview, setPreview] = useState<ClaimedCustomer[] | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    setBusy(true); setError(''); setItems([]); setChecked(new Set()); setPreview(null)
    const query = type ? `?type=${encodeURIComponent(type)}` : ''
    fetch(`/api/territories/${territory.id}/candidates${query}`).then(async (response) => {
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取名單失敗')
      setItems(json.items ?? [])
    }).catch((caught) => setError(caught.message)).finally(() => setBusy(false))
  }, [territory.id, type])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => `${item.name} ${item.type} ${item.status}`.toLowerCase().includes(needle))
  }, [items, query])
  const toggle = (id: string) => setChecked((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); setPreview(null); return next })
  const submit = async (dryRun: boolean) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/territories/${territory.id}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerIds: Array.from(checked), dryRun }) })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '認領失敗')
      if (dryRun) setPreview(json.eligible ?? [])
      else onClaimed(json.eligible ?? [])
    } catch (caught: any) { setError(caught.message) } finally { setBusy(false) }
  }
  return <Modal title={`${territory.city}${territory.district}｜未開發名單`} onClose={onClose} wide><div className="space-y-4">
    <div className="rounded-2xl bg-brand-50/70 p-4 text-sm leading-6 text-stone-600">只有你勾選並再次確認的客戶，才會認領給 <b>{territory.salesperson}</b>；開發階段或來源空白時才補上「線索／轄區開發」，既有歷程會保留。</div>
    <div className="flex gap-1 overflow-x-auto">
      {CUSTOMER_TYPES.map((option) => <button key={option.value || 'all'} onClick={() => setType(option.value)} className={`min-w-max rounded-full px-3.5 py-2 text-xs font-semibold transition-all active:scale-95 ${type === option.value ? 'bg-brand-500 text-white' : 'bg-stone-50 text-stone-500 hover:bg-brand-50 hover:text-brand-700'}`}>{option.label}</button>)}
    </div>
    <input className="input-soft block w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋客戶名稱或類型" />
    {busy && <p className="py-8 text-center text-sm text-stone-400">載入中…</p>}
    {error && <p className="text-sm text-red-600">{error}</p>}
    {!busy && !error && <>
      <div className="flex items-center justify-between text-xs"><span className="text-stone-400">找到 {filtered.length} 家，已選 {checked.size} 家</span><button onClick={() => { setChecked(new Set(filtered.map((item) => item.id))); setPreview(null) }} className="text-brand-600 hover:text-brand-700 active:scale-95 transition-all">選取目前結果</button></div>
      <ul className="max-h-72 overflow-y-auto divide-y divide-stone-900/[0.04] rounded-2xl ring-1 ring-stone-900/[0.06]">
        {filtered.map((item) => <li key={item.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-brand-50/50 transition-colors"><input type="checkbox" className="h-4 w-4 accent-[#9a7041]" checked={checked.has(item.id)} onChange={() => toggle(item.id)} /><span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-700">{item.name}</span>{item.type && <span className="chip text-[10px]">{item.type}</span>}</li>)}
        {filtered.length === 0 && <li className="p-8 text-center text-sm text-stone-400">沒有符合條件的未認領客戶</li>}
      </ul>
    </>}
    {preview && <div className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-600">再次確認後會認領 <b className="text-brand-700">{preview.length}</b> 家；其他客戶完全不動。</div>}
    <div className="flex gap-2"><button onClick={onClose} className="flex-1 px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">取消</button>{!preview ? <button onClick={() => submit(true)} disabled={busy || checked.size === 0} className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all disabled:opacity-40">下一步：預覽認領</button> : <button onClick={() => submit(false)} disabled={busy || preview.length === 0} className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-40">確認認領 {preview.length} 家</button>}</div>
  </div></Modal>
}

function CompanyModal({ salespersons, allAreas, onClose, onDone }: { salespersons: string[]; allAreas: { city: string; district: string }[]; onClose: () => void; onDone: () => void }) {
  const [salesperson, setSalesperson] = useState(salespersons[0] ?? '')
  const [direction, setDirection] = useState<'assign' | 'collect'>('assign')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [items, setItems] = useState<{ id: string; name: string; type: string }[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cities = useMemo(() => Array.from(new Set(allAreas.map((area) => area.city))), [allAreas])
  const districts = useMemo(() => allAreas.filter((area) => area.city === city), [allAreas, city])
  const load = async (nextDirection = direction, nextSalesperson = salesperson, nextCity = city, nextDistrict = district) => {
    if (!nextCity || !nextDistrict || !nextSalesperson) return
    setBusy(true); setError(''); setChecked(new Set())
    try {
      const owner = nextDirection === 'assign' ? '公司' : nextSalesperson
      const response = await fetch('/api/customers/assign-company?' + new URLSearchParams({ city: nextCity, district: nextDistrict, owner }))
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '讀取名單失敗')
      setItems(json.items ?? [])
    } catch (caught: any) { setError(caught.message) } finally { setBusy(false) }
  }
  const move = async () => {
    setBusy(true); setError('')
    try {
      const from = direction === 'assign' ? '公司' : salesperson
      const to = direction === 'assign' ? salesperson : '公司'
      const response = await fetch('/api/customers/assign-company', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerIds: Array.from(checked), from, to, dryRun: false }) })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '調度失敗')
      onDone()
    } catch (caught: any) { setError(caught.message) } finally { setBusy(false) }
  }
  return <Modal title="公司既有客戶調度" onClose={onClose} wide><div className="space-y-4">
    <div className="rounded-2xl bg-stone-50 p-4 text-sm text-stone-500">這是既有客戶的低頻管理功能，會修改勾選客戶的負責業務；與新增轄區完全分開。</div>
    <Field label="目標業務"><select className="select-soft block w-full" value={salesperson} onChange={(event) => { setSalesperson(event.target.value); setItems([]) }}>{salespersons.map((name) => <option key={name}>{name}</option>)}</select></Field>
    <div className="grid grid-cols-2 gap-2"><button onClick={() => { setDirection('assign'); setItems([]) }} className={`rounded-full px-3 py-2 text-xs font-semibold active:scale-95 transition-all ${direction === 'assign' ? 'bg-brand-500 text-white' : 'border border-stone-200 bg-white text-stone-600'}`}>公司 → 業務</button><button onClick={() => { setDirection('collect'); setItems([]) }} className={`rounded-full px-3 py-2 text-xs font-semibold active:scale-95 transition-all ${direction === 'collect' ? 'bg-brand-500 text-white' : 'border border-stone-200 bg-white text-stone-600'}`}>業務 → 公司</button></div>
    <div className="grid grid-cols-2 gap-3"><Field label="縣市"><select className="select-soft block w-full" value={city} onChange={(event) => { setCity(event.target.value); setDistrict(''); setItems([]) }}><option value="">請選擇</option>{cities.map((name) => <option key={name}>{name}</option>)}</select></Field><Field label="行政區"><select className="select-soft block w-full" value={district} disabled={!city} onChange={(event) => { const value = event.target.value; setDistrict(value); load(direction, salesperson, city, value) }}><option value="">請選擇</option>{districts.map((area) => <option key={area.district}>{area.district}</option>)}</select></Field></div>
    {busy && <p className="text-sm text-stone-400">處理中…</p>}{error && <p className="text-sm text-red-600">{error}</p>}
    {items.length > 0 && <ul className="max-h-64 overflow-y-auto divide-y divide-stone-900/[0.04] rounded-2xl ring-1 ring-stone-900/[0.06]">{items.map((item) => <li key={item.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-brand-50/50"><input type="checkbox" className="accent-[#9a7041]" checked={checked.has(item.id)} onChange={() => setChecked((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next })} /><span className="min-w-0 flex-1 truncate text-sm text-stone-700">{item.name}</span>{item.type && <span className="chip text-[10px]">{item.type}</span>}</li>)}</ul>}
    <div className="flex gap-2"><button onClick={onClose} className="flex-1 px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">取消</button><button onClick={move} disabled={busy || checked.size === 0} className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all disabled:opacity-40">確認調度 {checked.size > 0 ? `${checked.size} 家` : ''}</button></div>
  </div></Modal>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-stone-400">{label}</span>{children}</label>
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-sm" onClick={onClose}><div className={`max-h-[92vh] w-full overflow-hidden rounded-3xl bg-[#fdfdfb] shadow-2xl ring-1 ring-stone-900/[0.06] ${wide ? 'max-w-2xl' : 'max-w-lg'}`} onClick={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b border-stone-900/[0.06] px-5 py-4 sm:px-6"><h3 className="font-bold text-stone-800">{title}</h3><button onClick={onClose} className="text-xl leading-none text-stone-400 hover:text-stone-600 active:scale-95 transition-all">×</button></header><div className="max-h-[calc(92vh-62px)] overflow-y-auto p-5 sm:p-6">{children}</div></div></div>
}
