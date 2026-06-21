'use client'

import { useState, useMemo, useEffect } from 'react'
import type {
  MonitorResult, NewOpening,
  SuspectedClosure, CodeNotFound,
  SelfManagedCustomer, InconsistentData, CodeChanged, MonitorStats, HospitalUnverified,
} from '@/app/api/admin/medical-monitor/route'

// ── Shared UI ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent, delta, onClick }: {
  label: string; value: number | string; sub?: string; accent?: string; delta?: number | null; onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-1 ${onClick ? 'cursor-pointer hover:shadow-md hover:border-brand-300 active:scale-[0.98] transition-all' : ''}`}
    >
      <span className="text-xs text-gray-400 font-medium flex items-center gap-1">{label}{onClick && <span className="text-stone-300">›</span>}</span>
      <span className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums ${accent ?? 'text-gray-900'}`}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {typeof delta === 'number' && delta !== 0 && (
          <span className={`text-xs font-semibold tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
          </span>
        )}
        {delta === 0 && <span className="text-xs text-gray-300">持平</span>}
      </span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  )
}

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

function CollapsibleSection({ title, count, color, children, defaultOpen = true }: {
  title: string; count: number; color: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <span className="flex-1 flex items-center gap-3">
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>{count} 筆</span>
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="bg-white">{children}</div>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-gray-400 shrink-0 w-24">{label}</span>
      <span className="text-sm text-gray-700 flex-1">{value}</span>
    </div>
  )
}

function ChevronRight() {
  return (
    <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

// ── 逐筆即時查衛福部（開業狀態 / 機構代碼 + 建議）──────────────────────────────
// 變更形態徽章樣式
const FORM_BADGE: Record<string, { label: string; cls: string }> = {
  closure:         { label: '真歇業/停業', cls: 'bg-red-50 text-red-700 border border-red-200' },
  recode:          { label: '換照換碼',     cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  unknown:         { label: '查無',         cls: 'bg-gray-100 text-gray-600 border border-gray-200' },
  status_mismatch: { label: '狀態不符',     cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  ok:              { label: '一致',         cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
}

function MohwLookupButton({ name, code, kind, customerStatus }: { name: string; code?: string; kind?: string; customerStatus?: string }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<any>(null)
  const [err, setErr]         = useState('')

  async function run() {
    setLoading(true); setErr(''); setResult(null)
    try {
      const res = await fetch('/api/clinic-monitor/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code, kind, customerStatus }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? '查詢失敗'); return }
      setResult(data)
    } catch (e: any) {
      setErr(e?.message ?? '查詢失敗')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button onClick={run} disabled={loading}
        className="text-xs px-4 py-2 rounded-full bg-brand-500 text-white font-medium hover:bg-brand-600 shadow-sm shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-50">
        {loading ? '查詢衛福部中…' : '🔍 查衛福部機構代碼／開業狀態'}
      </button>
      {err && <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
      {result && (
        <div className="mt-2 rounded-xl bg-stone-50 border border-stone-200 p-3 text-xs space-y-2">
          {result.form && FORM_BADGE[result.form] && (
            <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${FORM_BADGE[result.form].cls}`}>
              {FORM_BADGE[result.form].label}
            </span>
          )}
          {result.found ? (
            <>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span>衛福部代碼：<code className="font-mono bg-white border border-stone-200 px-1.5 py-0.5 rounded">{result.mohwCode ?? '—'}</code></span>
                <span>開業狀態：<span className={result.closed ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>{result.status || '—'}</span></span>
              </div>
              {result.mohwName && <div className="text-stone-500">{result.mohwName}　{result.address}</div>}
            </>
          ) : (
            <div className="text-stone-500">衛福部查無此名稱</div>
          )}
          <div className="text-brand-700 bg-brand-50 rounded-lg px-2.5 py-2 leading-relaxed">💡 {result.suggestion}</div>
          {result.candidates?.length > 1 && (
            <div className="text-stone-400">其他候選：{result.candidates.slice(1, 5).map((c: any) => c.name).join('、')}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 開業狀態編輯（連動 Notion「機構狀態」）────────────────────────────────────────
const STATUS_OPTIONS = ['開業', '停業', '已歇業', '撤銷', '狀況不明']

function StatusEditor({ customerId, current, onResolved }: {
  customerId: string; current?: string; onResolved?: (id: string, status: string) => void
}) {
  const [val, setVal]       = useState(current || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState('')

  async function save(next: string) {
    setVal(next); setSaving(true); setMsg('')
    try {
      const res = await fetch('/api/admin/medical-monitor/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, status: next }),
      })
      const data = await res.json()
      if (!res.ok) { setMsg(data.error ?? '更新失敗'); return }
      setMsg('✓ 已更新')
      onResolved?.(customerId, next)
    } catch (e: any) { setMsg(e?.message ?? '更新失敗') }
    finally { setSaving(false) }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-stone-400">開業狀態</span>
      <select value={val} onChange={e => save(e.target.value)} disabled={saving}
        className="select-soft text-xs py-1.5 px-3 rounded-full disabled:opacity-50">
        <option value="" disabled>選擇…</option>
        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      {saving && <span className="text-[11px] text-stone-400">儲存中…</span>}
      {msg && <span className={`text-[11px] ${msg.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>{msg}</span>}
    </div>
  )
}

// ── 類別彈窗（摘要卡點擊 → 卡片視窗顯示該類清單）──────────────────────────────────
type CategoryKey = 'closure' | 'codechange' | 'hospital' | 'inconsistent' | 'selfmanaged'
const CATEGORY_TITLE: Record<CategoryKey, string> = {
  closure: '⛔ 疑似歇業', codechange: '🔁 更換代碼', hospital: '🏥 醫院待確認',
  inconsistent: '🔄 資料不一致', selfmanaged: '👤 公司自建',
}

function CategoryModal({ category, closureItems, hospitalItems, result, onClose, onResolved }: {
  category: CategoryKey
  closureItems: SuspectedClosure[]
  hospitalItems: HospitalUnverified[]
  result: MonitorResultPayload
  onClose: () => void
  onResolved: (id: string, status: string) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-[#fcfbf8] rounded-3xl shadow-2xl ring-1 ring-stone-900/[0.06] w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-900/[0.06] flex items-center justify-between shrink-0">
          <h2 className="font-bold text-stone-800 text-lg">{CATEGORY_TITLE[category]}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-stone-100 flex items-center justify-center text-stone-400">✕</button>
        </div>
        <div className="p-5 overflow-y-auto">
          {category === 'closure'      && <SuspectedClosuresTab items={closureItems} onResolved={onResolved} />}
          {category === 'hospital'     && <HospitalUnverifiedTab items={hospitalItems} onResolved={onResolved} />}
          {category === 'codechange'   && <CodeChangedTab items={result.codeChanged ?? []} />}
          {category === 'inconsistent' && <InconsistentDataTab items={result.inconsistentData} />}
          {category === 'selfmanaged'  && <SelfManagedTab items={result.selfManagedCustomers} />}
        </div>
      </div>
    </div>
  )
}

// ── Import Preview Modal ────────────────────────────────────────────────────────

function ImportPreviewModal({ selected, onConfirm, onClose }: {
  selected: NewOpening[]; onConfirm: () => void; onClose: () => void
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
              <div className="shrink-0 text-xs text-emerald-600 font-medium">開業</div>
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

// ── 狀態 2：新開業候選 Tab ─────────────────────────────────────────────────────

type NewOpeningFilter = 'all' | 'new' | 'existing'

function NewOpeningsTab({ clinics, labs, hospitals, selectedIds, onToggle, onToggleAll, onImport, importing }: {
  clinics: NewOpening[]; labs: NewOpening[]; hospitals: NewOpening[]
  selectedIds: Set<string>; onToggle: (code: string) => void
  onToggleAll: (items: NewOpening[]) => void; onImport: () => void; importing: boolean
}) {
  const [filter, setFilter] = useState<NewOpeningFilter>('all')

  const allItems          = [...clinics, ...labs, ...hospitals]
  const newThisMonthCount = allItems.filter(i => i.isNewThisMonth).length
  const existingCount     = allItems.length - newThisMonthCount

  const filterFn = (items: NewOpening[]) => {
    if (filter === 'new')      return items.filter(i => i.isNewThisMonth)
    if (filter === 'existing') return items.filter(i => !i.isNewThisMonth)
    return items
  }

  const fClinics   = filterFn(clinics)
  const fLabs      = filterFn(labs)
  const fHospitals = filterFn(hospitals)
  const fAll       = [...fClinics, ...fLabs, ...fHospitals]

  if (allItems.length === 0) return (
    <div className="py-16 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">🎉</div>
      <p>沒有找到尚未加入客戶資料庫的牙科單位</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1 w-fit">
        {([
          { id: 'all',      label: '全部',      count: allItems.length },
          { id: 'new',      label: '本月新增',   count: newThisMonthCount },
          { id: 'existing', label: '既有未開發', count: existingCount },
        ] as const).map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${filter === f.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {f.label}
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
              filter === f.id
                ? f.id === 'new' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'
                : 'bg-white text-gray-500'
            }`}>{f.count}</span>
          </button>
        ))}
      </div>

      {fAll.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-500">已選 <strong>{selectedIds.size}</strong> 筆</span>
          <button onClick={() => onToggleAll(fAll)} className="text-xs text-blue-600 hover:underline">
            {fAll.every(i => selectedIds.has(i.code)) ? '取消全選' : '全選此頁'}
          </button>
          <div className="flex-1" />
          <button onClick={onImport} disabled={selectedIds.size === 0 || importing}
            className="px-4 py-2 rounded-xl text-sm bg-gray-900 text-white font-medium hover:bg-gray-700 disabled:opacity-40">
            {importing ? '匯入中…' : `📥 預覽並匯入（${selectedIds.size}）`}
          </button>
        </div>
      )}

      {fClinics.length > 0 && (
        <CollapsibleSection title="牙醫診所" count={fClinics.length} color="bg-blue-50 text-blue-700">
          <div className="divide-y divide-gray-50">
            {fClinics.map(inst => (
              <NewOpeningRow key={inst.code} inst={inst} selected={selectedIds.has(inst.code)} onToggle={() => onToggle(inst.code)} />
            ))}
          </div>
        </CollapsibleSection>
      )}
      {fLabs.length > 0 && (
        <CollapsibleSection title="牙體技術所" count={fLabs.length} color="bg-violet-50 text-violet-700">
          <div className="divide-y divide-gray-50">
            {fLabs.map(inst => (
              <NewOpeningRow key={inst.code} inst={inst} selected={selectedIds.has(inst.code)} onToggle={() => onToggle(inst.code)} />
            ))}
          </div>
        </CollapsibleSection>
      )}
      {fHospitals.length > 0 && (
        <CollapsibleSection title="有牙科的醫院" count={fHospitals.length} color="bg-orange-50 text-orange-700" defaultOpen={false}>
          <div className="divide-y divide-gray-50">
            {fHospitals.map(inst => (
              <NewOpeningRow key={inst.code} inst={inst} selected={selectedIds.has(inst.code)} onToggle={() => onToggle(inst.code)} />
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}

function NewOpeningRow({ inst, selected, onToggle }: {
  inst: NewOpening; selected: boolean; onToggle: () => void
}) {
  return (
    <div onClick={onToggle}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-gray-50 last:border-0 ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
      <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${selected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>
        {selected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round"/></svg>}
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

// ── 狀態 3：已歇業 Tab ─────────────────────────────────────────────────────────

function SuspectedClosuresTab({ items, onResolved }: {
  items: SuspectedClosure[]
  onResolved?: (id: string, status: string) => void
}) {
  if (items.length === 0) return (
    <div className="py-12 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">✅</div>
      <p>目前沒有歇業候選的客戶機構</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
        ⛔ 以下客戶有機構代碼，但不在衛福部開業清單中。可「查衛福部」確認，並直接編輯開業狀態（會寫回 Notion 機構狀態；標停業／已歇業／撤銷後此筆即結案移除）。
      </div>
      <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {items.map(item => (
          <div key={item.customerId} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
                  <span className="text-[10px] font-mono text-gray-400">{item.institutionCode}</span>
                  {item.customerType && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{item.customerType}</span>}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
                  {item.customerStatus && ` · 目前：${item.customerStatus}`}
                </div>
              </div>
              <a href={`/customers/${item.customerId}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-gray-400 hover:text-gray-600 underline">客戶頁</a>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <StatusEditor customerId={item.customerId} current={item.customerStatus} onResolved={onResolved} />
              <MohwLookupButton name={item.customerName} code={item.institutionCode} customerStatus={item.customerStatus} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 狀態 5：公司自建客戶 Tab ───────────────────────────────────────────────────

function SelfManagedTab({ items }: { items: SelfManagedCustomer[] }) {
  const [search, setSearch] = useState('')
  const filtered = search.trim()
    ? items.filter(i => i.customerName.includes(search) || i.customerCity.includes(search) || i.customerType.includes(search))
    : items

  if (items.length === 0) return (
    <div className="py-12 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">✅</div>
      <p>所有客戶都已填入機構代碼</p>
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
        👤 公司自建：無機構代碼、人名／機構名稱混雜的客戶。<span className="text-gray-400">非每月更新重點，由業務手動回報現況；如需納入自動監控，請至客戶頁面填入正確機構代碼。</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜尋客戶名稱 / 縣市 / 類型…"
          className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <span className="text-xs text-gray-400 shrink-0">{filtered.length} / {items.length} 筆</span>
      </div>
      <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {filtered.slice(0, 300).map(item => (
          <a key={item.customerId} href={`/customers/${item.customerId}`} target="_blank" rel="noreferrer"
            className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
                {item.customerType && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{item.customerType}</span>}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
                {item.customerStatus && ` · ${item.customerStatus}`}
              </div>
            </div>
            <ChevronRight />
          </a>
        ))}
        {filtered.length > 300 && (
          <div className="px-4 py-3 text-xs text-gray-400 text-center">顯示前 300 筆，請搜尋縮小範圍</div>
        )}
      </div>
    </div>
  )
}

// ── 狀態 6：資料不一致 Tab ─────────────────────────────────────────────────────

function InconsistentDataTab({ items }: { items: InconsistentData[] }) {
  if (items.length === 0) return (
    <div className="py-12 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">✅</div>
      <p>所有代碼對應的客戶資料與醫事快照一致</p>
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
        🔄 以下客戶的機構代碼在快照中找到，但名稱或縣市與快照資料有落差，請確認是否需要更新。
      </div>
      <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {items.map(item => (
          <div key={item.customerId} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
                  <span className="text-[10px] font-mono text-gray-400">{item.institutionCode}</span>
                  <TypeChip kind={item.snapshotKind} />
                  {item.diffs.map(d => (
                    <span key={d.field} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">{d.field}不符</span>
                  ))}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
                  {' · 快照：'}<span className="text-gray-600">{item.snapshotName}</span>
                </div>
                <div className="mt-1.5 space-y-1">
                  {item.diffs.map(d => (
                    <div key={d.field} className="text-[11px] text-gray-500">
                      <span className="text-gray-400">{d.field}：</span>
                      公司「<span className="text-gray-800">{d.customerValue}</span>」／快照「<span className="text-gray-600">{d.snapshotValue}</span>」
                    </div>
                  ))}
                </div>
              </div>
              <a href={`/customers/${item.customerId}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-gray-400 hover:text-gray-600 underline">客戶頁</a>
            </div>
            <div className="mt-2"><MohwLookupButton name={item.customerName} code={item.institutionCode} kind={item.snapshotKind === '牙體技術所' ? '2' : 'A'} customerStatus={item.customerStatus} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 更換代碼 Tab ────────────────────────────────────────────────────────────────
function CodeChangedTab({ items }: { items: CodeChanged[] }) {
  if (items.length === 0) return (
    <div className="py-12 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">✅</div>
      <p>沒有偵測到更換代碼的客戶</p>
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
        🔁 以下客戶的舊機構代碼已停用，同地址（縣市＋行政區＋名稱）查到新代碼 → 應為換照。建議至客戶頁將機構代碼更新為新碼。
      </div>
      <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {items.map((item) => (
          <a key={item.customerId} href={`/customers/${item.customerId}`} target="_blank" rel="noreferrer"
            className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
                {item.customerType && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{item.customerType}</span>}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
                <span className="mx-2">·</span>
                <span className="font-mono text-gray-400 line-through">{item.oldCode}</span>
                <span className="mx-1 text-amber-500">→</span>
                <span className="font-mono text-amber-700 font-semibold">{item.newCode}</span>
              </div>
            </div>
            <ChevronRight />
          </a>
        ))}
      </div>
    </div>
  )
}

// ── 醫院待確認 Tab ──────────────────────────────────────────────────────────────
function HospitalUnverifiedTab({ items, onResolved }: { items: HospitalUnverified[]; onResolved?: (id: string, status: string) => void }) {
  if (items.length === 0) return (
    <div className="py-12 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">✅</div>
      <p>沒有待確認的醫院</p>
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5">
        🏥 以下醫院客戶的機構代碼不在衛福部「牙醫一般科」開業清單中。醫院多半仍在營業，只是牙科未登記為牙醫一般科，故不列入歇業候選。請逐筆「查衛福部」確認牙科現況。
      </div>
      <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {items.map(item => (
          <div key={item.customerId} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
                  <span className="text-[10px] font-mono text-gray-400">{item.institutionCode}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 font-medium">醫院</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
                  {item.customerStatus && ` · ${item.customerStatus}`}
                </div>
              </div>
              <a href={`/customers/${item.customerId}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-gray-400 hover:text-gray-600 underline">客戶頁</a>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <StatusEditor customerId={item.customerId} current={item.customerStatus} onResolved={onResolved} />
              <MohwLookupButton name={item.customerName} code={item.institutionCode} customerStatus={item.customerStatus} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

const CACHE_KEY     = 'clinic-monitor-result-v13'

type MonitorResultPayload = Omit<MonitorResult, 'stats'> & { stats: MonitorStats | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseMonitorStats(value: unknown): MonitorStats | null {
  if (!isRecord(value)) return null
  return {
    totalClinics: readNumber(value.totalClinics),
    totalLabs: readNumber(value.totalLabs),
    totalHospitals: readNumber(value.totalHospitals),
    clinicDelta: readNullableNumber(value.clinicDelta),
    labDelta: readNullableNumber(value.labDelta),
    labsStale: readBoolean(value.labsStale),
    customerWithCode: readNumber(value.customerWithCode),
    customerNoCode: readNumber(value.customerNoCode),
    normalOperating: readNumber(value.normalOperating),
    newOpeningClinics: readNumber(value.newOpeningClinics),
    newOpeningLabs: readNumber(value.newOpeningLabs),
    newOpeningHospitals: readNumber(value.newOpeningHospitals),
    newThisMonthClinics: readNumber(value.newThisMonthClinics),
    newThisMonthLabs: readNumber(value.newThisMonthLabs),
    newThisMonthHospitals: readNumber(value.newThisMonthHospitals),
    newOpeningExcludedExisting: readNumber(value.newOpeningExcludedExisting),
    suspectedClosures: readNumber(value.suspectedClosures),
    codeNotFound: readNumber(value.codeNotFound),
    inconsistentData: readNumber(value.inconsistentData),
    codeChanged: readNumber(value.codeChanged),
    hospitalUnverified: readNumber(value.hospitalUnverified),
  }
}

function parseMonitorResult(value: unknown): MonitorResultPayload | null {
  if (!isRecord(value)) return null
  if (!isRecord(value.newOpenings)) return null
  if (!isArray(value.newOpenings.clinics) || !isArray(value.newOpenings.labs) || !isArray(value.newOpenings.hospitals)) {
    return null
  }
  if (
    !isArray(value.suspectedClosures) ||
    !isArray(value.codeNotFound) ||
    !isArray(value.selfManagedCustomers) ||
    !isArray(value.inconsistentData) ||
    !isArray(value.codeChanged)
  ) {
    return null
  }
  const hospitalUnverified = isArray(value.hospitalUnverified) ? (value.hospitalUnverified as HospitalUnverified[]) : []

  const stats = value.stats == null ? null : parseMonitorStats(value.stats)
  if (readBoolean(value.hasSnapshot) && !stats) return null

  return {
    hasSnapshot: readBoolean(value.hasSnapshot),
    stats,
    newOpenings: {
      clinics: value.newOpenings.clinics as NewOpening[],
      labs: value.newOpenings.labs as NewOpening[],
      hospitals: value.newOpenings.hospitals as NewOpening[],
    },
    suspectedClosures: value.suspectedClosures as SuspectedClosure[],
    codeNotFound: value.codeNotFound as CodeNotFound[],
    selfManagedCustomers: value.selfManagedCustomers as SelfManagedCustomer[],
    inconsistentData: value.inconsistentData as InconsistentData[],
    codeChanged: value.codeChanged as CodeChanged[],
    hospitalUnverified,
    snapshotMonth: readString(value.snapshotMonth),
    snapshotFetched: readString(value.snapshotFetched),
    computedAt: readString(value.computedAt),
  }
}

export function ClinicMonitorContent({ isAdmin }: { isAdmin?: boolean }) {
  const [result, setResult]         = useState<MonitorResultPayload | null>(null)
  const [cachedAt, setCachedAt]     = useState<string | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState('')

  // 點擊摘要卡開啟的類別彈窗
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(null)
  // 已在彈窗內編輯開業狀態而結案的客戶（樂觀移除）
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())

  // 新開業 匯入
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [showPreview, setShowPreview]   = useState(false)
  const [importing, setImporting]       = useState(false)
  const [importResult, setImportResult] = useState('')

  function applyResult(data: MonitorResultPayload, when: string) {
    setResult(data); setCachedAt(when); setResolvedIds(new Set())
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: when })) } catch {}
  }

  // ── 開頁：先取伺服器端「最近一次比對結果」（共用、不受清快取影響）；無則 localStorage 備援 ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/admin/medical-monitor')   // 不帶 refresh → 回上次結果
        if (res.ok) {
          const payload = await res.json()
          const data = parseMonitorResult(payload)
          if (data && !cancelled) { applyResult(data, readString(payload.computedAt) || new Date().toISOString()); return }
        }
      } catch {}
      // 備援：localStorage
      try {
        const raw = localStorage.getItem(CACHE_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw) as { data?: unknown; timestamp?: unknown }
        const restored = parseMonitorResult(parsed.data)
        if (restored && !cancelled) { setResult(restored); setCachedAt(readString(parsed.timestamp) || new Date().toISOString()) }
        else localStorage.removeItem(CACHE_KEY)
      } catch { try { localStorage.removeItem(CACHE_KEY) } catch {} }
    })()
    return () => { cancelled = true }
  }, [])

  // ── 執行比對：強制重算（伺服器會同時存起來供下次開頁）──────────────────────────
  async function loadComparison() {
    setLoading(true); setError('')
    setSelectedIds(new Set()); setImportResult('')
    try {
      const res  = await fetch('/api/admin/medical-monitor?refresh=1')
      const payload = await res.json()
      if (!res.ok) { setError(payload.error ?? '比對失敗'); return }
      const data = parseMonitorResult(payload)
      if (!data) { setError('比對資料格式錯誤，請重新執行'); return }
      applyResult(data, readString(payload.computedAt) || new Date().toISOString())
    } catch (e: any) {
      setError(e.message ?? '比對失敗，請重試')
    } finally {
      setLoading(false)
    }
  }

  function onStatusResolved(id: string) {
    setResolvedIds(prev => new Set(prev).add(id))
  }

  async function triggerDataUpdate() {
    setTriggering(true); setTriggerMsg('')
    try {
      const res  = await fetch('/api/clinic-monitor', {
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

  // ── 新開業 選取/匯入 ──────────────────────────────────────────────────────────
  function toggleId(code: string) {
    setSelectedIds(prev => { const s = new Set(prev); s.has(code) ? s.delete(code) : s.add(code); return s })
  }
  function toggleAll(items: NewOpening[]) {
    const allSelected = items.every(i => selectedIds.has(i.code))
    setSelectedIds(allSelected ? new Set() : new Set(items.map(i => i.code)))
  }
  const selectedInstitutions = useMemo(() => {
    if (!result) return []
    return [...result.newOpenings.clinics, ...result.newOpenings.labs, ...result.newOpenings.hospitals]
      .filter(i => selectedIds.has(i.code))
  }, [result, selectedIds])

  async function handleImport() {
    setImporting(true); setImportResult('')
    try {
      const res  = await fetch('/api/admin/medical-monitor/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institutions: selectedInstitutions }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setImportResult(`❌ ${data.error ?? '匯入失敗'}`); return }
      const failDetails = (data.errors ?? []).map((e: any) => e.name).join('、')
      if (data.created === 0) {
        setImportResult(`❌ 全部建立失敗${failDetails ? `（${failDetails}）` : ''}`)
      } else {
        setImportResult(`✅ 已新增 ${data.created} 筆至客戶資料庫` + (data.errors?.length ? `，${data.errors.length} 筆失敗（${failDetails}）` : ''))
        setSelectedIds(new Set()); setShowPreview(false)
      }
    } catch (e: any) {
      setImportResult(`❌ ${e.message}`)
    } finally {
      setImporting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const stats = result?.stats

  // 樂觀移除已在彈窗編輯結案者
  const closureItems  = (result?.suspectedClosures ?? []).filter(i => !resolvedIds.has(i.customerId))
  const hospitalItems = (result?.hospitalUnverified ?? []).filter(i => !resolvedIds.has(i.customerId))

  return (
    <div className="space-y-5">

      {/* Control bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={loadComparison} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors">
          {loading
            ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          }
          {loading ? '比對中…' : '🔍 執行比對'}
        </button>
        <button onClick={triggerDataUpdate} disabled={triggering}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {triggering
            ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          }
          更新醫事資料
        </button>
        {cachedAt && (
          <span className="text-xs text-gray-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shrink-0" />
            上次比對：{new Date(cachedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            <button
              onClick={() => {
                try { localStorage.removeItem(CACHE_KEY) } catch {}
                setResult(null); setCachedAt(null)
              }}
              className="ml-1 text-gray-300 hover:text-gray-500"
            >✕</button>
          </span>
        )}
        {result && (
          <span className="text-xs text-gray-300">
            快照：{result.snapshotMonth}（{new Date(result.snapshotFetched).toLocaleDateString('zh-TW')} 擷取）
          </span>
        )}
      </div>

      {triggerMsg && (
        <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap">
          {triggerMsg}
          <a href="https://github.com/Songtah/songtah-quote/actions/workflows/clinic-monitor.yml"
            target="_blank" rel="noreferrer"
            className="text-xs text-gray-400 underline hover:text-gray-600 ml-1">查看進度</a>
        </div>
      )}
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

      {result && !result.hasSnapshot && (
        <div className="panel px-6 py-16 text-center">
          <div className="text-3xl mb-3">📡</div>
          <p className="text-sm text-gray-600 font-medium">尚無醫事資料快照</p>
          <p className="text-sm text-gray-400 mt-1">請點擊「更新醫事資料」後等待約 25 分鐘，完成後再執行比對</p>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <>
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">全台牙科單位數量（較上月淨增減）</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="牙醫診所"   value={stats.totalClinics} delta={stats.clinicDelta} sub="全台" />
              {stats.totalLabs > 0
                ? <StatCard label="牙體技術所" value={stats.totalLabs} delta={stats.labsStale ? null : stats.labDelta} sub={stats.labsStale ? '⚠ 上月資料（本次未完整抓取）' : (stats.labDelta === null ? '全台 · 首次建立基準' : '全台')} />
                : (
                  <div className="bg-white rounded-2xl border border-amber-200 p-4 flex flex-col gap-1">
                    <span className="text-xs text-gray-400 font-medium">牙體技術所</span>
                    <span className="text-lg font-bold text-amber-500">資料未取得</span>
                    <span className="text-xs text-amber-500">BAS 上次抓取失敗，請點「更新醫事資料」重新執行</span>
                  </div>
                )
              }
              <StatCard label="客戶（有代碼）" value={stats.customerWithCode} />
              <StatCard label="客戶（無代碼）" value={stats.customerNoCode} sub="未納入監控" />
            </div>
            <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
              ℹ️ 此處「淨增減」是全台院所總數較上月的變化（新增−歇業），與下方「新開業候選」不同——後者只列尚未成為崧達客戶的新機構，已是客戶者會被排除，故數字通常較小。
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">客戶機構代碼 vs 衛福部(BAS) <span className="normal-case font-normal text-stone-300">— 點卡片看清單</span></p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="✅ 在 BAS 開業" value={stats.normalOperating} sub="代碼比中現行開業機構" accent="text-emerald-600" />
              <StatCard label="⛔ 疑似歇業"    value={closureItems.length} sub="點擊編輯開業狀態" accent="text-red-600" onClick={() => setActiveCategory('closure')} />
              <StatCard label="🔁 更換代碼"    value={stats.codeChanged} sub="同地區查到新代碼（換照）" accent="text-amber-600" onClick={() => setActiveCategory('codechange')} />
              <StatCard label="🏥 醫院待確認"  value={hospitalItems.length} sub="醫院在營業、牙科未登記" accent="text-orange-600" onClick={() => setActiveCategory('hospital')} />
              <StatCard label="🔄 資料不一致"  value={stats.inconsistentData} sub="代碼符但名稱/地址有落差" accent="text-blue-600" onClick={() => setActiveCategory('inconsistent')} />
              <StatCard label="👤 公司自建"    value={stats.customerNoCode} sub="無機構代碼，未納入監控" onClick={() => setActiveCategory('selfmanaged')} />
            </div>
            <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
              ℹ️ BAS 列表只含「開業」機構，停業/歇業者會從清單消失。「疑似歇業」＝代碼不在 BAS 開業清單（可能停業/歇業/換照/遷址/代碼誤植）；點開可逐筆查衛福部並直接編輯開業狀態（寫回 Notion）。醫院查無多為「牙科未登記為牙醫一般科」、醫院本身仍營業，另列「醫院待確認」。
            </p>
          </div>
        </>
      )}

      {/* 新開業候選（主要清單，inline）*/}
      {result?.hasSnapshot && (
        <div>
          <div className="flex items-baseline gap-3 mb-2 flex-wrap">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">🆕 新開業候選</p>
            {stats && (
              <span className="text-[11px] text-gray-400">
                本月新開業 <strong className="text-emerald-600">{stats.newThisMonthClinics + stats.newThisMonthLabs + stats.newThisMonthHospitals}</strong>
                ｜既有未開發 <strong className="text-amber-600">{(stats.newOpeningClinics + stats.newOpeningLabs + stats.newOpeningHospitals) - (stats.newThisMonthClinics + stats.newThisMonthLabs + stats.newThisMonthHospitals)}</strong>
              </span>
            )}
          </div>

          {importResult && (
            <div className={`mb-3 text-sm px-4 py-3 rounded-xl border ${importResult.startsWith('❌') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
              {importResult}
            </div>
          )}
          {stats && stats.newOpeningExcludedExisting > 0 && (
            <div className="mb-3 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
              ℹ️ 已自動排除 {stats.newOpeningExcludedExisting} 筆「名稱與地區已是現有客戶」的機構，可能是客戶代碼未同步、換照換碼或同名同區資料，暫不列入新開業機會。
            </div>
          )}
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
        </div>
      )}

      {/* Modals */}
      {showPreview && selectedInstitutions.length > 0 && (
        <ImportPreviewModal
          selected={selectedInstitutions}
          onConfirm={handleImport}
          onClose={() => setShowPreview(false)}
        />
      )}
      {activeCategory && result && (
        <CategoryModal
          category={activeCategory}
          closureItems={closureItems}
          hospitalItems={hospitalItems}
          result={result}
          onResolved={onStatusResolved}
          onClose={() => setActiveCategory(null)}
        />
      )}
    </div>
  )
}
