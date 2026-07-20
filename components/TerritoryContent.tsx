'use client'

/**
 * 業務轄區管理(業務視角)——薄 UI,底層完全沿用已實測的安全分派/轉移 API:
 *   新增轄區 → POST /api/customers/assign(只認領該區「負責業務空白」的未分派池;公司/盤商/他人一律不動)
 *   移除轄區 → POST /api/customers/reassign(只改「負責業務仍等於該業務」者;釋出未分派或轉給別人)
 * 不新增資料表、不重寫任何寫入邏輯。轄區=從 region-stats 推導(客戶負責業務+行政區)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

type Row = {
  city: string; district: string; type: string; status: string
  salesperson: string; devStage: string; count: number
}
type Data = { rows: Row[]; updatedAt: string }

const EXCLUDE_OWNER = new Set(['公司', '盤商'])

// 地區排序(與區域儀表板一致的地理順序,讓新增轄區的縣市選單好找)
const CITY_ORDER = [
  '臺北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣',
  '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣',
  '嘉義市', '嘉義縣', '臺南市', '高雄市', '屏東縣',
  '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣',
]
const cityRank = (c: string) => { const i = CITY_ORDER.indexOf(c); return i < 0 ? 999 : i }

export default function TerritoryContent({ initialData, canAssign = false, canManageCompany = false }: { initialData: Data | null; canAssign?: boolean; canManageCompany?: boolean }) {
  const [rows, setRows] = useState<Row[]>(initialData?.rows ?? [])
  const [updatedAt, setUpdatedAt] = useState(initialData?.updatedAt ?? '')
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState('')
  const [sp, setSp] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [companyOpen, setCompanyOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<{ city: string; district: string; count: number } | null>(null)
  // 展開某區客戶清單(點客戶數):快取以 sp|city|district 為鍵(換業務不衝突)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [listCache, setListCache] = useState<Record<string, { loading: boolean; items: { id: string; name: string; type: string; status: string; phone: string }[]; err?: string }>>({})

  const toggleDistrict = useCallback(async (city: string, district: string) => {
    const key = `${sp}|${city}|${district}`
    if (openKey === key) { setOpenKey(null); return }
    setOpenKey(key)
    if (listCache[key]) return
    setListCache((c) => ({ ...c, [key]: { loading: true, items: [] } }))
    try {
      const q = new URLSearchParams({ city, district, salesperson: sp })
      const r = await fetch('/api/customers/by-area?' + q)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '讀取失敗')
      setListCache((c) => ({ ...c, [key]: { loading: false, items: d.items ?? [] } }))
    } catch (e: any) {
      setListCache((c) => ({ ...c, [key]: { loading: false, items: [], err: e.message } }))
    }
  }, [sp, openKey, listCache])

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/customers/region-stats')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '讀取失敗')
      setRows(d.rows ?? []); setUpdatedAt(d.updatedAt ?? '')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (!initialData) fetchData() }, [initialData, fetchData])

  const salespersons = useMemo(
    () => Array.from(new Set(rows.map((r) => r.salesperson).filter((s) => s && !EXCLUDE_OWNER.has(s)))).sort(),
    [rows])

  useEffect(() => {
    if (sp || !salespersons.length) return
    setSp(salespersons[0])
  }, [salespersons, sp])

  // 該業務涵蓋的每個區(客戶數),依客戶數多→少
  const myDistricts = useMemo(() => {
    const m = new Map<string, { city: string; district: string; count: number }>()
    for (const r of rows) {
      if (r.salesperson !== sp) continue
      const k = r.city + '|' + r.district
      const cur = m.get(k)
      if (cur) cur.count += r.count
      else m.set(k, { city: r.city, district: r.district, count: r.count })
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count || cityRank(a.city) - cityRank(b.city))
  }, [rows, sp])

  const totalCust = myDistricts.reduce((s, d) => s + d.count, 0)

  // 全部有效的 縣市→區(供公司調度挑區;去掉佔位值)
  const allAreas = useMemo(() => {
    const m = new Map<string, { city: string; district: string }>()
    for (const r of rows) {
      if (r.city.startsWith('(') || r.district.startsWith('(')) continue
      const k = r.city + '|' + r.district
      if (!m.has(k)) m.set(k, { city: r.city, district: r.district })
    }
    return Array.from(m.values()).sort((a, b) => cityRank(a.city) - cityRank(b.city) || a.district.localeCompare(b.district, 'zh-TW'))
  }, [rows])

  // 全區彙總(給新增轄區挑區用):每個 city|district 的 未分派/他人持有/該業務已有/公司盤商
  const districtSummary = useMemo(() => {
    const m = new Map<string, { city: string; district: string; total: number; unassigned: number; mine: number; others: number; corp: number }>()
    for (const r of rows) {
      if (r.city.startsWith('(') || r.district.startsWith('(')) continue
      const k = r.city + '|' + r.district
      let e = m.get(k)
      if (!e) { e = { city: r.city, district: r.district, total: 0, unassigned: 0, mine: 0, others: 0, corp: 0 }; m.set(k, e) }
      e.total += r.count
      if (!r.salesperson) e.unassigned += r.count
      else if (r.salesperson === sp) e.mine += r.count
      else if (EXCLUDE_OWNER.has(r.salesperson)) e.corp += r.count
      else e.others += r.count
    }
    return m
  }, [rows, sp])

  return (
    <div className="space-y-6">
      {/* 業務選擇 + 說明 */}
      <div className="card-soft p-4 sm:p-5 flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-4">
        <div className="w-full sm:w-auto">
          <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">業務</label>
          <select className="select-soft mt-1 block w-full sm:w-auto sm:min-w-[160px]" value={sp} onChange={(e) => setSp(e.target.value)}>
            {salespersons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <p className="text-sm text-stone-500 self-center">
          {sp ? <>{sp} 目前涵蓋 <b className="text-stone-700">{myDistricts.length}</b> 區、<b className="text-stone-700">{totalCust}</b> 家客戶</> : '—'}
        </p>
        <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center sm:gap-3">
          {updatedAt && <span className="text-xs text-stone-400">資料 {updatedAt.slice(0, 10)}</span>}
          {canManageCompany && (
            <button onClick={() => setCompanyOpen(true)}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all">
              🏢 公司客戶調度
            </button>
          )}
          {canAssign && (
            <button onClick={() => setAddOpen(true)}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all">
              ＋ 新增轄區
            </button>
          )}
        </div>
      </div>

      {!canAssign && (
        <div className="card-soft p-4 text-sm text-stone-500">
          你有檢視權限但無分派權限,新增/移除轄區僅限管理員、中央管理與總經理。
        </div>
      )}
      {error && <div className="card-soft p-4 text-sm text-red-600">{error}</div>}
      {loading && <div className="card-soft p-8 text-center text-sm text-stone-400">載入中…</div>}

      {!loading && sp && (
        <div className="card-soft overflow-hidden">
          <header className="px-5 py-3.5 flex items-baseline gap-3 border-b border-stone-900/[0.06] bg-brand-50/40">
            <h3 className="font-bold text-stone-800">🗺️ {sp} 的轄區</h3>
            <span className="ml-auto text-xs text-stone-400">{myDistricts.length} 區</span>
          </header>
          {myDistricts.length === 0 ? (
            <div className="p-8 text-center text-sm text-stone-400">{sp} 目前沒有持有任何客戶。用「＋ 新增轄區」認領某區的未分派客戶。</div>
          ) : (
            <ul className="divide-y divide-stone-900/[0.04]">
              {myDistricts.map((d) => {
                const key = `${sp}|${d.city}|${d.district}`
                const isOpen = openKey === key
                const cached = listCache[key]
                return (
                  <li key={d.city + '|' + d.district}>
                    <div className="px-5 py-3 flex items-center gap-3 hover:bg-brand-50/50 transition-colors">
                      <span className="font-medium text-stone-800">{d.city}{d.district}</span>
                      <button onClick={() => toggleDistrict(d.city, d.district)}
                              className={`chip text-[11px] active:scale-95 transition-all ${isOpen ? 'chip-active' : 'hover:outline-brand-400'}`}
                              title="點擊看客戶名單">
                        {d.count} 家 <span className="text-stone-400">{isOpen ? '▲' : '▾'}</span>
                      </button>
                      {canAssign && (
                        <button onClick={() => setRemoveTarget(d)}
                                className="ml-auto px-3.5 py-1.5 rounded-full text-xs font-medium border border-stone-200 bg-white text-stone-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600 active:scale-95 transition-all">
                          移除
                        </button>
                      )}
                    </div>
                    {isOpen && (
                      <div className="px-5 pb-3">
                        {cached?.loading && <p className="text-xs text-stone-400 py-2">載入客戶名單…</p>}
                        {cached?.err && <p className="text-xs text-red-600 py-2">{cached.err}</p>}
                        {cached && !cached.loading && !cached.err && (
                          cached.items.length === 0 ? (
                            <p className="text-xs text-stone-400 py-2">此區目前查無客戶(資料可能剛異動,稍後會同步)。</p>
                          ) : (
                            <ul className="grid gap-1.5 sm:grid-cols-2 rounded-2xl bg-stone-50/70 p-2.5 ring-1 ring-stone-900/[0.05]">
                              {cached.items.map((c) => (
                                <li key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white ring-1 ring-stone-900/[0.05]">
                                  <span className="text-sm text-stone-800 flex-1 min-w-0 truncate">{c.name}</span>
                                  {c.type && <span className="chip text-[10px] shrink-0">{c.type}</span>}
                                  {c.phone && (
                                    <a href={'tel:' + c.phone.replace(/[^\d+]/g, '')}
                                       className="text-[11px] text-brand-600 hover:text-brand-700 shrink-0 active:scale-95 transition-all">
                                      撥號
                                    </a>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {addOpen && (
        <AddModal
          sp={sp}
          summary={districtSummary}
          onClose={() => setAddOpen(false)}
          onDone={() => { setAddOpen(false); fetchData() }}
        />
      )}
      {companyOpen && (
        <CompanyModal
          sp={sp}
          allAreas={allAreas}
          onClose={() => setCompanyOpen(false)}
          onDone={() => { setCompanyOpen(false); fetchData() }}
        />
      )}
      {removeTarget && (
        <RemoveModal
          sp={sp}
          target={removeTarget}
          salespersons={salespersons.filter((s) => s !== sp)}
          onClose={() => setRemoveTarget(null)}
          onDone={() => { setRemoveTarget(null); fetchData() }}
        />
      )}
    </div>
  )
}

// ── 新增轄區:認領某區未分派池 ────────────────────────────────────────
function AddModal({ sp, summary, onClose, onDone }: {
  sp: string
  summary: Map<string, { city: string; district: string; total: number; unassigned: number; mine: number; others: number; corp: number }>
  onClose: () => void
  onDone: () => void
}) {
  const areas = useMemo(
    () => Array.from(summary.values()).sort((a, b) => cityRank(a.city) - cityRank(b.city) || a.district.localeCompare(b.district, 'zh-TW')),
    [summary])
  const cities = useMemo(() => Array.from(new Set(areas.map((a) => a.city))).sort((a, b) => cityRank(a) - cityRank(b)), [areas])

  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pool, setPool] = useState<{ poolSize: number; sample: any[] } | null>(null)
  const [ok, setOk] = useState('')

  const districtsOfCity = useMemo(() => areas.filter((a) => a.city === city), [areas, city])
  const picked = useMemo(() => summary.get(city + '|' + district) ?? null, [summary, city, district])

  const preview = useCallback(async (c: string, d: string) => {
    setPool(null); setErr(''); setOk('')
    if (!c || !d) return
    setBusy(true)
    try {
      const r = await fetch('/api/customers/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: c, district: d, salesperson: sp, dryRun: true }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '預覽失敗')
      setPool({ poolSize: j.poolSize, sample: j.sample ?? [] })
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }, [sp])

  const doAssign = async () => {
    if (!pool || pool.poolSize === 0) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/customers/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, district, salesperson: sp, dryRun: false }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '分派失敗')
      setOk(`已將 ${city}${district} 的 ${j.assigned} 家未分派客戶認領給 ${sp}${j.skipped ? `(跳過 ${j.skipped} 家已被指派)` : ''}`)
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title={`新增轄區 → ${sp}`}>
      {ok ? (
        <div className="space-y-4">
          <p className="text-sm text-emerald-700 bg-brand-50 rounded-2xl p-4">{ok}</p>
          <button onClick={onDone} className="w-full px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all">完成</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-stone-500 bg-stone-50 rounded-2xl p-3 leading-relaxed">
            新增轄區只會把該區<b>「負責業務空白」的未分派客戶</b>認領給 {sp}。
            公司、盤商、以及已由其他業務持有的客戶<b>一律不動</b>。
          </p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">縣市</label>
              <select className="select-soft mt-1 block w-full" value={city}
                      onChange={(e) => { setCity(e.target.value); setDistrict(''); setPool(null) }}>
                <option value="">選擇縣市</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">鄉鎮市區</label>
              <select className="select-soft mt-1 block w-full" value={district} disabled={!city}
                      onChange={(e) => { setDistrict(e.target.value); preview(city, e.target.value) }}>
                <option value="">選擇區</option>
                {districtsOfCity.map((a) => (
                  <option key={a.district} value={a.district}>
                    {a.district}(未分派 {a.unassigned})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {picked && (
            <div className="text-xs text-stone-600 bg-brand-50/50 rounded-2xl p-3 space-y-1">
              <div>{picked.city}{picked.district} 共 <b>{picked.total}</b> 家:</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-stone-500">
                <span>未分派可認領 <b className="text-brand-700">{picked.unassigned}</b></span>
                {picked.mine > 0 && <span>{sp} 已有 {picked.mine}</span>}
                {picked.others > 0 && <span>其他業務持有 {picked.others}(不動)</span>}
                {picked.corp > 0 && <span>公司/盤商 {picked.corp}(不動)</span>}
              </div>
            </div>
          )}

          {busy && <p className="text-sm text-stone-400">處理中…</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}
          {pool && (
            <p className="text-sm text-stone-600">
              確認後會把 <b className="text-brand-700">{pool.poolSize}</b> 家未分派客戶認領給 {sp}。
              {pool.poolSize === 0 && '(此區已無未分派客戶)'}
            </p>
          )}

          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">取消</button>
            <button onClick={doAssign} disabled={busy || !pool || pool.poolSize === 0}
                    className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              確認認領 {pool && pool.poolSize > 0 ? `(${pool.poolSize} 家)` : ''}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── 移除轄區:釋出未分派 或 轉給別人 ──────────────────────────────────
function RemoveModal({ sp, target, salespersons, onClose, onDone }: {
  sp: string
  target: { city: string; district: string; count: number }
  salespersons: string[]
  onClose: () => void
  onDone: () => void
}) {
  const RELEASE = '__release__'
  const [to, setTo] = useState(RELEASE)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState<number | null>(null)
  const [ok, setOk] = useState('')

  const runPreview = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/customers/reassign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: sp, moves: [{ city: target.city, district: target.district, to }], dryRun: true }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '預覽失敗')
      setPreview(j.total ?? 0)
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }, [sp, target, to])

  useEffect(() => { runPreview() }, [runPreview])

  const doRemove = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/customers/reassign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: sp, moves: [{ city: target.city, district: target.district, to }], dryRun: false }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '移除失敗')
      const dest = to === RELEASE ? '釋出為未分派' : `轉給 ${to}`
      setOk(`已把 ${sp} 在 ${target.city}${target.district} 的 ${j.totalReassigned} 家客戶${dest}${j.totalSkipped ? `(跳過 ${j.totalSkipped})` : ''}`)
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title={`移除轄區:${target.city}${target.district}`}>
      {ok ? (
        <div className="space-y-4">
          <p className="text-sm text-emerald-700 bg-brand-50 rounded-2xl p-4">{ok}</p>
          <button onClick={onDone} className="w-full px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all">完成</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-stone-500 bg-stone-50 rounded-2xl p-3 leading-relaxed">
            只會移動 <b>{sp}</b> 在此區持有的客戶(目前 {target.count} 家)。其他業務、公司、盤商的客戶不動。
          </p>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">移除後客戶去向</label>
            <select className="select-soft mt-1 block w-full" value={to}
                    onChange={(e) => { setTo(e.target.value); setPreview(null) }}>
              <option value={RELEASE}>釋出為未分派(放回公池)</option>
              {salespersons.map((s) => <option key={s} value={s}>轉給 {s}</option>)}
            </select>
          </div>
          {busy && <p className="text-sm text-stone-400">處理中…</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}
          {preview !== null && !busy && (
            <p className="text-sm text-stone-600">
              確認後會移動 <b className="text-brand-700">{preview}</b> 家客戶
              {to === RELEASE ? ' → 釋出未分派' : ` → 轉給 ${to}`}。
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">取消</button>
            <button onClick={doRemove} disabled={busy || preview === null || preview === 0}
                    className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              確認移除 {preview ? `(${preview} 家)` : ''}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── 公司客戶調度(逐筆):公司 → 業務(指派) / 業務 → 公司(收回)。限中央管理 ──
function CompanyModal({ sp, allAreas, onClose, onDone }: {
  sp: string
  allAreas: { city: string; district: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const COMPANY = '公司'
  const [dir, setDir] = useState<'assign' | 'collect'>('assign') // assign=公司→業務;collect=業務→公司
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [items, setItems] = useState<{ id: string; name: string; type: string; status: string; phone: string }[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const cities = useMemo(() => Array.from(new Set(allAreas.map((a) => a.city))), [allAreas])
  const districtsOfCity = useMemo(() => allAreas.filter((a) => a.city === city), [allAreas, city])
  // 來源 owner:指派時撈「公司」的客戶;收回時撈該業務的客戶
  const owner = dir === 'assign' ? COMPANY : sp
  const from = dir === 'assign' ? COMPANY : sp
  const to = dir === 'assign' ? sp : COMPANY

  const loadList = useCallback(async (c: string, d: string) => {
    setItems(null); setChecked(new Set()); setErr(''); setOk('')
    if (!c || !d) return
    setBusy(true)
    try {
      const q = new URLSearchParams({ city: c, district: d, owner })
      const r = await fetch('/api/customers/assign-company?' + q)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '讀取失敗')
      setItems(j.items ?? [])
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }, [owner])

  // 切換方向時,若已選區則重載清單
  const changeDir = (nd: 'assign' | 'collect') => {
    setDir(nd); setItems(null); setChecked(new Set()); setOk('')
    if (city && district) {
      // owner 會隨 dir 改;用新方向的 owner 立即重載
      const newOwner = nd === 'assign' ? COMPANY : sp
      const q = new URLSearchParams({ city, district, owner: newOwner })
      setBusy(true)
      fetch('/api/customers/assign-company?' + q).then((r) => r.json()).then((j) => {
        if (j.items) setItems(j.items); else setErr(j.error || '讀取失敗')
      }).catch((e) => setErr(e.message)).finally(() => setBusy(false))
    }
  }

  const toggle = (id: string) => setChecked((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const allChecked = items && items.length > 0 && checked.size === items.length
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set((items ?? []).map((x) => x.id)))

  const doMove = async () => {
    if (checked.size === 0) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/customers/assign-company', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerIds: Array.from(checked), from, to, dryRun: false }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '調度失敗')
      setOk(`已將 ${city}${district} 勾選的 ${j.reassigned} 家客戶:${from} → ${to}${j.skipped ? `(跳過 ${j.skipped} 家已非「${from}」持有)` : ''}`)
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title="公司客戶調度">
      {ok ? (
        <div className="space-y-4">
          <p className="text-sm text-emerald-700 bg-brand-50 rounded-2xl p-4">{ok}</p>
          <button onClick={onDone} className="w-full px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all">完成</button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 方向 */}
          <div className="flex gap-2">
            <button onClick={() => changeDir('assign')}
                    className={`flex-1 px-3 py-2 rounded-full text-xs font-semibold transition-all active:scale-95 ${dir === 'assign' ? 'bg-brand-500 text-white shadow-md shadow-brand-500/25' : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}>
              公司 → {sp}(指派)
            </button>
            <button onClick={() => changeDir('collect')}
                    className={`flex-1 px-3 py-2 rounded-full text-xs font-semibold transition-all active:scale-95 ${dir === 'collect' ? 'bg-brand-500 text-white shadow-md shadow-brand-500/25' : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'}`}>
              {sp} → 公司(收回)
            </button>
          </div>
          <p className="text-xs text-stone-500 bg-stone-50 rounded-2xl p-3 leading-relaxed">
            {dir === 'assign'
              ? <>把該區<b>「公司」持有的既有客戶</b>逐筆指派給 {sp}。盤商、其他業務、未分派一律不動。</>
              : <>把 {sp} 在該區的客戶逐筆<b>收回為「公司」持有</b>。其他業務、盤商不動。</>}
          </p>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">縣市</label>
              <select className="select-soft mt-1 block w-full" value={city}
                      onChange={(e) => { setCity(e.target.value); setDistrict(''); setItems(null) }}>
                <option value="">選擇縣市</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">鄉鎮市區</label>
              <select className="select-soft mt-1 block w-full" value={district} disabled={!city}
                      onChange={(e) => { setDistrict(e.target.value); loadList(city, e.target.value) }}>
                <option value="">選擇區</option>
                {districtsOfCity.map((a) => <option key={a.district} value={a.district}>{a.district}</option>)}
              </select>
            </div>
          </div>

          {busy && <p className="text-sm text-stone-400">處理中…</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}

          {items && !busy && (
            items.length === 0 ? (
              <p className="text-sm text-stone-400">此區沒有{dir === 'assign' ? '「公司」持有的' : `${sp} 的`}客戶。</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <button onClick={toggleAll} className="text-xs text-brand-600 hover:text-brand-700 active:scale-95 transition-all">
                    {allChecked ? '取消全選' : '全選'}({items.length})
                  </button>
                  <span className="text-xs text-stone-400">已勾 {checked.size}</span>
                </div>
                <ul className="max-h-56 overflow-y-auto divide-y divide-stone-900/[0.04] rounded-2xl ring-1 ring-stone-900/[0.06]">
                  {items.map((c) => (
                    <li key={c.id} className="px-3 py-2 flex items-center gap-2.5 hover:bg-brand-50/50 transition-colors">
                      <input type="checkbox" className="accent-[#b8956a] cursor-pointer" checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
                      <span className="text-sm text-stone-800 flex-1 min-w-0 truncate">{c.name}</span>
                      {c.type && <span className="chip text-[10px] shrink-0">{c.type}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}

          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">取消</button>
            <button onClick={doMove} disabled={busy || checked.size === 0}
                    className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              確認{dir === 'assign' ? '指派' : '收回'} {checked.size > 0 ? `(${checked.size} 家)` : ''}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#fdfdfb] rounded-3xl shadow-2xl ring-1 ring-stone-900/[0.06] w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-stone-900/[0.06] flex items-center justify-between">
          <h3 className="font-bold text-stone-800">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 active:scale-95 transition-all text-xl leading-none">×</button>
        </header>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}
