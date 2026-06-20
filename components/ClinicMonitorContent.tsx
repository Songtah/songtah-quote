'use client'

import { useState, useMemo, useEffect } from 'react'
import type {
  MonitorResult, NewOpening,
  NormalOperating, SuspectedClosure, CodeNotFound,
  SelfManagedCustomer, InconsistentData,
} from '@/app/api/admin/medical-monitor/route'

// ── Shared UI ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent, delta }: {
  label: string; value: number | string; sub?: string; accent?: string; delta?: number | null
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-400 font-medium">{label}</span>
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

// ── Detail Modals ──────────────────────────────────────────────────────────────

type DetailModalData =
  | { kind: 'normal';       item: NormalOperating }
  | { kind: 'closure';      item: SuspectedClosure }
  | { kind: 'inconsistent'; item: InconsistentData }

function DetailModal({ data, onClose }: { data: DetailModalData; onClose: () => void }) {
  const label =
    data.kind === 'normal'       ? '✅ 既有正常營業' :
    data.kind === 'closure'      ? '⛔ 歇業候選' :
                                   '🔄 資料不一致'
  const base = data.item  // common fields exist on all types

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <h2 className="font-bold text-gray-900 text-lg leading-tight">{base.customerName}</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {base.customerCity}{base.customerDistrict && ` ${base.customerDistrict}`}
              {base.customerType && ` · ${base.customerType}`}
              {base.customerStatus && ` · ${base.customerStatus}`}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">✕</button>
        </div>

        <div className="p-5 space-y-4">

          {/* 狀態 1：既有正常營業 */}
          {data.kind === 'normal' && (() => { const it = data.item; return (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <p className="text-xs font-semibold text-gray-400 mb-2">醫事快照資訊</p>
              <Row label="機構代碼" value={<code className="font-mono text-xs bg-white border border-gray-200 px-1.5 py-0.5 rounded">{it.institutionCode}</code>} />
              <Row label="快照名稱" value={it.snapshotName} />
              <Row label="類型"     value={<TypeChip kind={it.snapshotKind} />} />
              <Row label="地址"     value={it.snapshotAddress} />
            </div>
          )})()}

          {/* 狀態 3：歇業候選 */}
          {data.kind === 'closure' && (() => { const it = data.item; return (
            <>
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800 font-medium">
                ⛔ 機構代碼已從醫事資料中消失，可能已歇業
              </div>
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <Row label="機構代碼" value={<code className="font-mono text-xs bg-white border border-gray-200 px-1.5 py-0.5 rounded">{it.institutionCode}</code>} />
              </div>
              <p className="text-xs text-gray-400">請查衛福部醫事查詢系統確認開業狀態；若為「停業／歇業」再至客戶頁面更新機構狀態。</p>
              <MohwLookupButton name={it.customerName} code={it.institutionCode} customerStatus={it.customerStatus} />
            </>
          )})()}

          {/* 狀態 6：資料不一致 */}
          {data.kind === 'inconsistent' && (() => { const it = data.item; return (
            <>
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-800">
                🔄 機構代碼相符，但以下欄位與醫事快照有落差，請確認是否需要同步
              </div>
              <div className="space-y-2">
                {it.diffs.map((d: { field: string; customerValue: string; snapshotValue: string }) => (
                  <div key={d.field} className="rounded-xl border border-gray-200 p-3">
                    <p className="text-xs font-semibold text-gray-400 mb-1.5">{d.field}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5">公司資料</p>
                        <p className="text-sm text-gray-900 font-medium">{d.customerValue}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5">醫事快照</p>
                        <p className="text-sm text-gray-600">{d.snapshotValue}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <p className="text-xs font-semibold text-gray-400 mb-2">完整快照資料</p>
                <Row label="機構代碼" value={<code className="font-mono text-xs bg-white border border-gray-200 px-1.5 py-0.5 rounded">{it.institutionCode}</code>} />
                <Row label="快照名稱" value={it.snapshotName} />
                <Row label="類型"     value={<TypeChip kind={it.snapshotKind} />} />
                <Row label="地址"     value={it.snapshotAddress} />
              </div>
              <MohwLookupButton name={it.customerName} code={it.institutionCode} kind={it.snapshotKind === '牙體技術所' ? '2' : 'A'} customerStatus={it.customerStatus} />
            </>
          )})()}
        </div>

        <div className="px-5 pb-5 flex justify-end">
          <a href={`/customers/${base.customerId}`} target="_blank" rel="noreferrer"
            className="px-4 py-2 rounded-xl text-sm bg-gray-900 text-white font-medium hover:bg-gray-700">
            前往客戶頁面 →
          </a>
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

// ── 狀態 1：既有正常營業 Tab ───────────────────────────────────────────────────

function NormalOperatingTab({ items, onOpen }: {
  items: NormalOperating[]
  onOpen: (item: NormalOperating) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = search.trim()
    ? items.filter(i => i.customerName.includes(search) || i.institutionCode.includes(search) || i.customerCity.includes(search))
    : items

  if (items.length === 0) return (
    <div className="py-12 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">📋</div>
      <p>尚無代碼對應到快照的客戶</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜尋客戶名稱 / 代碼 / 縣市…"
          className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <span className="text-xs text-gray-400 shrink-0">{filtered.length} / {items.length} 筆</span>
      </div>
      <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {filtered.slice(0, 300).map(item => (
          <button key={item.customerId} onClick={() => onOpen(item)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
                <span className="text-[10px] font-mono text-gray-400">{item.institutionCode}</span>
                <TypeChip kind={item.snapshotKind} />
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
                {item.snapshotAddress && ` · ${item.snapshotAddress}`}
              </div>
            </div>
            <ChevronRight />
          </button>
        ))}
        {filtered.length > 300 && (
          <div className="px-4 py-3 text-xs text-gray-400 text-center">顯示前 300 筆，請搜尋縮小範圍</div>
        )}
      </div>
    </div>
  )
}

// ── 狀態 3：已歇業 Tab ─────────────────────────────────────────────────────────

function SuspectedClosuresTab({ items, onOpen }: {
  items: SuspectedClosure[]
  onOpen: (item: SuspectedClosure) => void
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
        ⛔ 以下客戶原本有機構代碼，但最新醫事資料已查無該代碼。請查衛福部確認開業狀態，若為停業／歇業再人工更新。
      </div>
      <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {items.map(item => (
          <button key={item.customerId} onClick={() => onOpen(item)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
                <span className="text-[10px] font-mono text-gray-400">{item.institutionCode}</span>
                {item.customerType && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{item.customerType}</span>}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 font-semibold">代碼消失</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
                {item.customerStatus && ` · ${item.customerStatus}`}
              </div>
            </div>
            <ChevronRight />
          </button>
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

function InconsistentDataTab({ items, onOpen }: {
  items: InconsistentData[]
  onOpen: (item: InconsistentData) => void
}) {
  if (items.length === 0) return (
    <div className="py-12 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">✅</div>
      <p>所有代碼對應的客戶資料與醫事快照一致</p>
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
        🔄 以下客戶的機構代碼在快照中找到，但名稱或縣市與快照資料有落差，請點擊查看差異並確認是否需要更新。
      </div>
      <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {items.map(item => (
          <button key={item.customerId} onClick={() => onOpen(item)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
                <span className="text-[10px] font-mono text-gray-400">{item.institutionCode}</span>
                <TypeChip kind={item.snapshotKind} />
                {item.diffs.map(d => (
                  <span key={d.field} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">
                    {d.field}不符
                  </span>
                ))}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
                {' · 快照：'}<span className="text-gray-600">{item.snapshotName}</span>
              </div>
            </div>
            <ChevronRight />
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

const CACHE_KEY     = 'clinic-monitor-result-v4'
const CACHE_TAB_KEY = 'clinic-monitor-tab-v3'

type MainTab = 'new' | 'normal' | 'closure' | 'selfmanaged' | 'inconsistent'

export function ClinicMonitorContent({ isAdmin }: { isAdmin?: boolean }) {
  const [tab, setTab]               = useState<MainTab>('new')
  const [result, setResult]         = useState<MonitorResult | null>(null)
  const [cachedAt, setCachedAt]     = useState<string | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState('')

  // 新開業 匯入
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [showPreview, setShowPreview]   = useState(false)
  const [importing, setImporting]       = useState(false)
  const [importResult, setImportResult] = useState('')

  // Detail modal
  const [detailModal, setDetailModal] = useState<DetailModalData | null>(null)

  // ── 還原 localStorage ─────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return
      const { data, timestamp } = JSON.parse(raw) as { data: MonitorResult; timestamp: string }
      setResult(data)
      setCachedAt(timestamp)
    } catch {}
    try {
      const savedTab = localStorage.getItem(CACHE_TAB_KEY) as MainTab | null
      const validTabs: MainTab[] = ['new', 'normal', 'closure', 'selfmanaged', 'inconsistent']
      if (savedTab && validTabs.includes(savedTab)) setTab(savedTab)
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem(CACHE_TAB_KEY, tab) } catch {}
  }, [tab])

  // ── API calls ─────────────────────────────────────────────────────────────────
  async function loadComparison() {
    setLoading(true); setError('')
    setSelectedIds(new Set()); setImportResult('')
    try {
      const res  = await fetch('/api/admin/medical-monitor')
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '比對失敗'); return }
      const now = new Date().toISOString()
      setResult(data)
      setCachedAt(now)
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: now })) } catch {}
    } catch (e: any) {
      setError(e.message ?? '比對失敗，請重試')
    } finally {
      setLoading(false)
    }
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

  const tabDefs = result ? ([
    { id: 'new',         label: '🆕 新開業候選',  count: result.newOpenings.clinics.length + result.newOpenings.labs.length + result.newOpenings.hospitals.length },
    { id: 'normal',      label: '✅ 既有正常營業', count: result.normalOperating.length },
    { id: 'inconsistent',label: '🔄 資料不一致',  count: result.inconsistentData.length },
    { id: 'closure',     label: '⛔ 歇業候選',     count: result.suspectedClosures.length },
    { id: 'selfmanaged', label: '👤 公司自建',     count: result.selfManagedCustomers.length },
  ] as const) : []

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
                try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(CACHE_TAB_KEY) } catch {}
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
            <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">全台牙科單位數量（較上月增減）</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="牙醫診所"   value={stats.totalClinics} delta={stats.clinicDelta} sub="全台" />
              {stats.totalLabs > 0
                ? <StatCard label="牙體技術所" value={stats.totalLabs} delta={stats.labsStale ? null : stats.labDelta} sub={stats.labsStale ? '⚠ 上月資料（本次未完整抓取）' : '全台'} />
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
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">比對結果摘要</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="本月新開業"  value={stats.newThisMonthClinics + stats.newThisMonthLabs + stats.newThisMonthHospitals}
                sub={`診所 ${stats.newThisMonthClinics} ／牙技所 ${stats.newThisMonthLabs}`} accent="text-emerald-600" />
              <StatCard label="既有未開發"  value={(stats.newOpeningClinics + stats.newOpeningLabs + stats.newOpeningHospitals) - (stats.newThisMonthClinics + stats.newThisMonthLabs + stats.newThisMonthHospitals)}
                sub="在醫事DB但從未成為客戶" accent="text-amber-600" />
              <StatCard label="歇業候選"    value={stats.suspectedClosures}  sub="代碼消失，待查衛福部" accent="text-red-600" />
              <StatCard label="資料不一致"  value={stats.inconsistentData}   sub="代碼符但資料有落差" accent="text-blue-600" />
            </div>
          </div>
        </>
      )}

      {/* Tabs */}
      {result?.hasSnapshot && (
        <>
          <div className="flex flex-wrap bg-gray-100 rounded-xl p-1 gap-1">
            {tabDefs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id as MainTab)}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-1.5 ${tab === t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                {t.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${tab === t.id ? 'bg-gray-100 text-gray-700' : 'bg-white text-gray-500'}`}>{t.count}</span>
              </button>
            ))}
          </div>

          {importResult && (
            <div className={`text-sm px-4 py-3 rounded-xl border ${importResult.startsWith('❌') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
              {importResult}
            </div>
          )}

          {tab === 'new' && (
            <>
            {stats && stats.newOpeningExcludedExisting > 0 && (
              <div className="mb-3 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
                ℹ️ 已自動排除 {stats.newOpeningExcludedExisting} 筆「名稱已是現有客戶」的機構（同一診所在 NHI 有多個機構代碼，非新開業機會）。
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
            </>
          )}
          {tab === 'normal' && (
            <NormalOperatingTab
              items={result.normalOperating}
              onOpen={item => setDetailModal({ kind: 'normal', item })}
            />
          )}
          {tab === 'inconsistent' && (
            <InconsistentDataTab
              items={result.inconsistentData}
              onOpen={item => setDetailModal({ kind: 'inconsistent', item })}
            />
          )}
          {tab === 'closure' && (
            <SuspectedClosuresTab
              items={result.suspectedClosures}
              onOpen={item => setDetailModal({ kind: 'closure', item })}
            />
          )}
          {tab === 'selfmanaged' && (
            <SelfManagedTab items={result.selfManagedCustomers} />
          )}
        </>
      )}

      {/* Modals */}
      {showPreview && selectedInstitutions.length > 0 && (
        <ImportPreviewModal
          selected={selectedInstitutions}
          onConfirm={handleImport}
          onClose={() => setShowPreview(false)}
        />
      )}
      {detailModal && (
        <DetailModal data={detailModal} onClose={() => setDetailModal(null)} />
      )}
    </div>
  )
}
