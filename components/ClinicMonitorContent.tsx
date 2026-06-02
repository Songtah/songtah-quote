'use client'

import { useState, useMemo } from 'react'
import type { MonitorResult, NewOpening, PossibleClosure, MonitorStats } from '@/app/api/admin/medical-monitor/route'

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent,
}: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-400 font-medium">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${accent ?? 'text-gray-900'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  )
}

function SectionHeader({ title, count, color }: { title: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>{count} 筆</span>
    </div>
  )
}

// ── Preview Modal ──────────────────────────────────────────────────────────────

function ImportPreviewModal({
  selected,
  onConfirm,
  onClose,
}: {
  selected: NewOpening[]
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">匯入預覽</h2>
            <p className="text-sm text-gray-400 mt-0.5">以下 {selected.length} 筆資料將新增至客戶資料庫</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-2">
          {selected.map((inst, i) => (
            <div key={inst.code} className="flex gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <span className="text-xs text-gray-400 shrink-0 w-5 text-right">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-gray-900">{inst.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-mono">{inst.code}</span>
                  <TypeChip kind={inst.kind} />
                </div>
                <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
                  {inst.city && <span>{inst.city}{inst.district}</span>}
                  {inst.address && <span className="truncate max-w-[300px]">{inst.address}</span>}
                </div>
              </div>
              <div className="shrink-0 text-xs text-right text-gray-400 space-y-0.5">
                <div className="text-green-600 font-medium">開業</div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50">取消</button>
          <button onClick={onConfirm} className="px-5 py-2 rounded-xl text-sm bg-gray-900 text-white font-medium hover:bg-gray-700">
            ✅ 確認新增 {selected.length} 筆
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Type Chip ─────────────────────────────────────────────────────────────────

function TypeChip({ kind }: { kind: string }) {
  const MAP: Record<string, string> = {
    '牙醫一般診所': 'bg-blue-50 text-blue-700',
    '牙醫診所':     'bg-blue-50 text-blue-700',
    '牙醫專科診所': 'bg-indigo-50 text-indigo-700',
    '牙體技術所':   'bg-violet-50 text-violet-700',
    '醫院':         'bg-orange-50 text-orange-700',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${MAP[kind] ?? 'bg-gray-100 text-gray-600'}`}>
      {kind}
    </span>
  )
}

// ── New Opening Row ────────────────────────────────────────────────────────────

function NewOpeningRow({
  inst,
  selected,
  onToggle,
}: {
  inst: NewOpening
  selected: boolean
  onToggle: () => void
}) {
  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-gray-50 last:border-0 ${
        selected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
        selected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
      }`}>
        {selected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round"/>
        </svg>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{inst.name}</span>
          <span className="text-[10px] font-mono text-gray-400">{inst.code}</span>
          <TypeChip kind={inst.kind} />
          {inst.isNewThisMonth && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">本月新增</span>
          )}
        </div>
        <div className="text-xs text-gray-400 flex flex-wrap gap-x-2 mt-0.5">
          {inst.city && <span>{inst.city}{inst.district}</span>}
          {inst.address && <span className="truncate max-w-[40vw]">{inst.address}</span>}
        </div>
      </div>
      <span className="shrink-0 text-xs font-medium text-emerald-600">開業</span>
    </div>
  )
}

// ── Closure Row ────────────────────────────────────────────────────────────────

function ClosureRow({ item }: { item: PossibleClosure }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/customers/${item.customerId}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-indigo-600 hover:underline"
            onClick={e => e.stopPropagation()}
          >
            {item.customerName}
          </a>
          <span className="text-[10px] font-mono text-gray-400">{item.institutionCode}</span>
          {item.customerType && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{item.customerType}</span>
          )}
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
        </div>
      </div>
      <span className="shrink-0 text-xs font-medium text-orange-500">代碼查無</span>
    </div>
  )
}

// ── Collapsible Section ────────────────────────────────────────────────────────

function CollapsibleSection({
  title, count, color, children, defaultOpen = true,
}: {
  title: string; count: number; color: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <span className="flex-1">
          <SectionHeader title={title} count={count} color={color} />
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="bg-white divide-y-0">{children}</div>}
    </div>
  )
}

// ── Tab for New Openings ───────────────────────────────────────────────────────

type NewOpeningFilter = 'all' | 'new' | 'existing'

function NewOpeningsTab({
  clinics, labs, hospitals, selectedIds, onToggle, onToggleAll, onImport, importing,
}: {
  clinics: NewOpening[]
  labs: NewOpening[]
  hospitals: NewOpening[]
  selectedIds: Set<string>
  onToggle: (code: string) => void
  onToggleAll: (items: NewOpening[]) => void
  onImport: () => void
  importing: boolean
}) {
  const [filter, setFilter] = useState<NewOpeningFilter>('all')

  const allItems = [...clinics, ...labs, ...hospitals]
  const totalNew = allItems.length
  const newThisMonthCount = allItems.filter(i => i.isNewThisMonth).length
  const existingCount     = totalNew - newThisMonthCount

  const filterFn = (items: NewOpening[]) => {
    if (filter === 'new')      return items.filter(i => i.isNewThisMonth)
    if (filter === 'existing') return items.filter(i => !i.isNewThisMonth)
    return items
  }

  const filteredClinics   = filterFn(clinics)
  const filteredLabs      = filterFn(labs)
  const filteredHospitals = filterFn(hospitals)
  const filteredAll       = [...filteredClinics, ...filteredLabs, ...filteredHospitals]
  const selectedCount     = selectedIds.size

  if (totalNew === 0) {
    return (
      <div className="py-16 text-center text-gray-400 text-sm">
        <div className="text-3xl mb-3">🎉</div>
        <p>沒有找到尚未加入客戶資料庫的牙科單位</p>
        <p className="text-xs mt-1">所有在醫事資料庫的牙科單位均已在客戶資料庫中</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 篩選 sub-tabs */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1 w-fit">
        {([
          { id: 'all',      label: '全部',     count: totalNew },
          { id: 'new',      label: '本月新增',  count: newThisMonthCount },
          { id: 'existing', label: '既有未開發', count: existingCount },
        ] as const).map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${
              filter === f.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {f.label}
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
              filter === f.id
                ? f.id === 'new' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'
                : 'bg-white text-gray-500'
            }`}>{f.count}</span>
          </button>
        ))}
      </div>

      {filter === 'new' && newThisMonthCount === 0 && (
        <div className="py-10 text-center text-gray-400 text-sm bg-gray-50 rounded-xl">
          <div className="text-2xl mb-2">📅</div>
          <p>本月快照中沒有新增的機構</p>
          <p className="text-xs mt-1">可能是本月為首次執行，或資料尚未更新</p>
        </div>
      )}

      {/* Batch actions */}
      {filteredAll.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-500">已選 <strong>{selectedCount}</strong> 筆</span>
          <button
            onClick={() => onToggleAll(filteredAll)}
            className="text-xs text-blue-600 hover:underline"
          >
            {filteredAll.every(i => selectedIds.has(i.code)) ? '取消全選' : '全選此頁'}
          </button>
          <div className="flex-1" />
          <button
            onClick={onImport}
            disabled={selectedCount === 0 || importing}
            className="px-4 py-2 rounded-xl text-sm bg-gray-900 text-white font-medium hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {importing ? '匯入中…' : `📥 預覽並匯入（${selectedCount}）`}
          </button>
        </div>
      )}

      {filteredClinics.length > 0 && (
        <CollapsibleSection title="牙醫診所" count={filteredClinics.length} color="bg-blue-50 text-blue-700">
          <div className="divide-y divide-gray-50">
            {filteredClinics.map(inst => (
              <NewOpeningRow key={inst.code} inst={inst} selected={selectedIds.has(inst.code)} onToggle={() => onToggle(inst.code)} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {filteredLabs.length > 0 && (
        <CollapsibleSection title="牙體技術所" count={filteredLabs.length} color="bg-violet-50 text-violet-700">
          <div className="divide-y divide-gray-50">
            {filteredLabs.map(inst => (
              <NewOpeningRow key={inst.code} inst={inst} selected={selectedIds.has(inst.code)} onToggle={() => onToggle(inst.code)} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {filteredHospitals.length > 0 && (
        <CollapsibleSection title="有牙科的醫院" count={filteredHospitals.length} color="bg-orange-50 text-orange-700" defaultOpen={false}>
          <div className="divide-y divide-gray-50">
            {filteredHospitals.map(inst => (
              <NewOpeningRow key={inst.code} inst={inst} selected={selectedIds.has(inst.code)} onToggle={() => onToggle(inst.code)} />
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ClinicMonitorContent({ isAdmin }: { isAdmin?: boolean }) {
  const [tab, setTab] = useState<'new' | 'closure'>('new')
  const [result, setResult]     = useState<MonitorResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState('')

  // Selection state for import
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showPreview, setShowPreview] = useState(false)
  const [importing, setImporting]     = useState(false)
  const [importResult, setImportResult] = useState('')

  // ── Load comparison ────────────────────────────────────────────────────────
  async function loadComparison() {
    setLoading(true); setError(''); setResult(null)
    setSelectedIds(new Set()); setImportResult('')
    try {
      const res = await fetch('/api/admin/medical-monitor')
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '比對失敗'); return }
      setResult(data)
    } catch (e: any) {
      setError(e.message ?? '比對失敗，請重試')
    } finally {
      setLoading(false)
    }
  }

  // ── Trigger GitHub Actions ────────────────────────────────────────────────
  async function triggerDataUpdate() {
    setTriggering(true); setTriggerMsg('')
    try {
      const res = await fetch('/api/clinic-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      })
      const data = await res.json()
      if (!res.ok) setTriggerMsg(`❌ ${data.error}`)
      else setTriggerMsg('✅ 醫事資料更新已觸發，約 25 分鐘後完成，完成後請再執行比對')
    } catch (e: any) {
      setTriggerMsg(`❌ ${e.message}`)
    } finally {
      setTriggering(false)
    }
  }

  // ── Selection ──────────────────────────────────────────────────────────────
  function toggleId(code: string) {
    setSelectedIds(prev => {
      const s = new Set(prev)
      s.has(code) ? s.delete(code) : s.add(code)
      return s
    })
  }

  function toggleAll(items: NewOpening[]) {
    const allSelected = items.every(i => selectedIds.has(i.code))
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map(i => i.code)))
    }
  }

  const selectedInstitutions = useMemo(() => {
    if (!result) return []
    return [
      ...result.newOpenings.clinics,
      ...result.newOpenings.labs,
      ...result.newOpenings.hospitals,
    ].filter(i => selectedIds.has(i.code))
  }, [result, selectedIds])

  // ── Import ─────────────────────────────────────────────────────────────────
  async function handleImport() {
    setImporting(true); setImportResult('')
    try {
      const res = await fetch('/api/admin/medical-monitor/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institutions: selectedInstitutions }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setImportResult(`❌ ${data.error ?? '匯入失敗'}`)
        return
      }
      const failDetails = (data.errors ?? []).map((e: any) => e.name).join('、')
      if (data.created === 0) {
        setImportResult(`❌ 全部建立失敗${failDetails ? `（${failDetails}）` : ''}`)
      } else {
        setImportResult(
          `✅ 已新增 ${data.created} 筆至客戶資料庫` +
          (data.errors?.length ? `，${data.errors.length} 筆失敗（${failDetails}）` : '')
        )
        setSelectedIds(new Set())
        setShowPreview(false)
      }
    } catch (e: any) {
      setImportResult(`❌ ${e.message}`)
    } finally {
      setImporting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const stats = result?.stats

  return (
    <div className="space-y-5">

      {/* ── Control bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={loadComparison}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          )}
          {loading ? '比對中…' : '🔍 執行比對'}
        </button>

        <button
          onClick={triggerDataUpdate}
          disabled={triggering}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {triggering ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          更新醫事資料
        </button>

        {result && (
          <span className="text-xs text-gray-400">
            資料時間：{result.snapshotMonth}（{new Date(result.snapshotFetched).toLocaleDateString('zh-TW')} 擷取）
          </span>
        )}
      </div>

      {/* Trigger message */}
      {triggerMsg && (
        <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap">
          <span>{triggerMsg}</span>
          <a href="https://github.com/Songtah/songtah-quote/actions/workflows/clinic-monitor.yml"
            target="_blank" rel="noreferrer"
            className="text-xs text-gray-400 underline hover:text-gray-600 ml-1">
            查看進度
          </a>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>
      )}

      {/* ── No snapshot state ────────────────────────────────────────────────── */}
      {result && !result.hasSnapshot && (
        <div className="panel px-6 py-16 text-center">
          <div className="text-3xl mb-3">📡</div>
          <p className="text-sm text-gray-600 font-medium">尚無醫事資料快照</p>
          <p className="text-sm text-gray-400 mt-1">請點擊「更新醫事資料」後等待約 25 分鐘，資料更新完成後再執行比對</p>
        </div>
      )}

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      {stats && (
        <>
          {/* 全台規模 */}
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">全台醫事單位規模</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="牙醫診所" value={stats.totalClinics} sub="NHI 特約" />
              <StatCard label="牙體技術所" value={stats.totalLabs} sub="MOHW BAS" />
              <StatCard label="有牙科的醫院" value="待納入" sub="資料來源建置中" />
              <StatCard label="崧達客戶" value={stats.customerClinics + stats.customerLabs + stats.customerHospitals} sub={`（有代碼）`} />
            </div>
          </div>

          {/* 客戶比對狀態 */}
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">客戶資料庫比對狀態</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="診所客戶（有代碼）" value={stats.customerClinics} />
              <StatCard label="牙技所客戶（有代碼）" value={stats.customerLabs} />
              <StatCard label="醫院客戶（有代碼）" value={stats.customerHospitals} />
              <StatCard label="無機構代碼" value={stats.customerNoCode} sub="不列入比對" accent="text-gray-400" />
            </div>
          </div>

          {/* 比對結果摘要 */}
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">比對結果摘要</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="本月新開業"
                value={stats.newThisMonthClinics + stats.newThisMonthLabs + stats.newThisMonthHospitals}
                sub={`診所 ${stats.newThisMonthClinics} ／牙技所 ${stats.newThisMonthLabs}`}
                accent="text-emerald-600"
              />
              <StatCard
                label="既有未開發"
                value={
                  (stats.newOpeningClinics + stats.newOpeningLabs + stats.newOpeningHospitals) -
                  (stats.newThisMonthClinics + stats.newThisMonthLabs + stats.newThisMonthHospitals)
                }
                sub="在醫事DB但從未成為客戶"
                accent="text-amber-600"
              />
              <StatCard
                label="代碼查無（可能歇業）"
                value={stats.closureClinics + stats.closureLabs + stats.closureHospitals}
                sub={`診所 ${stats.closureClinics} ／牙技所 ${stats.closureLabs}`}
                accent="text-orange-500"
              />
              <StatCard
                label="已對應客戶"
                value={stats.customerMatched}
                sub="代碼有對應到快照"
                accent="text-blue-600"
              />
            </div>
          </div>
        </>
      )}

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      {result?.hasSnapshot && (
        <>
          <div className="flex bg-gray-100 rounded-xl p-1 gap-1 w-fit">
            {([
              { id: 'new',     label: '🆕 新開業（業務機會）', count: (result.newOpenings.clinics.length + result.newOpenings.labs.length + result.newOpenings.hospitals.length) },
              { id: 'closure', label: '⚠️ 代碼查無（可能歇業）', count: (result.possibleClosures.clinics.length + result.possibleClosures.labs.length + result.possibleClosures.hospitals.length) },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                  tab === t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  tab === t.id ? 'bg-gray-100 text-gray-700' : 'bg-white text-gray-500'
                }`}>{t.count}</span>
              </button>
            ))}
          </div>

          {/* Import result message */}
          {importResult && (
            <div className={`text-sm px-4 py-3 rounded-xl border ${
              importResult.startsWith('❌') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
              {importResult}
            </div>
          )}

          {/* ── 新開業 Tab ── */}
          {tab === 'new' && (
            <NewOpeningsTab
              clinics={result.newOpenings.clinics}
              labs={result.newOpenings.labs}
              hospitals={result.newOpenings.hospitals}
              selectedIds={selectedIds}
              onToggle={toggleId}
              onToggleAll={toggleAll}
              onImport={() => selectedIds.size > 0 && setShowPreview(true)}
              importing={importing}
            />
          )}

          {/* ── 可能歇業 Tab ── */}
          {tab === 'closure' && (
            <div className="space-y-4">
              <div className="text-xs text-gray-400 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                ⚠️ 以下客戶的機構代碼在醫事快照中查無對應，可能已歇業、停業，或代碼有誤。請自行確認後在客戶頁面更新機構狀態。
              </div>

              {(result.possibleClosures.clinics.length + result.possibleClosures.labs.length + result.possibleClosures.hospitals.length) === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">
                  <div className="text-3xl mb-3">✅</div>
                  <p>所有有機構代碼的客戶均在醫事資料中找到</p>
                </div>
              ) : (
                <>
                  {result.possibleClosures.clinics.length > 0 && (
                    <CollapsibleSection title="牙醫診所" count={result.possibleClosures.clinics.length} color="bg-orange-50 text-orange-700">
                      {result.possibleClosures.clinics.map(item => <ClosureRow key={item.customerId} item={item} />)}
                    </CollapsibleSection>
                  )}
                  {result.possibleClosures.labs.length > 0 && (
                    <CollapsibleSection title="牙體技術所" count={result.possibleClosures.labs.length} color="bg-orange-50 text-orange-700">
                      {result.possibleClosures.labs.map(item => <ClosureRow key={item.customerId} item={item} />)}
                    </CollapsibleSection>
                  )}
                  {result.possibleClosures.hospitals.length > 0 && (
                    <CollapsibleSection title="醫院 / 其他" count={result.possibleClosures.hospitals.length} color="bg-orange-50 text-orange-700" defaultOpen={false}>
                      {result.possibleClosures.hospitals.map(item => <ClosureRow key={item.customerId} item={item} />)}
                    </CollapsibleSection>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Preview Modal ── */}
      {showPreview && selectedInstitutions.length > 0 && (
        <ImportPreviewModal
          selected={selectedInstitutions}
          onConfirm={handleImport}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
