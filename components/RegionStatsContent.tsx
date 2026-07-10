'use client'
/**
 * RegionStatsContent — 區域客戶儀表板(/customers/regions)
 *
 * 資料源:頁面 SSR 以 peekRegionStatsRows 注入 initialData(開頁即有,不轉圈);
 * 無快取時才 client fetch 一次。手動「重新統計」走 ?refresh=1(全庫重掃)。
 *
 * 篩選:地區快選(北/中/南/東/離島)→ 縣市多選 → 行政區多選(可篩到單一區);
 * 類型/機構狀態/負責業務皆為下拉。「既有客戶」=負責業務非空(改定義只動 isExisting)。
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'

type Row = {
  city: string; district: string; type: string; status: string
  salesperson: string; devStage: string; count: number
}
type Data = { rows: Row[]; updatedAt: string }

// 地區分組(依台灣地理;資料裡未列到的縣市自動歸「其他」)
const REGION_GROUPS: { label: string; cities: string[] }[] = [
  { label: '北部', cities: ['臺北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣'] },
  { label: '中部', cities: ['苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣'] },
  { label: '南部', cities: ['嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣'] },
  { label: '東部', cities: ['花蓮縣', '臺東縣'] },
  { label: '離島', cities: ['澎湖縣', '金門縣', '連江縣'] },
  { label: '海外/其他', cities: ['香港', '上海', '(未填縣市)'] },
]
const QUICK = [
  { key: '北', label: '北區', cities: REGION_GROUPS[0].cities },
  { key: '中', label: '中區', cities: REGION_GROUPS[1].cities },
  { key: '南', label: '南區', cities: REGION_GROUPS[2].cities },
  { key: '東', label: '東部', cities: REGION_GROUPS[3].cities },
  { key: '離島', label: '離島', cities: REGION_GROUPS[4].cities },
]
const MAIN_TYPES = ['牙醫診所', '牙體技術所', '醫院'] as const
const TYPE_OPTIONS = [...MAIN_TYPES, '其他']
const STATUS_OPTIONS = ['開業', '狀況不明', '停業', '已歇業', '撤銷', '(空白)']

const isExisting = (r: Row) => !!r.salesperson

type SortKey = 'district' | 'total' | 'clinics' | 'labs' | 'hospitals' | 'existing' | 'leads' | 'coverage' | 'unassigned'

function fmtTime(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  const rel = mins < 60 ? `${mins} 分鐘前` : mins < 1440 ? `${Math.round(mins / 60)} 小時前` : `${Math.round(mins / 1440)} 天前`
  return `${d.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}(${rel})`
}

// 覆蓋率單列(標籤 + 進度條 + % + 既有/總)
function CovRow({ label, c, bold }: { label: string; c: { total: number; existing: number; pct: number }; bold?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-20 shrink-0 text-sm ${bold ? 'font-bold text-stone-800' : 'text-stone-600'}`}>{label}</span>
      <div className="flex-1 h-2 rounded-full bg-stone-100 overflow-hidden">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(c.pct, 100)}%` }} />
      </div>
      <span className={`w-11 shrink-0 text-right text-sm ${bold ? 'font-bold text-brand-600' : 'font-semibold text-stone-700'}`}>{c.pct}%</span>
      <span className="w-24 shrink-0 text-right text-xs text-stone-400">{c.existing.toLocaleString()} / {c.total.toLocaleString()}</span>
    </div>
  )
}

export default function RegionStatsContent({ initialData, canAssign = false }: { initialData: Data | null; canAssign?: boolean }) {
  const [rows, setRows] = useState<Row[]>(initialData?.rows ?? [])
  const [updatedAt, setUpdatedAt] = useState(initialData?.updatedAt ?? '')
  const [loading, setLoading] = useState(!initialData)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [assignMode, setAssignMode] = useState(false) // 分派模式(限主管)
  const [assignTarget, setAssignTarget] = useState<{ city: string; district: string } | null>(null)
  const [reassignFrom, setReassignFrom] = useState<string | null>(null) // 業務離職轉移的來源業務

  const [cities, setCities] = useState<Set<string>>(new Set(REGION_GROUPS[0].cities))
  const [districtSel, setDistrictSel] = useState<Set<string>>(new Set()) // key = city|district;空=全部
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [spFilter, setSpFilter] = useState('')
  const [excludeClosed, setExcludeClosed] = useState(false) // 排除已歇業
  const [excludePersonal, setExcludePersonal] = useState(false) // 排除個人客戶
  const [assignSummaryView, setAssignSummaryView] = useState<'numbers' | 'bars'>('numbers')
  const [expanded, setExpanded] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' })
  const [openPop, setOpenPop] = useState<string>('') // 開啟中的下拉
  // 客戶清單彈窗:點某區某業務時開啟
  const [modal, setModal] = useState<{ city: string; district: string; salesperson: string } | null>(null)

  const fetchData = useCallback(async (refresh: boolean) => {
    refresh ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/customers/region-stats' + (refresh ? '?refresh=1' : ''))
      if (!res.ok) throw new Error((await res.json()).error ?? '讀取失敗')
      const data = await res.json()
      setRows(data.rows ?? []); setUpdatedAt(data.updatedAt ?? '')
    } catch (e: any) {
      setError(e?.message ?? '讀取區域統計失敗')
    } finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { if (!initialData) fetchData(false) }, [initialData, fetchData])

  // 資料實際出現的縣市,依地理分組(未歸類者進「其他」)
  const groupedCities = useMemo(() => {
    const present = new Set(rows.map((r) => r.city))
    const known = new Set(REGION_GROUPS.flatMap((g) => g.cities))
    const groups = REGION_GROUPS.map((g) => ({ label: g.label, cities: g.cities.filter((c) => present.has(c)) }))
      .filter((g) => g.cities.length > 0)
    const others = Array.from(present).filter((c) => !known.has(c)).sort()
    if (others.length) groups.push({ label: '其他', cities: others })
    return groups
  }, [rows])

  const allSalespersons = useMemo(
    () => Array.from(new Set(rows.filter((r) => r.salesperson).map((r) => r.salesperson))).sort(),
    [rows])

  // 有效的行政區選擇:剔除已不在所選縣市裡的(避免換縣市後殘留把表格篩空)
  const effDistrictSel = useMemo(() => {
    if (districtSel.size === 0) return null // null = 全部
    const valid = new Set<string>()
    Array.from(districtSel).forEach((k) => {
      const city = k.split('|')[0]
      if (cities.size === 0 || cities.has(city)) valid.add(k)
    })
    return valid.size ? valid : null
  }, [districtSel, cities])

  // 目前所選縣市底下的行政區清單(供行政區下拉)
  const districtOptions = useMemo(() => {
    const m = new Map<string, number>() // city|district → count
    for (const r of rows) {
      if (cities.size > 0 && !cities.has(r.city)) continue
      if (typeFilter && (typeFilter === '其他' ? MAIN_TYPES.includes(r.type as any) : r.type !== typeFilter)) continue
      if (statusFilter && r.status !== statusFilter) continue
      if (excludeClosed && r.status === '已歇業') continue
      if (excludePersonal && r.type === '個人') continue
      const k = r.city + '|' + r.district
      m.set(k, (m.get(k) ?? 0) + r.count)
    }
    return Array.from(m.entries())
      .map(([k, n]) => ({ key: k, city: k.split('|')[0], district: k.split('|')[1], count: n }))
      .sort((a, b) => a.city.localeCompare(b.city, 'zh-TW') || b.count - a.count)
  }, [rows, cities, typeFilter, statusFilter, excludeClosed, excludePersonal])

  // 地理範圍:只套用地區/行政區。業務轄區必須用這份資料推算,
  // 避免類型/狀態/排除個人反向改變「該業務有哪些轄區」。
  const geoFiltered = useMemo(() => rows.filter((r) =>
    (cities.size === 0 || cities.has(r.city)) &&
    (!effDistrictSel || effDistrictSel.has(r.city + '|' + r.district))
  ), [rows, cities, effDistrictSel])

  // 基礎篩選結果:套用地區/行政區/類型/狀態/排除已歇業/排除個人。
  // 分派模式必須使用這份資料,避免被「負責業務轄區視角」縮小分派池。
  const baseFiltered = useMemo(() => rows.filter((r) =>
    (cities.size === 0 || cities.has(r.city)) &&
    (!effDistrictSel || effDistrictSel.has(r.city + '|' + r.district)) &&
    (!typeFilter || (typeFilter === '其他' ? !MAIN_TYPES.includes(r.type as any) : r.type === typeFilter)) &&
    (!statusFilter || r.status === statusFilter) &&
    (!excludeClosed || r.status !== '已歇業') &&
    (!excludePersonal || r.type !== '個人')
  ), [rows, cities, effDistrictSel, typeFilter, statusFilter, excludeClosed, excludePersonal])

  /**
   * scope:檢視模式納入統計的列 + 「我方」定義。
   * - 未選業務:我方=任何有負責業務者;範圍=所有符合篩選的機構(市場滲透率)。
   * - 選了業務:切「業務轄區視角」——範圍=該業務有客戶的行政區(轄區)內的所有機構;
   *   我方=該業務自己的客戶。覆蓋率 = 該業務客戶 ÷ 轄區市場總數。
   *   (若不這樣做,單純用業務篩掉別人的列會讓分母=分子、覆蓋率永遠 100%,失去意義。)
   */
  const scope = useMemo(() => {
    if (!spFilter) return { rows: baseFiltered, mine: isExisting, spMode: false, territoryCount: 0 }
    const terr = new Set(geoFiltered.filter((r) => r.salesperson === spFilter).map((r) => r.city + '|' + r.district))
    const inTerr = baseFiltered.filter((r) => terr.has(r.city + '|' + r.district))
    return { rows: inTerr, mine: (r: Row) => r.salesperson === spFilter, spMode: true, territoryCount: terr.size }
  }, [baseFiltered, geoFiltered, spFilter])

  // 分派模式:選了負責業務時,收斂到「該業務有客戶的行政區」(轄區),但每區仍保留完整分派池
  // (含未分派/公司/其他業務)——這樣負責業務篩選會連動,又不會把該區的未分派數縮成 0。
  const assignmentRows = useMemo(() => {
    if (!spFilter) return baseFiltered
    const terr = new Set(geoFiltered.filter((r) => r.salesperson === spFilter).map((r) => r.city + '|' + r.district))
    return baseFiltered.filter((r) => terr.has(r.city + '|' + r.district))
  }, [baseFiltered, geoFiltered, spFilter])
  const assignmentDisplayRows = useMemo(() => (
    assignMode && spFilter ? assignmentRows.filter((r) => r.salesperson === spFilter) : assignmentRows
  ), [assignMode, assignmentRows, spFilter])
  const filtered = assignMode ? assignmentRows : scope.rows
  const mine = assignMode ? isExisting : scope.mine

  // 業務持有一覽:業務→持有數(依目前篩選範圍;含公司/盤商,離職重分時看全貌)
  const holdings = useMemo(() => {
    const m: Record<string, number> = {}
    const source = assignMode ? assignmentDisplayRows : filtered
    for (const r of source) if (r.salesperson) m[r.salesperson] = (m[r.salesperson] ?? 0) + r.count
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [assignMode, assignmentDisplayRows, filtered])

  const summary = useMemo(() => {
    const base = filtered
    const sum = (p: (r: Row) => boolean) => base.filter(p).reduce((s, r) => s + r.count, 0)
    const total = sum(() => true), existing = sum(mine)
    // 各類型覆蓋率(我方 ÷ 該類型總機構)——牙醫/牙技所/醫院分開看,避免合併失真
    const typeCov = (t: string) => {
      const tot = sum((r) => r.type === t)
      const exi = sum((r) => r.type === t && mine(r))
      return { total: tot, existing: exi, pct: tot ? Math.round((exi / tot) * 100) : 0 }
    }
    return {
      total, clinics: sum((r) => r.type === '牙醫診所'), labs: sum((r) => r.type === '牙體技術所'),
      hospitals: sum((r) => r.type === '醫院'), unknown: sum((r) => r.status === '狀況不明'),
      existing, leads: sum((r) => r.devStage === '線索'),
      coverage: total ? Math.round((existing / total) * 100) : 0,
      clinicCov: typeCov('牙醫診所'), labCov: typeCov('牙體技術所'), hospCov: typeCov('醫院'),
    }
  }, [filtered, mine])

  type Agg = { city: string; district: string; total: number; clinics: number; labs: number; hospitals: number; others: number; unknown: number; existing: number; companyCovered: number; leads: number; assignedNamed: number; house: number; unassigned: number; bySp: Record<string, number> }
  const districts = useMemo(() => {
    const map = new Map<string, Agg>()
    for (const r of filtered) {
      const key = r.city + '|' + r.district
      let d = map.get(key)
      if (!d) { d = { city: r.city, district: r.district, total: 0, clinics: 0, labs: 0, hospitals: 0, others: 0, unknown: 0, existing: 0, companyCovered: 0, leads: 0, assignedNamed: 0, house: 0, unassigned: 0, bySp: {} }; map.set(key, d) }
      d.total += r.count
      if (r.type === '牙醫診所') d.clinics += r.count
      else if (r.type === '牙體技術所') d.labs += r.count
      else if (r.type === '醫院') d.hospitals += r.count
      else d.others += r.count
      if (r.status === '狀況不明') d.unknown += r.count
      if (mine(r)) d.existing += r.count // 覆蓋率分子:未選業務=全部既有;選了業務=該業務客戶
      if (isExisting(r)) d.companyCovered += r.count // 表格總數欄試作:固定顯示全公司覆蓋數
      if (isExisting(r)) d.bySp[r.salesperson] = (d.bySp[r.salesperson] ?? 0) + r.count // 展開列仍顯示所有業務
      // 分派視角:已具名業務 / 公司+盤商(house) / 未分派(空白)
      if (!r.salesperson) d.unassigned += r.count
      else if (r.salesperson === '公司' || r.salesperson === '盤商') d.house += r.count
      else d.assignedNamed += r.count
      if (r.devStage === '線索') d.leads += r.count
    }
    const cov = (d: Agg) => d.total ? d.existing / d.total : 0
    const val = (d: Agg): number | string => sort.key === 'district' ? d.city + d.district : sort.key === 'coverage' ? cov(d) : (d as any)[sort.key]
    return Array.from(map.values()).sort((a, b) => {
      const va = val(a), vb = val(b)
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string, 'zh-TW') : (va as number) - (vb as number)
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [filtered, mine, sort])

  // ── 篩選操作 ──
  const setRegion = (regionCities: string[]) => { setCities(new Set(regionCities)); setDistrictSel(new Set()) }
  const toggleCity = (c: string) => setCities((prev) => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n })
  const toggleGroup = (gc: string[]) => setCities((prev) => {
    const all = gc.every((c) => prev.has(c)); const n = new Set(prev)
    gc.forEach((c) => all ? n.delete(c) : n.add(c)); return n
  })
  const toggleDistrict = (k: string) => setDistrictSel((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleSort = (key: SortKey) => setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'district' ? 'asc' : 'desc' })
  const resetAll = () => { setCities(new Set(REGION_GROUPS[0].cities)); setDistrictSel(new Set()); setTypeFilter(''); setStatusFilter(''); setSpFilter(''); setExcludeClosed(false); setExcludePersonal(false) }
  const selectSalesperson = (sp: string) => {
    setSpFilter(sp)
    setOpenPop('')
  }
  const enterAssignMode = () => { setAssignMode(true); setOpenPop('') }
  const selectAssignmentSalesperson = (sp: string) => { setSpFilter(sp); setOpenPop('') }

  // 縣市按鈕摘要文字
  const cityLabel = useMemo(() => {
    if (cities.size === 0) return '全台'
    const match = QUICK.find((q) => q.cities.length === cities.size && q.cities.every((c) => cities.has(c)))
    if (match) return match.label
    if (cities.size === 1) return Array.from(cities)[0]
    return `${cities.size} 縣市`
  }, [cities])
  const districtLabel = effDistrictSel === null ? '全部'
    : effDistrictSel.size === 1 ? Array.from(effDistrictSel)[0].split('|')[1] : `${effDistrictSel.size} 區`

  if (loading) {
    return (
      <div className="card-soft p-10 text-center">
        <div className="inline-block w-6 h-6 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        <p className="mt-3 text-sm text-stone-400">正在統計全客戶庫…</p>
      </div>
    )
  }
  if (error && rows.length === 0) {
    return (
      <div className="card-soft p-8 text-center">
        <p className="text-sm text-rose-500">{error}</p>
        <button onClick={() => fetchData(false)} className="mt-4 px-5 py-2 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">重試</button>
      </div>
    )
  }

  const pillBtn = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-all active:scale-95 ${
      active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300'}`

  const SortHead = ({ k, label, className = '' }: { k: SortKey; label: string; className?: string }) => (
    <th className={`px-3 py-3 font-medium whitespace-nowrap cursor-pointer select-none hover:text-stone-600 ${className}`} onClick={() => toggleSort(k)}>
      {label}<span className="ml-0.5 text-stone-300">{sort.key === k ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
    </th>
  )

  // 下拉容器
  const Pop = ({ id, label, value, width = 'w-72', children }: { id: string; label: string; value: string; width?: string; children: React.ReactNode }) => (
    <div className="relative">
      <button type="button" onClick={() => setOpenPop(openPop === id ? '' : id)} className={pillBtn(openPop === id)}>
        <span className="text-stone-400 text-xs">{label}</span>
        <span className="font-semibold">{value}</span>
        <span className="text-stone-300 text-xs">▾</span>
      </button>
      {openPop === id && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpenPop('')} />
          <div className={`absolute z-40 mt-2 ${width} max-h-80 overflow-auto bg-[#fcfbf8] rounded-2xl shadow-2xl ring-1 ring-stone-900/[0.08] p-3`}>{children}</div>
        </>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      {/* 模式切換(限主管) */}
      {canAssign && (
        <div className="order-1 flex items-center gap-2">
          <div className="inline-flex rounded-full bg-stone-100 p-1">
            <button onClick={() => setAssignMode(false)} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${!assignMode ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>檢視模式</button>
            <button onClick={enterAssignMode} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${assignMode ? 'bg-brand-500 text-white shadow-sm' : 'text-stone-500'}`}>分派模式</button>
          </div>
          {assignMode && <span className="text-xs text-stone-400">選業務可看其轄區;分派/釋出只動負責業務空白或該離職業務的客戶</span>}
        </div>
      )}

      {/* 篩選(分派模式移到摘要下方) */}
      <div className={`card-soft p-5 space-y-4 ${assignMode ? 'order-3' : 'order-2'}`}>
        {/* 地區快選 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mr-1">快速選區</span>
          <button className={pillBtn(cities.size === 0)} onClick={() => setRegion([])}>全台</button>
          {QUICK.map((q) => {
            const active = q.cities.length === cities.size && q.cities.every((c) => cities.has(c))
            return <button key={q.key} className={pillBtn(active)} onClick={() => setRegion(q.cities)}>{q.label}</button>
          })}
          <span className="w-px self-stretch bg-stone-900/[0.06] mx-1" />
          <button className={pillBtn(excludeClosed)} onClick={() => setExcludeClosed((v) => !v)}>
            {excludeClosed ? '✓ ' : ''}排除已歇業
          </button>
          <button className={pillBtn(excludePersonal)} onClick={() => setExcludePersonal((v) => !v)}>
            {excludePersonal ? '✓ ' : ''}排除個人
          </button>
        </div>

        {/* 下拉列 */}
        <div className="flex flex-wrap gap-2">
          <Pop id="city" label="縣市" value={cityLabel} width="w-80">
            <div className="flex items-center justify-between px-1 pb-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">選擇縣市</p>
              <button className="text-xs text-brand-600 hover:text-brand-700" onClick={() => setCities(new Set())}>全台</button>
            </div>
            {groupedCities.map((g) => (
              <div key={g.label} className="mb-2">
                <div className="flex items-center gap-2 px-1">
                  <button className="text-[11px] font-semibold text-stone-500 hover:text-brand-600" onClick={() => toggleGroup(g.cities)}>{g.label}</button>
                  <span className="text-[10px] text-stone-300">({g.cities.length})</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {g.cities.map((c) => (
                    <button key={c} onClick={() => toggleCity(c)}
                      className={`px-2.5 py-1 rounded-full text-xs transition-all ${cities.has(c) ? 'bg-brand-500 text-white' : 'bg-white ring-1 ring-stone-900/[0.08] text-stone-600 hover:bg-stone-50'}`}>{c}</button>
                  ))}
                </div>
              </div>
            ))}
          </Pop>

          <Pop id="district" label="行政區" value={districtLabel} width="w-72">
            <div className="flex items-center justify-between px-1 pb-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">行政區({districtOptions.length})</p>
              {effDistrictSel && <button className="text-xs text-brand-600 hover:text-brand-700" onClick={() => setDistrictSel(new Set())}>清除</button>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {districtOptions.length === 0 && <p className="text-xs text-stone-400 px-1 py-2">先選縣市</p>}
              {districtOptions.map((d) => {
                const on = districtSel.has(d.key)
                return (
                  <button key={d.key} onClick={() => toggleDistrict(d.key)}
                    className={`px-2.5 py-1 rounded-full text-xs transition-all ${on ? 'bg-brand-500 text-white' : 'bg-white ring-1 ring-stone-900/[0.08] text-stone-600 hover:bg-stone-50'}`}>
                    {cities.size > 1 && <span className="opacity-60 mr-1">{d.city.replace(/[市縣]$/, '')}</span>}{d.district}
                    <span className={`ml-1 ${on ? 'opacity-80' : 'text-stone-300'}`}>{d.count}</span>
                  </button>
                )
              })}
            </div>
          </Pop>

          <Pop id="type" label="類型" value={typeFilter || '全部'} width="w-52">
            <button onClick={() => { setTypeFilter(''); setOpenPop('') }} className={`block w-full text-left px-3 py-2 rounded-xl text-sm ${!typeFilter ? 'bg-brand-50 text-brand-700 font-semibold' : 'hover:bg-stone-100'}`}>全部</button>
            {TYPE_OPTIONS.map((t) => (
              <button key={t} onClick={() => { setTypeFilter(t); setOpenPop('') }} className={`block w-full text-left px-3 py-2 rounded-xl text-sm ${typeFilter === t ? 'bg-brand-50 text-brand-700 font-semibold' : 'hover:bg-stone-100'}`}>{t}</button>
            ))}
          </Pop>

          <Pop id="status" label="機構狀態" value={statusFilter || '全部'} width="w-52">
            <button onClick={() => { setStatusFilter(''); setOpenPop('') }} className={`block w-full text-left px-3 py-2 rounded-xl text-sm ${!statusFilter ? 'bg-brand-50 text-brand-700 font-semibold' : 'hover:bg-stone-100'}`}>全部</button>
            {STATUS_OPTIONS.map((s) => (
              <button key={s} onClick={() => { setStatusFilter(s); setOpenPop('') }} className={`block w-full text-left px-3 py-2 rounded-xl text-sm ${statusFilter === s ? 'bg-brand-50 text-brand-700 font-semibold' : 'hover:bg-stone-100'}`}>{s}</button>
            ))}
          </Pop>

          <Pop id="sp" label="負責業務" value={spFilter || '全部'} width="w-56">
            <button onClick={() => { setSpFilter(''); setOpenPop('') }} className={`block w-full text-left px-3 py-2 rounded-xl text-sm ${!spFilter ? 'bg-brand-50 text-brand-700 font-semibold' : 'hover:bg-stone-100'}`}>全部業務</button>
            {allSalespersons.map((sp) => (
              <button key={sp} onClick={() => assignMode ? selectAssignmentSalesperson(sp) : selectSalesperson(sp)} className={`block w-full text-left px-3 py-2 rounded-xl text-sm ${spFilter === sp ? 'bg-brand-50 text-brand-700 font-semibold' : 'hover:bg-stone-100'}`}>{sp}</button>
            ))}
          </Pop>

          <button onClick={resetAll} className="px-3 py-2 rounded-full text-sm text-stone-400 hover:text-stone-600 transition-colors">清除全部</button>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-stone-900/[0.06]">
          <p className="text-[11px] text-stone-400">資料時間:{fmtTime(updatedAt)}・「既有客戶」=有負責業務;「線索」=開發階段為線索</p>
          <button onClick={() => fetchData(true)} disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-full border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all disabled:opacity-50">
            {refreshing && <span className="w-3 h-3 border-2 border-stone-300 border-t-brand-500 rounded-full animate-spin" />}
            {refreshing ? '重新統計中…' : '↻ 重新統計'}
          </button>
        </div>
      </div>

      {/* 業務視角橫幅 */}
      {!assignMode && scope.spMode && (
        <div className="order-3 card-soft p-4 flex items-center justify-between flex-wrap gap-3 bg-brand-50/45">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600">業務轄區覆蓋率模式</p>
            <p className="mt-1 text-sm text-stone-600">
              <span className="font-bold text-stone-800">{spFilter}</span>
              ・轄區 <span className="font-semibold text-brand-600">{scope.territoryCount}</span> 個行政區
              ・覆蓋率＝<span className="text-brand-600">{spFilter} 客戶</span> ÷ 轄區市場總數
            </p>
          </div>
          <button onClick={() => setSpFilter('')} className="text-xs px-3 py-1.5 rounded-full border border-stone-200 bg-white text-stone-500 hover:bg-stone-50 active:scale-95 transition-all">← 回全公司視角</button>
        </div>
      )}

      {/* 分派模式:業務持有一覽 + 分派總覽(order-2 = 排在篩選之上) */}
      {assignMode ? (
        <div className="order-2 grid md:grid-cols-2 gap-4">
          <div className="card-soft p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">{spFilter ? `${spFilter} 持有(依篩選範圍)` : '各業務持有(點業務可離職轉移)'}</p>
            {holdings.length === 0 ? (
              <p className="text-sm text-stone-400">此範圍尚無任何指派</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {holdings.map(([sp, n]) => {
                  const house = sp === '公司' || sp === '盤商'
                  if (house) return (
                    <span key={sp} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-stone-100 text-stone-500">
                      <span className="text-[10px]">內部</span>{sp}<span className="font-bold text-stone-500">{n.toLocaleString()}</span>
                    </span>
                  )
                  return (
                    <button key={sp} onClick={() => setReassignFrom(sp)} title={`把 ${sp} 的客戶按行政區轉給接手業務`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm bg-white ring-1 ring-stone-900/[0.08] text-stone-700 hover:bg-brand-50 hover:ring-brand-300 active:scale-95 transition-all">
                      {sp}<span className="font-bold text-brand-600">{n.toLocaleString()}</span><span className="text-stone-300 text-xs">→</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="card-soft p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">分派總覽(依篩選範圍)</p>
              <div className="inline-flex rounded-full bg-stone-100 p-1">
                <button onClick={() => setAssignSummaryView('numbers')} className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${assignSummaryView === 'numbers' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>數字</button>
                <button onClick={() => setAssignSummaryView('bars')} className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${assignSummaryView === 'bars' ? 'bg-brand-500 text-white shadow-sm' : 'text-stone-500'}`}>長條圖</button>
              </div>
            </div>
            <AssignSummary
              view={assignSummaryView}
              assignedNamed={districts.reduce((s, d) => s + d.assignedNamed, 0)}
              house={districts.reduce((s, d) => s + d.house, 0)}
              unassigned={districts.reduce((s, d) => s + d.unassigned, 0)}
            />
            <p className="mt-3 text-[11px] text-stone-400">未分派 = 負責業務空白;公司/盤商/已具名者一律不動。負責業務篩選只影響左側持有數,不會縮小未分派池。</p>
          </div>
        </div>
      ) : (
      <div className="order-4 grid md:grid-cols-2 gap-4">
        <div className="card-soft p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">{scope.spMode ? `${spFilter} 轄區市場` : '市場規模(依篩選)'}</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[['總機構', summary.total], ['牙醫', summary.clinics], ['牙技所', summary.labs], ['醫院', summary.hospitals]].map(([l, n]) => (
              <div key={l as string}><p className="text-2xl font-bold text-stone-800">{(n as number).toLocaleString()}</p><p className="mt-0.5 text-xs text-stone-400">{l}</p></div>
            ))}
          </div>
        </div>
        <div className="card-soft p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-3">{scope.spMode ? `${spFilter} 覆蓋(依類型)` : '我方覆蓋(依類型)'}</p>
          <div className="space-y-2">
            <CovRow label="牙醫診所" c={summary.clinicCov} />
            <CovRow label="牙體技術所" c={summary.labCov} />
            <CovRow label="醫院" c={summary.hospCov} />
            <div className="pt-2 mt-1 border-t border-stone-900/[0.06]">
              <CovRow label="整體" c={{ total: summary.total, existing: summary.existing, pct: summary.coverage }} bold />
            </div>
          </div>
          <p className="mt-3 text-[11px] text-stone-400">
            既有客戶合計 <span className="font-semibold text-emerald-600">{summary.existing.toLocaleString()}</span>
            ・待開發線索 <span className="font-semibold text-sky-600">{summary.leads.toLocaleString()}</span>
            ・狀況不明 <span className="font-semibold text-amber-600">{summary.unknown.toLocaleString()}</span>
          </p>
        </div>
      </div>
      )}

      {/* 明細表 */}
      <div className="order-5 card-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-400 border-b border-stone-900/[0.06]">
                <SortHead k="district" label="縣市 / 行政區" className="!px-5 text-left" />
                <SortHead k="total" label="市場 / 覆蓋" className="text-right" />
                <SortHead k="clinics" label="牙醫" className="text-right" />
                <SortHead k="labs" label="牙技所" className="text-right" />
                <SortHead k="hospitals" label="醫院" className="text-right" />
                <th className="px-3 py-3 font-medium text-right">其他</th>
                {assignMode ? (
                  <>
                    <th className="px-3 py-3 font-medium text-right">已指派</th>
                    <th className="px-3 py-3 font-medium text-right">公司/盤商</th>
                    <SortHead k="unassigned" label="未分派" className="text-right !text-rose-500" />
                    <th className="px-3 py-3 font-medium text-right">分派</th>
                  </>
                ) : (
                  <>
                    <SortHead k="existing" label={scope.spMode ? `${spFilter} 客戶` : '既有客戶'} className="text-right !text-emerald-600" />
                    <SortHead k="leads" label="線索" className="text-right !text-sky-600" />
                    <SortHead k="coverage" label="覆蓋率" className="text-right" />
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-900/[0.04]">
              {districts.map((d) => {
                const key = d.city + '|' + d.district
                const open = expanded === key
                const spEntries = Object.entries(d.bySp).sort((a, b) => b[1] - a[1])
                const coverage = d.total > 0 ? Math.round((d.existing / d.total) * 100) : 0
                return (
                  <Fragment key={key}>
                    <tr className="hover:bg-brand-50/50 cursor-pointer transition-colors" onClick={() => setExpanded(open ? '' : key)}>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="text-xs text-stone-400">{d.city}</span>
                        <span className="ml-2 font-semibold text-stone-800">{d.district}</span>
                        <span className="ml-1.5 text-xs text-stone-300">{open ? '▾' : '▸'}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-bold whitespace-nowrap">
                        <span className="text-stone-800">{d.total.toLocaleString()}</span>
                        <span className="mx-1 text-stone-300">/</span>
                        <span className="text-emerald-600">{d.companyCovered.toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-3 text-right">{d.clinics.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right">{d.labs.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right">{d.hospitals || <span className="text-stone-200">0</span>}</td>
                      <td className="px-3 py-3 text-right text-stone-400">{d.others || <span className="text-stone-200">0</span>}</td>
                      {assignMode ? (
                        <>
                          <td className="px-3 py-3 text-right text-stone-600">{d.assignedNamed || <span className="text-stone-200">0</span>}</td>
                          <td className="px-3 py-3 text-right text-stone-400">{d.house || <span className="text-stone-200">0</span>}</td>
                          <td className="px-3 py-3 text-right font-bold text-rose-500">{d.unassigned.toLocaleString()}</td>
                          <td className="px-3 py-3 text-right">
                            {d.unassigned > 0
                              ? <button onClick={(e) => { e.stopPropagation(); setAssignTarget({ city: d.city, district: d.district }) }}
                                  className="px-3 py-1.5 rounded-full text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/25 active:scale-95 transition-all whitespace-nowrap">分派 →</button>
                              : <span className="text-xs text-stone-300">—</span>}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-3 text-right font-semibold text-emerald-600">{d.existing.toLocaleString()}</td>
                          <td className="px-3 py-3 text-right text-sky-600">{d.leads || <span className="text-stone-200">0</span>}</td>
                          <td className="px-3 py-3 text-right">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-12 h-1.5 rounded-full bg-stone-100 overflow-hidden"><span className="block h-full bg-brand-500" style={{ width: `${Math.min(coverage, 100)}%` }} /></span>
                              <span className="text-xs text-stone-500 w-9 text-right">{coverage}%</span>
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                    {open && (
                      <tr className="bg-stone-50/60">
                        <td colSpan={assignMode ? 10 : 9} className="px-5 py-4">
                          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">{d.city}{d.district}・各業務既有客戶數</p>
                          {spEntries.length === 0 ? (
                            <p className="mt-2 text-sm text-stone-400">此轄區尚無指派負責業務的客戶</p>
                          ) : (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {spEntries.map(([sp, n]) => (
                                <button key={sp} onClick={() => setModal({ city: d.city, district: d.district, salesperson: sp })}
                                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white ring-1 ring-stone-900/[0.08] text-sm hover:bg-brand-50 hover:ring-brand-300 active:scale-95 transition-all">
                                  <span className="font-medium text-stone-700">{sp}</span>
                                  <span className="font-bold text-brand-600">{n}</span>
                                  <span className="text-stone-300 text-xs">→</span>
                                </button>
                              ))}
                            </div>
                          )}
                          <p className="mt-2 text-[11px] text-stone-300">點業務按鈕查看該業務在本區的客戶清單</p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {districts.length === 0 && (
                <tr><td colSpan={assignMode ? 10 : 9} className="px-5 py-10 text-center text-sm text-stone-400">目前篩選條件下沒有資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-stone-900/[0.06] text-xs text-stone-400">
          共 {districts.length} 個行政區・點任一列展開各業務轄區客戶數・點欄位標題可排序
        </div>
      </div>

      {modal && <CustomerModal {...modal} onClose={() => setModal(null)} />}
      {assignTarget && (
        <AssignModal
          {...assignTarget}
          salespersons={allSalespersons.filter((s) => s !== '公司' && s !== '盤商')}
          filters={{ type: typeFilter || undefined, status: statusFilter || undefined, excludeClosed, excludePersonal }}
          onClose={(assigned) => { setAssignTarget(null); if (assigned) fetchData(true) }}
        />
      )}
      {reassignFrom && (
        <ReassignModal
          from={reassignFrom}
          // 該業務在目前篩選範圍內、各行政區的持有(從 rows 直接算,零額外抓取)
          districts={Array.from(rows.filter((r) => r.salesperson === reassignFrom)
            .reduce((m, r) => { const k = r.city + '|' + r.district; m.set(k, (m.get(k) ?? 0) + r.count); return m }, new Map<string, number>())
            .entries()).map(([k, n]) => ({ city: k.split('|')[0], district: k.split('|')[1], count: n })).sort((a, b) => b.count - a.count)}
          successors={allSalespersons.filter((s) => s !== reassignFrom && s !== '公司' && s !== '盤商')}
          onClose={(changed) => { setReassignFrom(null); if (changed) fetchData(true) }}
        />
      )}
    </div>
  )
}

function AssignSummary({ view, assignedNamed, house, unassigned }: {
  view: 'numbers' | 'bars'
  assignedNamed: number
  house: number
  unassigned: number
}) {
  const items = [
    { label: '已指派業務', value: assignedNamed, tone: 'text-stone-700', bar: 'bg-stone-600' },
    { label: '公司/盤商', value: house, tone: 'text-stone-400', bar: 'bg-stone-300' },
    { label: '未分派(可劃)', value: unassigned, tone: 'text-rose-500', bar: 'bg-rose-400' },
  ]
  const total = Math.max(items.reduce((s, i) => s + i.value, 0), 1)
  if (view === 'numbers') {
    return (
      <div className="grid grid-cols-3 gap-2 text-center">
        {items.map((item) => (
          <div key={item.label}>
            <p className={`text-2xl font-bold ${item.tone}`}>{item.value.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-stone-400">{item.label}</p>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {items.map((item) => {
        const pct = Math.round((item.value / total) * 100)
        return (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-stone-600">{item.label}</span>
              <span className={`font-bold ${item.tone}`}>{item.value.toLocaleString()} <span className="text-xs font-medium text-stone-300">({pct}%)</span></span>
            </div>
            <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden">
              <div className={`h-full rounded-full ${item.bar}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 分派彈窗:把某區未分派池劃給某業務 ─────────────────────────────────────────
function AssignModal({ city, district, salespersons, filters, onClose }: {
  city: string; district: string; salespersons: string[]
  filters: { type?: string; status?: string; excludeClosed?: boolean; excludePersonal?: boolean }
  onClose: (assigned: boolean) => void
}) {
  const [pool, setPool] = useState<{ poolSize: number; sample: { name: string; type: string; status: string; phone: string }[] } | null>(null)
  const [sp, setSp] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ assigned: number; skipped: number } | null>(null)
  const [error, setError] = useState('')

  const body = { city, district, ...filters }

  useEffect(() => {
    fetch('/api/customers/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, dryRun: true }) })
      .then((r) => r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error || '讀取失敗'))))
      .then(setPool)
      .catch((e) => setError(e.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function execute() {
    if (!sp) { setError('請選擇要分派的業務'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/customers/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, salesperson: sp, dryRun: false }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || '分派失敗')
      setDone({ assigned: j.assigned, skipped: j.skipped })
    } catch (e: any) { setError(e.message); setBusy(false) }
  }

  const filterNote = [filters.type, filters.status, filters.excludeClosed ? '排除已歇業' : '', filters.excludePersonal ? '排除個人' : ''].filter(Boolean).join('・') || '全部類型與狀態'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-10 overflow-y-auto">
      <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => onClose(!!done)} />
      <div className="relative w-full max-w-lg bg-[#fcfbf8] rounded-3xl shadow-2xl ring-1 ring-stone-900/[0.06] overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-900/[0.06] flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">轄區分派</p>
            <h3 className="text-lg font-bold text-stone-800 mt-0.5">{city}{district} 未分派客戶</h3>
          </div>
          <button onClick={() => onClose(!!done)} className="w-9 h-9 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 transition-all text-lg">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {error && !done && <p className="text-sm text-rose-500">{error}</p>}

          {done ? (
            <div className="text-center py-6">
              <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600">分派完成</p>
              <p className="mt-3 text-lg font-bold text-stone-800">已分派 {done.assigned} 家 → {sp}</p>
              {done.skipped > 0 && <p className="mt-1 text-sm text-stone-400">跳過 {done.skipped} 家(期間已被指派,未覆蓋)</p>}
            </div>
          ) : !pool ? (
            <div className="text-center py-10">
              <div className="inline-block w-5 h-5 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
              <p className="mt-2 text-sm text-stone-400">盤點未分派池…</p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-white ring-1 ring-stone-900/[0.06] p-4">
                <p className="text-sm">此範圍未分派客戶 <span className="text-2xl font-bold text-brand-600">{pool.poolSize}</span> 家</p>
                <p className="mt-1 text-[11px] text-stone-400">篩選:{filterNote}・只含負責業務空白者(公司/盤商/已具名不列入)</p>
                {pool.sample.length > 0 && (
                  <p className="mt-2 text-xs text-stone-500 line-clamp-2">{pool.sample.map((c) => c.name).join('、')}{pool.poolSize > pool.sample.length ? ` …等 ${pool.poolSize} 家` : ''}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1.5">分派給</label>
                <select className="select-soft w-full text-sm" value={sp} onChange={(e) => setSp(e.target.value)}>
                  <option value="">— 選擇業務 —</option>
                  {salespersons.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-stone-400">注意:這會把上述 {pool.poolSize} 家的「負責業務」寫成所選業務。寫入前系統會逐筆重新確認仍為空白,只寫空白者,絕不覆蓋任何已有值。</p>
            </>
          )}
        </div>

        {!done && pool && (
          <div className="px-6 py-4 border-t border-stone-900/[0.06] flex justify-end gap-2">
            <button onClick={() => onClose(false)} className="px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">取消</button>
            <button onClick={execute} disabled={busy || !sp || pool.poolSize === 0}
              className="px-6 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-40">
              {busy ? '分派中…' : `確認分派 ${pool.poolSize} 家給 ${sp || '…'}`}
            </button>
          </div>
        )}
        {done && (
          <div className="px-6 py-4 border-t border-stone-900/[0.06] flex justify-end">
            <button onClick={() => onClose(true)} className="px-6 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all">完成</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 業務離職・轄區接手彈窗 ──────────────────────────────────────────────────
// 把離職業務的客戶按鄉鎮市區整包指定接手業務(或釋出為未分派)。只動「仍等於離職者」的客戶。
const RELEASE = '__release__'
function ReassignModal({ from, districts, successors, onClose }: {
  from: string
  districts: { city: string; district: string; count: number }[]
  successors: string[]
  onClose: (changed: boolean) => void
}) {
  const [target, setTarget] = useState<Record<string, string>>({}) // key city|district → 接手業務('' 保留)
  const [bulkTo, setBulkTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ totalReassigned: number; totalSkipped: number } | null>(null)
  const [error, setError] = useState('')

  const total = districts.reduce((s, d) => s + d.count, 0)
  const moves = districts.filter((d) => target[d.city + '|' + d.district]).map((d) => ({ city: d.city, district: d.district, to: target[d.city + '|' + d.district] }))
  const plannedCount = moves.reduce((s, m) => s + (districts.find((d) => d.city === m.city && d.district === m.district)?.count ?? 0), 0)

  function applyBulk(to: string) {
    setBulkTo(to)
    if (!to) return
    const next: Record<string, string> = {}
    for (const d of districts) next[d.city + '|' + d.district] = to
    setTarget(next)
  }

  async function execute() {
    if (moves.length === 0) { setError('請至少為一個行政區指定接手業務'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/customers/reassign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, moves, dryRun: false }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? '轉移失敗')
      setDone({ totalReassigned: j.totalReassigned, totalSkipped: j.totalSkipped })
    } catch (e: any) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-10 overflow-y-auto">
      <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => onClose(!!done)} />
      <div className="relative w-full max-w-2xl bg-[#fcfbf8] rounded-3xl shadow-2xl ring-1 ring-stone-900/[0.06] overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-900/[0.06] flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">業務離職・轄區接手</p>
            <h3 className="text-lg font-bold text-stone-800 mt-0.5">{from} 的客戶(共 {total.toLocaleString()} 家・{districts.length} 區)</h3>
          </div>
          <button onClick={() => onClose(!!done)} className="w-9 h-9 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 transition-all text-lg">✕</button>
        </div>

        {done ? (
          <div className="p-6">
            <div className="text-center py-6">
              <p className="text-4xl">✅</p>
              <p className="mt-3 text-lg font-bold text-stone-800">已轉出 {done.totalReassigned} 家</p>
              {done.totalSkipped > 0 && <p className="mt-1 text-sm text-stone-400">跳過 {done.totalSkipped} 家(期間已被改動,未覆蓋)</p>}
            </div>
            <div className="flex justify-end"><button onClick={() => onClose(true)} className="px-6 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all">完成</button></div>
          </div>
        ) : (
          <>
            <div className="px-6 py-3 border-b border-stone-900/[0.06] flex items-center gap-2 flex-wrap">
              <span className="text-xs text-stone-400">一鍵全部指定給:</span>
              <select className="select-soft text-xs !py-1.5" value={bulkTo} onChange={(e) => applyBulk(e.target.value)}>
                <option value="">— 逐區個別指定 —</option>
                {successors.map((s) => <option key={s} value={s}>{s}</option>)}
                <option value={RELEASE}>釋出為未分派</option>
              </select>
              <span className="ml-auto text-xs text-stone-400">安全:只改仍屬 {from} 的客戶,別人/公司/盤商不動</span>
            </div>
            <div className="max-h-[50vh] overflow-y-auto divide-y divide-stone-900/[0.04]">
              {districts.map((d) => {
                const key = d.city + '|' + d.district
                return (
                  <div key={key} className="px-6 py-2.5 flex items-center justify-between gap-3">
                    <div><span className="text-xs text-stone-400">{d.city}</span> <span className="font-medium text-stone-800">{d.district}</span> <span className="text-sm text-stone-400">{d.count} 家</span></div>
                    <select className="select-soft text-xs !py-1.5 w-40" value={target[key] ?? ''} onChange={(e) => setTarget((p) => ({ ...p, [key]: e.target.value }))}>
                      <option value="">保留不動</option>
                      {successors.map((s) => <option key={s} value={s}>→ {s}</option>)}
                      <option value={RELEASE}>釋出為未分派</option>
                    </select>
                  </div>
                )
              })}
            </div>
            <div className="px-6 py-4 border-t border-stone-900/[0.06] flex items-center justify-between gap-2">
              <p className="text-xs text-stone-400">{error ? <span className="text-rose-500">{error}</span> : `已規劃轉出 ${plannedCount} 家 / ${moves.length} 區`}</p>
              <div className="flex gap-2">
                <button onClick={() => onClose(false)} className="px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">取消</button>
                <button onClick={execute} disabled={busy || moves.length === 0}
                  className="px-6 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-40">
                  {busy ? '轉移中…' : `確認轉出 ${plannedCount} 家`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 客戶清單彈窗 ────────────────────────────────────────────────────────────
type AreaCustomer = {
  id: string; name: string; type: string; status: string
  address: string; phone: string; salesperson: string; devStage: string; institutionCode: string
}
const STATUS_BADGE: Record<string, string> = {
  開業: 'bg-emerald-50 text-emerald-600', 狀況不明: 'bg-amber-50 text-amber-600',
  停業: 'bg-rose-50 text-rose-500', 已歇業: 'bg-stone-100 text-stone-500', 撤銷: 'bg-stone-100 text-stone-500',
}
const STAGE_BADGE: Record<string, string> = {
  線索: 'bg-sky-50 text-sky-600', 已接觸: 'bg-brand-50 text-brand-600', 試用中: 'bg-violet-50 text-violet-600',
  報價中: 'bg-amber-50 text-amber-600', 已成交: 'bg-emerald-50 text-emerald-600', 流失: 'bg-stone-100 text-stone-500',
}

/** 純數字/+ 的可撥號字串;非法回 null(不顯示撥號連結) */
function telHref(phone: string): string | null {
  const cleaned = (phone || '').replace(/[^0-9+#*,;]/g, '')
  return cleaned.replace(/[^0-9]/g, '').length >= 6 ? cleaned : null
}

function exportCsv(rows: AreaCustomer[], filename: string) {
  const headers = ['客戶名稱', '類型', '機構狀態', '開發階段', '負責業務', '機構代碼', '地址', '電話']
  const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`
  const lines = rows.map((c) => [c.name, c.type, c.status, c.devStage, c.salesperson, c.institutionCode, c.address, c.phone].map(esc).join(','))
  // 加 BOM 讓 Excel 正確辨識 UTF-8 中文
  const blob = new Blob(['﻿' + headers.join(',') + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

function CustomerModal({ city, district, salesperson, onClose }: { city: string; district: string; salesperson: string; onClose: () => void }) {
  const [items, setItems] = useState<AreaCustomer[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const qs = new URLSearchParams({ city, district, salesperson }).toString()
    fetch('/api/customers/by-area?' + qs)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('讀取失敗')))
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError(e.message))
  }, [city, district, salesperson])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-10 overflow-y-auto">
      <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[#fcfbf8] rounded-3xl shadow-2xl ring-1 ring-stone-900/[0.06] overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between border-b border-stone-900/[0.06]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">{city}{district}</p>
            <h3 className="text-lg font-bold text-stone-800 mt-0.5">
              {salesperson} 的客戶
              {items && <span className="ml-2 text-sm font-medium text-stone-400">{items.length} 家</span>}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => items && items.length && exportCsv(items, `${city}${district}_${salesperson}_客戶.csv`)}
              disabled={!items || items.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-40 disabled:shadow-none">
              ⤓ 匯出 CSV
            </button>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-600 transition-all text-lg">✕</button>
          </div>
        </div>
        <div className="max-h-[65vh] overflow-y-auto divide-y divide-stone-900/[0.05]">
          {error && <p className="px-6 py-10 text-center text-sm text-rose-500">{error}</p>}
          {!items && !error && (
            <div className="px-6 py-14 text-center">
              <div className="inline-block w-5 h-5 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
              <p className="mt-2 text-sm text-stone-400">載入客戶中…</p>
            </div>
          )}
          {items && items.length === 0 && <p className="px-6 py-10 text-center text-sm text-stone-400">沒有符合的客戶</p>}
          {items?.map((c) => {
            const tel = telHref(c.phone)
            return (
              <div key={c.id} className="px-6 py-3.5 hover:bg-brand-50/50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <a href={`/customers/${c.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 group">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-stone-800 group-hover:text-brand-700">{c.name}</span>
                      {c.type && <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">{c.type}</span>}
                      {c.status && c.status !== '開業' && <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[c.status] ?? 'bg-stone-100 text-stone-500'}`}>{c.status}</span>}
                      {c.devStage && <span className={`text-xs px-2 py-0.5 rounded-full ${STAGE_BADGE[c.devStage] ?? 'bg-stone-100 text-stone-500'}`}>{c.devStage}</span>}
                    </div>
                    {c.address && <p className="mt-1 text-xs text-stone-400 truncate">{c.address}</p>}
                  </a>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {tel ? (
                      <a href={`tel:${tel}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 active:scale-95 transition-all whitespace-nowrap">
                        📞 {c.phone}
                      </a>
                    ) : c.phone ? (
                      <span className="text-xs text-stone-400">{c.phone}</span>
                    ) : (
                      <span className="text-xs text-stone-300">無電話</span>
                    )}
                    <a href={`/customers/${c.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-600 hover:text-brand-700">開啟詳情 →</a>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
